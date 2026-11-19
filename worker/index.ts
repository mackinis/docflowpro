import { registerCoreRoutes } from './core-routes';
import { registerAuthRoutes } from './auth-routes';
import { registerUserAdminRoutes } from './user-admin-routes';
import { registerDocumentRoutes } from './document-routes';
import { registerConfeccionesRoutes } from './confecciones-routes';
import { registerCaseRoutes } from './case-routes';
import { ensureDatabaseReady } from './startup-migrations';
import { registerSystemMessageRoutes } from './system-message-routes';
import { registerTemplateRoutes, saveTemplateInDb } from './template-routes';
import { registerCaseWorkflowRoutes } from './case-workflow-routes';
import { registerSharedDocumentRoutes } from './shared-document-routes';
import { registerNotificationRoutes } from './notification-routes';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { ProcessTemplate, User } from '../src/types';
import { PRESET_AVATARS } from '../src/data';
import type { AppVariables, Env, QueueJob } from './types';
import {
  clearLoginRateLimit,
  checkLoginRateLimit,
  generateSecureToken,
  hashPassword,
  recordFailedLoginAttempt,
  sha256Hex,
  verifyPassword,
  verifyTurnstileToken,
} from './crypto';
import {
  decodeDataUrl,
  guessMimeType,
  extractTextFromDocx,
  extractTextFromPdf,
  sanitizeFileName,
} from './document-parser';
import {
  canUserManageTemplates,
  createAudit,
  createNotification,
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_VERIFICATION_POLICIES,
  findTemplateOrVirtualById,
  getAllCases,
  getAllDocuments,
  getAllSharedDocuments,
  getAllTemplates,
  getCaseById,
  getFullState,
  getSystemConfigValue,
  mapUserRow,
  setSystemConfigValue,
  validateStageRequirements,
} from './db';
import {
  analyzeDocumentWithAI,
  digitizeTemplateWithAI,
} from './ai';

const SESSION_COOKIE_NAME = 'docflow_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
// Never run schema DDL or migrations on user requests. D1 migrations must be
// applied explicitly during deployment; a transient DDL error must not block
// authentication or every API route. The health endpoint tests D1 separately.



function getClientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers.get('X-Forwarded-Proto');
  if (proto) return proto === 'https';
  return req.url.startsWith('https://');
}

function issueSessionCookie(c: AppContext, rawToken: string) {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isHttpsRequest(c.req.raw),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

async function dispatchQueueJob(env: Env, job: QueueJob): Promise<void> {
  if (env.DOCFLOW_QUEUE) {
    try {
      await env.DOCFLOW_QUEUE.send(job);
      return;
    } catch (err) {
      console.warn('Queue send fallback to inline execution:', err);
    }
  }
  await processQueueJob(job, env);
}

async function processQueueJob(job: QueueJob, env: Env): Promise<void> {
  if (job.type === 'notification_fanout') {
    const { userIds, title, message, notifType, caseId } = job.payload;
    if (Array.isArray(userIds)) {
      for (const uid of userIds) {
        await createNotification(env.DB, uid, title, message, notifType || 'info', caseId);
      }
    }
  } else if (job.type === 'cleanup_unverified') {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      "DELETE FROM users WHERE is_verified = 0 AND role != 'SUPERADMIN' AND token_created_at IS NOT NULL AND token_created_at < ?"
    )
      .bind(cutoff)
      .run();
  } else if (job.type === 'audit_log') {
    const { userId, action, entityType, entityId, entityName } = job.payload;
    await createAudit(env.DB, userId, action, entityType, entityId, entityName);
  }
}

// Global error handler for /api/* so API never returns HTML
app.onError((err, c) => {
  console.error('Worker unhandled error:', err);
  return c.json(
    { error: err?.message || 'Error interno en el servidor Cloudflare Worker.' },
    500
  );
});

// Session resolver middleware for /api/*
app.use('/api/*', async (c, next) => {
  c.set('auth', null);
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    try {
      const tokenHash = await sha256Hex(rawToken);
      const row = await c.env.DB.prepare(
        `SELECT s.id as session_id, s.user_id, s.real_user_id, s.expires_at
         FROM sessions s WHERE s.id = ?`
      )
        .bind(tokenHash)
        .first<any>();

      if (row && new Date(row.expires_at).getTime() > Date.now()) {
        const [userRow, realUserRow] = await Promise.all([
          c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<any>(),
          row.real_user_id
            ? c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.real_user_id).first<any>()
            : Promise.resolve(null),
        ]);

        if (userRow && userRow.active === 1) {
          const user = mapUserRow(userRow, false);
          const realUser = realUserRow && realUserRow.active === 1 ? mapUserRow(realUserRow, false) : user;
          c.set('auth', {
            sessionId: row.session_id,
            user,
            realUser,
          });
        }
      } else if (row) {
        await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
      }
    } catch (err) {
      console.warn('Session lookup error (maybe migrations pending):', err);
    }
  }
  await next();
});

// Auth enforcement middleware for protected routes
const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/auth/bootstrap-status',
  '/api/auth/setup-admin',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/recover-password',
  '/api/auth/reset-password',
]);

app.use('/api/*', async (c, next) => {
  if (PUBLIC_API_PATHS.has(c.req.path)) {
    return next();
  }
  const auth = c.get('auth');
  if (!auth) {
    return c.json({ error: 'Sesión no válida o expirada. Inicie sesión nuevamente.' }, 401);
  }
  return next();
});

// A finalized case is read-only across all mutation APIs, including direct HTTP calls.
app.use('/api/*', async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const path = c.req.path;
  if (/^\/api\/cases\/[^/]+\/reopen$/.test(path)) return next();
  let caseId: string | null = null;
  const caseMatch = path.match(/^\/api\/cases\/([^/]+)/);
  if (caseMatch) caseId = caseMatch[1];
  if (!caseId && /^\/api\/documents(?:\/upload|\/[^/]+\/review|\/[^/]+)$/.test(path)) {
    if (path.endsWith('/upload')) {
      const contentType = c.req.header('Content-Type') || '';
      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.raw.clone().formData();
        caseId = String(form.get('caseId') || '') || null;
      } else {
        const body = await c.req.raw.clone().json().catch(() => ({})) as {caseId?: string};
        caseId = body.caseId || null;
      }
    } else {
      const docId = path.split('/')[3];
      const doc = await c.env.DB.prepare('SELECT case_id FROM documents WHERE id = ?').bind(docId).first<{ case_id: string }>();
      caseId = doc?.case_id || null;
    }
  }
  if (!caseId && /^\/api\/(?:tasks|observations|forms)\/[^/]+/.test(path)) {
    const parts = path.split('/');
    const table = parts[2] === 'tasks' ? 'tasks' : parts[2] === 'observations' ? 'observations' : 'form_submissions';
    const row = await c.env.DB.prepare(`SELECT case_id FROM ${table} WHERE id = ?`).bind(parts[3]).first<{ case_id: string }>().catch(() => null);
    caseId = row?.case_id || null;
  }
  if (caseId) {
    const row = await c.env.DB.prepare('SELECT status FROM cases WHERE id = ?').bind(caseId).first<{ status: string }>();
    if (row?.status === 'completed') return c.json({ error: 'El legajo está finalizado. Reábralo con su contraseña para modificarlo.' }, 409);
  }
  return next();
});

// Permission overrides are checked for every authenticated API request, before route handlers.
app.use('/api/*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth) return next();
  // Impersonation is a real permission boundary: only the selected user may bypass RBAC.
  if (auth.user.role === 'SUPERADMIN') return next();
  const path = c.req.path;
  if (path.startsWith('/api/admin/rbac')) return c.json({ error: 'Acceso RBAC reservado al Superadmin.' }, 403);
  // La carga de un requisito del legajo se autoriza en el handler por legajo/etapa/requisito,
  // no por el permiso RBAC global de administración de documentos.
  if (path === '/api/documents/upload' && c.req.method === 'POST') return next();
  // Audit ingestion must remain available regardless of audit-report viewing rights.
  if (path === '/api/audit/navigation' || path === '/api/audit-logs/log') return next();
  const routes: Array<[RegExp, string]> = [
    [/^\/api\/users(?:\/|$)|^\/api\/admin\/user-creators|^\/api\/admin\/registration-policy/, 'users'],
    [/^\/api\/audit(?:-|\/)|^\/api\/audit-logs/, 'audit'],
    [/^\/api\/statistics(?:\/|$)/, 'statistics'],
    [/^\/api\/cases(?:\/|$)|^\/api\/tasks(?:\/|$)|^\/api\/observations(?:\/|$)|^\/api\/forms(?:\/|$)/, 'cases'],
    [/^\/api\/(?:documents|shared-documents|upload-requests)(?:\/|$)/, 'documents'],
    [/^\/api\/system-messages(?:\/|$)/, 'messages'],
    [/^\/api\/notifications(?:\/|$)/, 'notifications'],
    [/^\/api\/templates(?:\/|$)/, 'templates'],
    [/^\/api\/(?:system-settings|industry|verification-policy|admin\/backup|admin\/cleanup-unverified)(?:\/|$)/, 'settings'],
    [/^\/api\/(?:ai|gemini)(?:\/|$)/, 'ai'],
  ];
  const matched = routes.find(([pattern]) => pattern.test(path));
  if (!matched) return next();
  const method = c.req.method;
  const action = method === 'GET' ? (path.endsWith('/download') ? 'download' : 'view') : method === 'DELETE' ? 'delete' : method === 'POST' && (/\/api\/(?:users|cases|documents|shared-documents|templates)$/.test(path)) ? 'create' : 'edit';
  const { hasRbacPermission } = await import('../src/rbac');
  const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
  if (!hasRbacPermission(matrix, auth.user.role, auth.user.id, `${matched[1]}.${action}` as any)) {
    return c.json({ error: 'Acción denegada por la política RBAC.' }, 403);
  }
  return next();
});

// Expose only the current user's effective document actions, never the full RBAC matrix.
app.get('/api/permissions/me', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'Sesión requerida.' }, 401);
  const { hasRbacPermission } = await import('../src/rbac');
  const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
  const can = (action: 'view' | 'download' | 'edit' | 'create' | 'delete') =>
    hasRbacPermission(matrix, auth.user.role, auth.user.id, `documents.${action}`);
  return c.json({ documents: { view: can('view'), download: can('download'), edit: can('edit'), create: can('create'), delete: can('delete') }, statistics: { view: hasRbacPermission(matrix, auth.user.role, auth.user.id, 'statistics.view'), manage: hasRbacPermission(matrix, auth.user.role, auth.user.id, 'statistics.manage') } });
});

// Granular RBAC administration: server-side superadmin-only policy.
app.get('/api/admin/rbac', async (c) => {
  const auth = c.get('auth');
  if (!auth || auth.realUser.role !== 'SUPERADMIN') return c.json({ error: 'Solo el Superadmin puede ver RBAC.' }, 403);
  return c.json({ matrix: await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} }) });
});
app.put('/api/admin/rbac', async (c) => {
  const auth = c.get('auth');
  if (!auth || auth.realUser.role !== 'SUPERADMIN') return c.json({ error: 'Solo el Superadmin puede modificar RBAC.' }, 403);
  const body = await c.req.json().catch(() => null);
  const { isRbacKey, isNonDelegablePermission } = await import('../src/rbac');
  const roles = ['ADMIN', 'MANAGER', 'ASESOR'];
  const input = body?.matrix;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json({ error: 'Matriz inválida.' }, 400);
  const validate = (values: unknown, role: string) => values && typeof values === 'object' && !Array.isArray(values) && Object.entries(values).every(([key, value]) => isRbacKey(key) && typeof value === 'boolean' && !(value === true && isNonDelegablePermission(role as any, key)));
  if (!input.roles || !input.users || typeof input.roles !== 'object' || typeof input.users !== 'object' || Array.isArray(input.roles) || Array.isArray(input.users)) return c.json({ error: 'Matriz inválida.' }, 400);
  if (Object.entries(input.roles).some(([role, permissions]) => !roles.includes(role) || !validate(permissions, role))) return c.json({ error: 'Roles o permisos inválidos.' }, 400);
  const userRows = await c.env.DB.prepare('SELECT id, role FROM users').all<{id:string;role:string}>();
  const userRoles = new Map((userRows.results || []).map(user => [user.id, user.role]));
  if (Object.entries(input.users).some(([id, permissions]) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !userRoles.has(id) || !validate(permissions, userRoles.get(id)!))) return c.json({ error: 'Usuarios o permisos inválidos o no delegables.' }, 400);
  await setSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: input.roles, users: input.users });
  await createAudit(c.env.DB, auth.realUser.id, 'Modificó matriz RBAC', 'Config', 'rbacMatrix', 'Política granular actualizada');
  return c.json({ success: true });
});

// Workers AI configuration: only server-approved models and roles can be selected.
const AI_MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', name: 'Llama 3.1 8B' },
] as const;
const AI_DELEGABLE_ROLES = ['ADMIN', 'MANAGER', 'ASESOR'] as const;

app.get('/api/ai/settings', async (c) => {
  const auth = c.get('auth')!;
  const settings = await getSystemConfigValue(c.env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  const canConfigure = auth.user.role === 'SUPERADMIN' || (settings.aiSettingsRoles || []).includes(auth.user.role as any);
  const canUse = auth.user.role === 'SUPERADMIN' || (settings.aiAllowedRoles || []).includes(auth.user.role as any);
  if (!canConfigure && !canUse) return c.json({ error: 'Acceso al agente IA no autorizado.' }, 403);
  return c.json({ models: AI_MODELS, model: settings.aiModel || AI_MODELS[0].id,
    allowedRoles: settings.aiAllowedRoles || [], settingsRoles: settings.aiSettingsRoles || [],
    canConfigure, canDelegate: auth.user.role === 'SUPERADMIN' });
});

app.post('/api/ai/settings', async (c) => {
  const auth = c.get('auth')!;
  const current = await getSystemConfigValue(c.env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  const canConfigure = auth.user.role === 'SUPERADMIN' || (current.aiSettingsRoles || []).includes(auth.user.role as any);
  if (!canConfigure) return c.json({ error: 'No autorizado para configurar el agente IA.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!AI_MODELS.some(model => model.id === body.model)) return c.json({ error: 'Modelo no permitido.' }, 400);
  const updated = { ...current, aiModel: body.model };
  if (auth.user.role === 'SUPERADMIN') {
    if (!Array.isArray(body.allowedRoles) || !Array.isArray(body.settingsRoles) ||
      ![...body.allowedRoles, ...body.settingsRoles].every((role: string) => AI_DELEGABLE_ROLES.includes(role as any))) {
      return c.json({ error: 'Permisos de roles inválidos.' }, 400);
    }
    updated.aiAllowedRoles = [...new Set(body.allowedRoles)] as any;
    updated.aiSettingsRoles = [...new Set(body.settingsRoles)] as any;
  }
  await setSystemConfigValue(c.env.DB, 'systemSettings', updated);
  await createAudit(c.env.DB, auth.realUser.id, 'Configuró Agente IA y permisos', 'Config', 'ai', body.model);
  return c.json({ success: true });
});

const enforceAiRbac = async (c: AppContext, next: () => Promise<void>) => {
  if (c.req.path === '/api/ai/settings') return next();
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'No autenticado.' }, 401);
  const settings = await getSystemConfigValue(c.env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  if (auth.user.role !== 'SUPERADMIN' && !(settings.aiAllowedRoles || []).includes(auth.user.role as any)) {
    return c.json({ error: 'El agente IA no está habilitado para su rol.' }, 403);
  }
  return next();
};
app.use('/api/ai/*', enforceAiRbac);
app.use('/api/gemini/*', enforceAiRbac);

// Audit every authenticated API request, including failures, without storing bodies, tokens or query strings.
app.use('/api/*', async (c, next) => {
  const auth = c.get('auth');
  const started = Date.now();
  await next();
  if (!auth) return;
  try {
    await createAudit(c.env.DB, auth.realUser.id,
      `${c.req.method} ${c.req.path} · HTTP ${c.res.status} · ${Date.now() - started}ms`,
      'ApiRequest', c.req.path, auth.user.id === auth.realUser.id ? 'Acceso autenticado' : `Actuando como ${auth.user.id}`);
  } catch (err) { console.error('Failed to record API forensic event:', err); }
});




registerCoreRoutes(app);
registerAuthRoutes(app, { getClientIp, issueSessionCookie, dispatchQueueJob, sessionCookieName: SESSION_COOKIE_NAME, sessionTtlSeconds: SESSION_TTL_SECONDS });


registerUserAdminRoutes(app);

// ============================================================================
// 4. Config & Admin Tools
// ============================================================================
app.post('/api/industry', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede decidir el rubro activo.' }, 403);
  }
  const { industry } = await c.req.json();
  await setSystemConfigValue(c.env.DB, 'activeIndustry', industry);
  await createAudit(c.env.DB, auth.user.id, `Cambió el rubro activo a "${industry}"`, 'Config', 'industry', industry);
  return c.json({ success: true, activeIndustry: industry });
});

app.post('/api/verification-policy', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede decidir las políticas de verificación.' }, 403);
  }
  const { policies } = await c.req.json();
  await setSystemConfigValue(c.env.DB, 'verificationPolicies', policies);
  await createAudit(c.env.DB, auth.user.id, 'Actualizó políticas de verificación de registro', 'Config', 'verificationPolicies', 'Policy updated');
  return c.json({ success: true, policies });
});

app.post('/api/system-settings', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'Solo el Superadmin o Admin pueden configurar la plataforma.' }, 403);
  }
  const { settings } = await c.req.json();
  if (settings && ['aiModel', 'aiAllowedRoles', 'aiSettingsRoles'].some(key => Object.prototype.hasOwnProperty.call(settings, key))) {
    return c.json({ error: 'Configure Agente IA desde su sección específica.' }, 403);
  }
  if (auth.user.role !== 'SUPERADMIN') {
    if (settings?.roleMessagingConfigs !== undefined) {
      return c.json({ error: 'Solo el Superadmin puede modificar las políticas de mensajería interna.' }, 403);
    }
    if (settings?.tabOrder !== undefined) {
      return c.json({ error: 'Solo el Superadmin puede modificar el orden de las solapas.' }, 403);
    }
    if (settings?.allowAdminManagerTemplates !== undefined) {
      return c.json({ error: 'Solo el Superadmin puede modificar los permisos globales de plantillas.' }, 403);
    }
  }
  const current = await getSystemConfigValue(c.env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  const merged = { ...current, ...settings };
  await setSystemConfigValue(c.env.DB, 'systemSettings', merged);
  await createAudit(c.env.DB, auth.user.id, 'Modificó configuraciones del sistema', 'Config', 'systemSettings', 'Configuration updated');
  return c.json({ success: true, settings: merged });
});

app.post('/api/admin/backup', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'Solo el Superadmin o Admin pueden exportar copias de seguridad.' }, 403);
  }
  const backup = await getFullState(c.env, auth.user, auth.realUser);
  await createAudit(c.env.DB, auth.user.id, 'Exportó copia de seguridad completa del sistema (D1/R2)', 'Config', 'backup', 'Backup downloaded');
  return c.json({ success: true, backup });
});

app.post('/api/admin/cleanup-unverified', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'Solo el Superadmin o Admin pueden ejecutar la autolimpieza.' }, 403);
  }
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const toDelete = await c.env.DB.prepare(
    "SELECT id, email FROM users WHERE is_verified = 0 AND role != 'SUPERADMIN' AND token_created_at IS NOT NULL AND token_created_at < ?"
  )
    .bind(cutoff)
    .all<{ id: string; email: string }>();

  const rows = toDelete.results || [];
  if (rows.length > 0) {
    await dispatchQueueJob(c.env, { type: 'cleanup_unverified', payload: {} });
    await createAudit(
      c.env.DB,
      auth.user.id,
      `Ejecutó autolimpieza manual: ${rows.length} cuentas no verificadas`,
      'Config',
      'cleanup',
      `${rows.length} users removed`
    );
  }

  return c.json({
    success: true,
    deletedCount: rows.length,
    deletedEmails: rows.map((u) => u.email),
  });
});

registerSystemMessageRoutes(app);

const identifyDigitizedFields = registerTemplateRoutes(app);

registerCaseRoutes(app, { dispatchQueueJob, getClientIp });

registerConfeccionesRoutes(app);

app.post('/api/cases/:id/advance', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
  if (!template) return c.json({ error: 'Plantilla de proceso no encontrada' }, 404);

  const currentStage = template.stages[caseObj.currentStageIndex];
  if (!currentStage) return c.json({ error: 'Etapa actual no válida' }, 400);

  const validation = await validateStageRequirements(c.env.DB, caseObj.id, currentStage.id, template);
  if (!validation.isValid) {
    return c.json(
      { error: 'Avance denegado automáticamente', reasons: validation.missing },
      400
    );
  }

  const nextStageIndex = caseObj.currentStageIndex + 1;
  const isCompleted = nextStageIndex >= template.stages.length;
  const nextIndexToSave = isCompleted ? caseObj.currentStageIndex : nextStageIndex;
  const nextStatus = isCompleted ? 'completed' : 'active';
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'UPDATE cases SET current_stage_index = ?, status = ?, is_current_stage_approved = 0, updated_at = ? WHERE id = ?'
  )
    .bind(nextIndexToSave, nextStatus, now, id)
    .run();

  if (!isCompleted) {
    const nextStage = template.stages[nextStageIndex];
    for (const reqObj of nextStage.requirements) {
      if (reqObj.type === 'task') {
        const exists = await c.env.DB.prepare(
          'SELECT id FROM tasks WHERE case_id = ? AND requirement_id = ?'
        )
          .bind(id, reqObj.id)
          .first();
        if (!exists) {
          await c.env.DB.prepare(
            `INSERT INTO tasks (id, case_id, stage_id, requirement_id, name, description, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`
          )
            .bind(
              `tsk-${Date.now()}-${crypto.randomUUID().slice(0, 5)}`,
              id,
              nextStage.id,
              reqObj.id,
              reqObj.name,
              reqObj.description || ''
            )
            .run();
        }
      }
    }

    await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Cambio de Etapa',
      `El legajo ${caseObj.code} avanzó a la etapa: "${nextStage.name}"`,
      'success',
      id
    );
    await createAudit(c.env.DB, auth.user.id, `Avanzó etapa a "${nextStage.name}"`, 'Case', id, caseObj.title);
  } else {
    await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Legajo Finalizado',
      `¡Felicidades! El legajo ${caseObj.code} ha sido finalizado exitosamente.`,
      'success',
      id
    );
    await createAudit(c.env.DB, auth.user.id, 'Finalizó legajo', 'Case', id, caseObj.title);
  }

  return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
});

app.post('/api/cases/:id/approve-stage', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para aprobar etapas.' }, 403);
  }
  const { id } = c.req.param();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
  if (!template) return c.json({ error: 'Plantilla de proceso no encontrada' }, 404);

  const currentStage = template.stages[caseObj.currentStageIndex];
  if (!currentStage) return c.json({ error: 'Etapa actual no válida' }, 400);

  await c.env.DB.prepare(
    'UPDATE cases SET is_current_stage_approved = 1, updated_at = ? WHERE id = ?'
  )
    .bind(new Date().toISOString(), id)
    .run();

  await createNotification(
    c.env.DB,
    caseObj.assignedAdvisorId,
    'Etapa Aprobada',
    `¡Tu etapa actual "${currentStage.name}" ha sido aprobada por el Manager!`,
    'success',
    id
  );
  await createAudit(c.env.DB, auth.user.id, `Aprobó etapa "${currentStage.name}"`, 'Case', id, caseObj.title);
  return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
});

app.get('/api/cases/:id/validate', async (c) => {
  const { id } = c.req.param();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);
  const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
  if (!template) return c.json({ error: 'Plantilla de proceso no encontrada' }, 404);
  const currentStage = template.stages[caseObj.currentStageIndex];
  if (!currentStage) return c.json({ error: 'Etapa actual no válida' }, 400);

  const validation = await validateStageRequirements(c.env.DB, caseObj.id, currentStage.id, template);
  return c.json(validation);
});

registerSharedDocumentRoutes(app, dispatchQueueJob);

registerDocumentRoutes(app);

registerCaseWorkflowRoutes(app, registerNotificationRoutes);

// ============================================================================
// 11. Cloudflare Workers AI Endpoints (Replaces Gemini 100%)
// ============================================================================
async function handleAnalyzeDocument(c: AppContext) {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para ejecutar auditorías IA.' }, 403);
  }
  const { documentId, requirementName, requirementDescription, fileName } = await c.req.json();
  const docRow = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(documentId).first<any>();
  if (!docRow) return c.json({ error: 'Documento no encontrado' }, 404);

  try {
    const result = await analyzeDocumentWithAI(c.env, {
      requirementName: requirementName || docRow.name,
      requirementDescription: requirementDescription || '',
      fileName: fileName || docRow.file_name || 'documento',
      r2Key: docRow.r2_key,
    });

    const now = new Date().toISOString();
    if (result.approved) {
      await c.env.DB.prepare("UPDATE documents SET status = 'approved' WHERE id = ?")
        .bind(docRow.id)
        .run();
      await createAudit(c.env.DB, auth.user.id, 'Auditoría Workers AI: Documento aprobado', 'Document', docRow.id, docRow.name);
    } else {
      await c.env.DB.prepare("UPDATE documents SET status = 'rejected' WHERE id = ?")
        .bind(docRow.id)
        .run();
      const obsText = result.suggestedObservation || `Observación de Workers AI para ${requirementName}`;
      await c.env.DB.prepare(
        `INSERT INTO observations (id, case_id, stage_id, requirement_id, document_id, text, created_by, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`
      )
        .bind(
          `obs-ai-${Date.now()}`,
          docRow.case_id,
          docRow.stage_id,
          docRow.requirement_id,
          docRow.id,
          obsText,
          auth.user.id,
          now
        )
        .run();
      await createAudit(c.env.DB, auth.user.id, 'Auditoría Workers AI: Documento rechazado', 'Document', docRow.id, docRow.name);
    }

    const caseObj = await getCaseById(c.env.DB, docRow.case_id);
    if (caseObj) {
      await c.env.DB.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
        .bind(result.approved ? 'active' : 'observed', now, caseObj.id)
        .run();
      await createNotification(
        c.env.DB,
        docRow.uploaded_by || caseObj.assignedAdvisorId,
        result.approved ? 'Workers AI Auditoría: Aprobado' : 'Workers AI Auditoría: Observado',
        result.approved
          ? `Cloudflare Workers AI auditó y aprobó tu documento "${docRow.name}" en el legajo ${caseObj.code}.`
          : `Cloudflare Workers AI auditó y observó tu documento "${docRow.name}" en ${caseObj.code}.`,
        result.approved ? 'success' : 'error',
        docRow.case_id
      );
    }

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Workers AI document audit error:', err);
    return c.json(
      {
        error: err?.message || 'Error ejecutando auditoría en Cloudflare Workers AI.',
      },
      503
    );
  }
}

async function handleDigitizeTemplate(c: AppContext) {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para digitalizar plantillas.' }, 403);
  }
  const { fileBase64, mimeType, fileName, textProposal, industry } = await c.req.json();

  try {
    const digitized = await digitizeTemplateWithAI(c.env, {
      fileBase64,
      mimeType,
      fileName,
      textProposal,
      industry: industry || 'Administrativo',
    });

    const finalTemplate: ProcessTemplate = {
      id: `tmpl-dig-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
      ...digitized,
    };
    // Digitization is the only semantic interpretation stage.
    // Keep machine-readable markers unchanged for downstream filling.
    finalTemplate.fieldMap=identifyDigitizedFields(finalTemplate.originalDocumentContent||'');
    finalTemplate.digitizationReviewNotes=finalTemplate.fieldMap.filter(f=>f.review)
      .map(f=>f.id+': significado o actor pendiente de confirmar');
    await saveTemplateInDb(c.env.DB, finalTemplate, false);
    await createAudit(
      c.env.DB,
      auth.user.id,
      'Plantilla digitalizada con Cloudflare Workers AI',
      'ProcessTemplate',
      finalTemplate.id,
      finalTemplate.name
    );
    return c.json({ success: true, template: finalTemplate });
  } catch (err: any) {
    console.error('Workers AI digitization error:', err);
    return c.json(
      { error: err?.message || 'Error digitalizando documento con Cloudflare Workers AI.' },
      503
    );
  }
}

app.post('/api/ai/analyze-document', handleAnalyzeDocument);
app.post('/api/ai/digitize-template', handleDigitizeTemplate);
// Backward-compatible route aliases
app.post('/api/gemini/analyze-document', handleAnalyzeDocument);
app.post('/api/gemini/digitize-template', handleDigitizeTemplate);

// Catch-all for unknown /api/* routes (never return HTML)
app.all('/api/*', (c) => {
  return c.json({ error: `Ruta API no encontrada: ${c.req.method} ${c.req.path}` }, 404);
});

// Serve Static Assets / SPA fallback via Cloudflare Workers Assets binding
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('ASSETS binding not configured', 404);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // Audit records are retained; automatic deletion would destroy legal traceability.
    await ensureDatabaseReady(env.DB);
  },
  async queue(batch: MessageBatch<QueueJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processQueueJob(msg.body, env);
        msg.ack();
      } catch (err) {
        console.error('Queue job processing error:', err);
        msg.retry();
      }
    }
  },
};
