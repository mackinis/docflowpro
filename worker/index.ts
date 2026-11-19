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
// Gate every API call until the bundled D1 schema is ready.
app.use('/api/*', async (c, next) => {
  try {
    await ensureDatabaseReady(c.env.DB);
  } catch (error) {
    console.error('Automatic D1 initialization failed:', error);
    return c.json({ message: 'Estamos trabajando en la base de datos. Aguarde.', error: 'database_initializing' }, 503, { 'Retry-After': '5' });
  }
  await next();
});


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

app.post('/api/audit/navigation', async (c) => {
  const auth = c.get('auth')!;
  const body = await c.req.json().catch(() => ({}));
  const tab = typeof body.tab === 'string' && /^[a-z-]{1,40}$/.test(body.tab) ? body.tab : 'unknown';
  const caseId = typeof body.caseId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.caseId) ? body.caseId : '';
  await createAudit(c.env.DB, auth.realUser.id, 'Navegación: ' + tab,
    'Navigation', caseId || tab, auth.user.id === auth.realUser.id ? tab : `Impersonación ${auth.user.id}: ${tab}`);
  return c.json({ success: true });
});

// ============================================================================
// 0. Health Check
// ============================================================================
app.get('/api/health', async (c) => {
  try {
    const dbCheck = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
    return c.json({
      status: 'ok',
      runtime: 'cloudflare-workers',
      d1: dbCheck?.ok === 1,
      r2: Boolean(c.env.R2_BUCKET),
      kv: Boolean(c.env.KV),
      ai: Boolean(c.env.AI),
      queue: Boolean(c.env.DOCFLOW_QUEUE),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json(
      {
        status: 'degraded',
        runtime: 'cloudflare-workers',
        d1: false,
        error: 'Base de datos D1 no inicializada o migraciones pendientes.',
      },
      503
    );
  }
});

// ============================================================================
// 1. Auth & Bootstrap First Superadmin
// ============================================================================
app.get('/api/auth/bootstrap-status', async (c) => {
  const superadminCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE role = 'SUPERADMIN'"
  ).first<{ count: number }>();

  const auth = c.get('auth');
  return c.json({
    needsSetup: (superadminCount?.count ?? 0) === 0,
    publicRegistrationEnabled: await getSystemConfigValue<boolean>(c.env.DB, 'publicRegistrationEnabled', true),
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || '',
    turnstileEnabled: Boolean(c.env.TURNSTILE_SECRET_KEY && c.env.TURNSTILE_SITE_KEY),
    user: auth ? auth.user : null,
    realUser: auth ? auth.realUser : null,
  });
});

app.post('/api/auth/setup-admin', async (c) => {
  const existing = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE role = 'SUPERADMIN'"
  ).first<{ count: number }>();

  if ((existing?.count ?? 0) > 0) {
    return c.json(
      { error: 'El administrador inicial ya fue configurado. Inicie sesión con sus credenciales.' },
      403
    );
  }

  const body = await c.req.json();
  const { name, lastName, email, password, phone, turnstileToken } = body;

  const tsCheck = await verifyTurnstileToken(c.env, turnstileToken, getClientIp(c.req.raw));
  if (!tsCheck.success) {
    return c.json({ error: tsCheck.error }, 403);
  }

  if (!name?.trim() || !lastName?.trim() || !email?.trim() || !password || password.length < 8) {
    return c.json(
      { error: 'Complete nombre, apellido, correo y una contraseña segura de al menos 8 caracteres.' },
      400
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const userId = `usr-super-${crypto.randomUUID().slice(0, 8)}`;
  const pwHash = await hashPassword(password);
  const avatar = PRESET_AVATARS[0]?.url || '';

  await c.env.DB.prepare(
    `INSERT INTO users (id, name, last_name, email, role, avatar, phone, active, address, city, province, country, password_hash, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'SUPERADMIN', ?, ?, 1, '', '', '', '', ?, 1, ?, ?)`
  )
    .bind(userId, name.trim(), lastName.trim(), normalizedEmail, avatar, phone || '', pwHash, now, now)
    .run();

  const rawSession = generateSecureToken(32);
  const sessionHash = await sha256Hex(rawSession);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, real_user_id, expires_at, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionHash,
      userId,
      userId,
      expiresAt,
      getClientIp(c.req.raw),
      c.req.header('User-Agent') || '',
      now
    )
    .run();

  issueSessionCookie(c, rawSession);
  await createAudit(c.env.DB, userId, 'Configuración inicial de Superadmin', 'User', userId, `${name} ${lastName}`);

  const createdRow = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>();
  return c.json({ success: true, user: mapUserRow(createdRow, false) }, 201);
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json();
  const { email, password, turnstileToken } = body;

  const tsCheck = await verifyTurnstileToken(c.env, turnstileToken, getClientIp(c.req.raw));
  if (!tsCheck.success) {
    return c.json({ error: tsCheck.error }, 403);
  }

  if (!email || !password) {
    return c.json({ error: 'Email y contraseña requeridos.' }, 400);
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const rateKey = `login:${getClientIp(c.req.raw)}:${normalizedEmail}`;
  const rateCheck = await checkLoginRateLimit(c.env, rateKey);
  if (!rateCheck.allowed) {
    return c.json(
      { error: 'Demasiados intentos fallidos. Por seguridad, espera 15 minutos antes de reintentar.' },
      429
    );
  }

  const userRow = await c.env.DB.prepare('SELECT * FROM users WHERE LOWER(email) = ?')
    .bind(normalizedEmail)
    .first<any>();

  if (!userRow || !(await verifyPassword(password, userRow.password_hash))) {
    await recordFailedLoginAttempt(c.env, rateKey);
    return c.json({ error: 'Credenciales inválidas.' }, 401);
  }

  if (userRow.active !== 1) {
    return c.json({ error: 'Tu cuenta ha sido desactivada por un administrador.' }, 403);
  }

  if (userRow.is_verified !== 1) {
    return c.json(
      {
        error:
          'Tu cuenta aún se encuentra pendiente de verificación/aprobación por un Administrador o Superadministrador.',
        requiresAdminApproval: true,
        email: userRow.email,
      },
      403
    );
  }

  await clearLoginRateLimit(c.env, rateKey);

  const rawSession = generateSecureToken(32);
  const sessionHash = await sha256Hex(rawSession);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, real_user_id, expires_at, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionHash,
      userRow.id,
      userRow.id,
      expiresAt,
      getClientIp(c.req.raw),
      c.req.header('User-Agent') || '',
      now
    )
    .run();

  issueSessionCookie(c, rawSession);
  await createAudit(
    c.env.DB,
    userRow.id,
    'Inicio de sesión exitoso',
    'User',
    userRow.id,
    `${userRow.name} ${userRow.last_name}`
  );

  return c.json({ success: true, user: mapUserRow(userRow, false) });
});

app.post('/api/auth/logout', async (c) => {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    const tokenHash = await sha256Hex(rawToken);
    const auth = c.get('auth');
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
    if (auth) {
      await createAudit(
        c.env.DB,
        auth.realUser.id,
        'Cierre de sesión',
        'User',
        auth.realUser.id,
        `${auth.realUser.name} ${auth.realUser.lastName}`
      );
    }
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ success: true });
});

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json();
  const { name, lastName, email, phone, address, city, province, country, password, turnstileToken } =
    body;

  const registrationEnabled = await getSystemConfigValue<boolean>(c.env.DB, 'publicRegistrationEnabled', true);
  if (!registrationEnabled) {
    return c.json({ error: 'El registro público está deshabilitado. Solicite su cuenta a un administrador.' }, 403);
  }

  const tsCheck = await verifyTurnstileToken(c.env, turnstileToken, getClientIp(c.req.raw));
  if (!tsCheck.success) {
    return c.json({ error: tsCheck.error }, 403);
  }

  if (!name?.trim() || !lastName?.trim() || !email?.trim() || !password || password.length < 8) {
    return c.json(
      { error: 'Faltan campos requeridos o la contraseña tiene menos de 8 caracteres.' },
      400
    );
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await c.env.DB.prepare('SELECT id, is_verified FROM users WHERE LOWER(email) = ?')
    .bind(normalizedEmail)
    .first<{ id: string; is_verified: number }>();

  if (existing && existing.is_verified === 1) {
    return c.json({ error: 'El correo electrónico ya está registrado.' }, 400);
  }

  const policies = await getSystemConfigValue<any>(
    c.env.DB,
    'verificationPolicies',
    DEFAULT_VERIFICATION_POLICIES
  );
  const autoVerify = policies.global === 'direct';
  const pwHash = await hashPassword(password);
  const now = new Date().toISOString();
  const avatar = PRESET_AVATARS[Math.floor(Math.random() * PRESET_AVATARS.length)]?.url || '';

  let userId: string;
  if (existing) {
    userId = existing.id;
    await c.env.DB.prepare(
      `UPDATE users SET name = ?, last_name = ?, phone = ?, address = ?, city = ?, province = ?, country = ?,
       password_hash = ?, is_verified = ?, token_created_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(
        name.trim(),
        lastName.trim(),
        phone || '',
        address || '',
        city || '',
        province || '',
        country || '',
        pwHash,
        autoVerify ? 1 : 0,
        now,
        now,
        userId
      )
      .run();
  } else {
    userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
    await c.env.DB.prepare(
      `INSERT INTO users (id, name, last_name, email, role, avatar, phone, active, address, city, province, country, password_hash, is_verified, token_created_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ASESOR', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        userId,
        name.trim(),
        lastName.trim(),
        normalizedEmail,
        avatar,
        phone || '',
        address || '',
        city || '',
        province || '',
        country || '',
        pwHash,
        autoVerify ? 1 : 0,
        now,
        now,
        now
      )
      .run();
  }

  await createAudit(c.env.DB, userId, 'Registro de usuario', 'User', userId, `${name} ${lastName}`);

  if (!autoVerify) {
    const admins = await c.env.DB.prepare(
      "SELECT id FROM users WHERE role IN ('SUPERADMIN', 'ADMIN') AND active = 1"
    ).all<{ id: string }>();
    const adminIds = (admins.results || []).map((a) => a.id);
    if (adminIds.length > 0) {
      await dispatchQueueJob(c.env, {
        type: 'notification_fanout',
        payload: {
          userIds: adminIds,
          title: 'Nueva Cuenta Pendiente de Aprobación',
          message: `${name} ${lastName} (${normalizedEmail}) se registró y aguarda activación en Perfiles de Usuarios.`,
          notifType: 'warning',
        },
      });
    }
  }

  const createdRow = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>();
  return c.json(
    {
      ...mapUserRow(createdRow, false),
      requiresAdminApproval: !autoVerify,
      message: autoVerify
        ? 'Registro completado. Ya puedes iniciar sesión.'
        : 'Registro completado. Un Administrador o Superadministrador debe aprobar tu cuenta en Perfiles de Usuarios para habilitar el acceso (no se utilizan proveedores externos de Email/SMS).',
    },
    201
  );
});

app.post('/api/auth/impersonate', async (c) => {
  const auth = c.get('auth')!;
  if (auth.realUser.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede simular otros roles.' }, 403);
  }
  const { targetUserId } = await c.req.json();
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND active = 1')
    .bind(targetUserId)
    .first<any>();
  if (!target) {
    return c.json({ error: 'Usuario destino no encontrado o inactivo.' }, 404);
  }
  await c.env.DB.prepare('UPDATE sessions SET user_id = ? WHERE id = ?')
    .bind(target.id, auth.sessionId)
    .run();

  return c.json({ success: true, user: mapUserRow(target, false) });
});

app.post('/api/auth/update-profile', async (c) => {
  const auth = c.get('auth')!;
  const body = await c.req.json();
  const { userId, name, lastName, phone, address, city, province, country, password, avatar } = body;

  const targetId = userId || auth.user.id;
  if (avatar !== undefined && (typeof avatar !== 'string' || avatar.length > 250000 || !(PRESET_AVATARS.some(item => item.url === avatar) || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)))) {
    return c.json({ error: 'Imagen de perfil inválida o demasiado grande.' }, 400);
  }
  if (targetId !== auth.user.id && auth.realUser.role !== 'SUPERADMIN') {
    return c.json({ error: 'No autorizado para editar otro perfil desde esta ruta.' }, 403);
  }

  const existing = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(targetId).first<any>();
  if (!existing) {
    return c.json({ error: 'Usuario no encontrado' }, 404);
  }

  const now = new Date().toISOString();
  const newHash = password ? await hashPassword(password) : existing.password_hash;

  await c.env.DB.prepare(
    `UPDATE users SET name = ?, last_name = ?, phone = ?, address = ?, city = ?, province = ?, country = ?, avatar = ?, password_hash = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      name !== undefined ? name : existing.name,
      lastName !== undefined ? lastName : existing.last_name,
      phone !== undefined ? phone : existing.phone,
      address !== undefined ? address : existing.address,
      city !== undefined ? city : existing.city,
      province !== undefined ? province : existing.province,
      country !== undefined ? country : existing.country,
      avatar !== undefined ? avatar : existing.avatar,
      newHash,
      now,
      targetId
    )
    .run();

  await createAudit(c.env.DB, auth.user.id, 'Actualizó su perfil', 'User', targetId, `${name || existing.name} ${lastName || existing.last_name}`);
  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(targetId).first<any>();
  return c.json({ success: true, user: mapUserRow(updated, false) });
});

// Account recovery request (validates Turnstile; generates CSPRNG token in KV)
app.post('/api/auth/recover-password', async (c) => {
  const { email, turnstileToken } = await c.req.json();
  const tsCheck = await verifyTurnstileToken(c.env, turnstileToken, getClientIp(c.req.raw));
  if (!tsCheck.success) {
    return c.json({ error: tsCheck.error }, 403);
  }
  if (!email) {
    return c.json({ error: 'Correo requerido.' }, 400);
  }
  const userRow = await c.env.DB.prepare('SELECT id, email FROM users WHERE LOWER(email) = ?')
    .bind(String(email).trim().toLowerCase())
    .first<{ id: string; email: string }>();

  if (userRow) {
    const rawToken = generateSecureToken(24);
    const tokenHash = await sha256Hex(rawToken);
    await c.env.KV.put(`recovery:${tokenHash}`, userRow.id, { expirationTtl: 900 });
    await createAudit(c.env.DB, userRow.id, 'Solicitó recuperación de contraseña', 'User', userRow.id, userRow.email);
  }

  return c.json({
    success: true,
    message:
      'Si el correo existe en la plataforma, un Administrador puede restablecer o verificar tu acceso desde Perfiles de Usuarios (Cloudflare Workers no envía correos salientes sin un proveedor externo).',
  });
});

app.post('/api/auth/reset-password', async (c) => {
  const { token, newPassword } = await c.req.json();
  if (!token || !newPassword || newPassword.length < 8) {
    return c.json({ error: 'Token y contraseña segura (mín. 8 caracteres) requeridos.' }, 400);
  }
  const tokenHash = await sha256Hex(String(token));
  const userId = await c.env.KV.get(`recovery:${tokenHash}`);
  if (!userId) {
    return c.json({ error: 'Token de recuperación inválido o expirado.' }, 400);
  }
  const pwHash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(pwHash, new Date().toISOString(), userId)
    .run();
  await c.env.KV.delete(`recovery:${tokenHash}`);
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  await createAudit(c.env.DB, userId, 'Restableció su contraseña', 'User', userId, 'Password Reset');
  return c.json({ success: true });
});

// ============================================================================
// 2. App State
// ============================================================================
app.get('/api/state', async (c) => {
  const auth = c.get('auth')!;
  const state = await getFullState(c.env, auth.user, auth.realUser);
  return c.json(state);
});

// ============================================================================
// 3. Users & Admin Management
// ============================================================================
app.get('/api/users', async (c) => {
  const auth = c.get('auth')!;
  const isSuper = auth.user.role === 'SUPERADMIN' || auth.realUser.role === 'SUPERADMIN';
  const rows = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all<any>();
  const users = (rows.results || [])
    .map((r) => mapUserRow(r, false))
    .filter((u) => isSuper || u.role !== 'SUPERADMIN');
  return c.json(users);
});

// Public registration policy: only the actual Superadmin may change it.
app.get('/api/admin/registration-policy', async (c) => {
  const auth = c.get('auth')!;
  if (auth.realUser.role !== 'SUPERADMIN') return c.json({ error: 'Acceso denegado.' }, 403);
  const enabled = await getSystemConfigValue<boolean>(c.env.DB, 'publicRegistrationEnabled', true);
  return c.json({ enabled });
});

app.put('/api/admin/registration-policy', async (c) => {
  const auth = c.get('auth')!;
  if (auth.realUser.role !== 'SUPERADMIN') return c.json({ error: 'Acceso denegado.' }, 403);
  const body = await c.req.json<{ enabled?: unknown }>();
  if (typeof body.enabled !== 'boolean') return c.json({ error: 'Valor inválido.' }, 400);
  await setSystemConfigValue(c.env.DB, 'publicRegistrationEnabled', body.enabled);
  await createAudit(c.env.DB, auth.realUser.id, body.enabled ? 'Habilitó registro público' : 'Deshabilitó registro público', 'Security', 'publicRegistrationEnabled', 'Registro de usuarios');
  return c.json({ enabled: body.enabled });
});

// Superadmin delegates account creation to individual administrators.
app.get('/api/admin/user-creators', async (c) => {
  const auth = c.get('auth')!;
  if (auth.realUser.role !== 'SUPERADMIN') return c.json({ error: 'No autorizado.' }, 403);
  return c.json({ ids: await getSystemConfigValue<string[]>(c.env.DB, 'delegatedUserCreators', []) });
});
app.put('/api/admin/user-creators', async (c) => {
  const auth = c.get('auth')!;
  if (auth.realUser.role !== 'SUPERADMIN') return c.json({ error: 'No autorizado.' }, 403);
  const body = await c.req.json<{ ids?: unknown }>();
  if (!Array.isArray(body.ids) || body.ids.length > 1000 || !body.ids.every(id => typeof id === 'string')) return c.json({ error: 'Lista inválida.' }, 400);
  const ids = [...new Set(body.ids as string[])];
  if (ids.length) {
    const admins = await c.env.DB.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND active = 1").all<{ id: string }>();
    const valid = new Set((admins.results || []).map(a => a.id));
    if (ids.some(id => !valid.has(id))) return c.json({ error: 'Solo se pueden delegar administradores activos.' }, 400);
  }
  await setSystemConfigValue(c.env.DB, 'delegatedUserCreators', ids);
  await createAudit(c.env.DB, auth.realUser.id, 'Actualizó administradores habilitados para crear usuarios', 'Security', 'delegatedUserCreators', ids.join(', '));
  return c.json({ ids });
});

app.get('/api/users/creation-permission', async (c) => {
  const auth = c.get('auth')!;
  const delegates = await getSystemConfigValue<string[]>(c.env.DB, 'delegatedUserCreators', []);
  return c.json({ allowed: auth.user.role === 'SUPERADMIN' || (auth.user.role === 'ADMIN' && delegates.includes(auth.user.id)) });
});

app.post('/api/users', async (c) => {
  const auth = c.get('auth')!;
  const role = auth.user.role;
  const delegates = await getSystemConfigValue<string[]>(c.env.DB, 'delegatedUserCreators', []);
  if (role !== 'SUPERADMIN' && !(role === 'ADMIN' && delegates.includes(auth.user.id))) {
    return c.json({ error: 'No tiene autorización para crear usuarios.' }, 403);
  }
  const body = await c.req.json();
  const { name, lastName, email, password, phone, address, city, province, country } = body;
  if (body.avatar !== undefined && !PRESET_AVATARS.some(item => item.url === body.avatar)) {
    return c.json({ error: 'Seleccione un avatar disponible.' }, 400);
  }
  const targetRole = String(body.role || 'ASESOR').toUpperCase();
  if (!['ADMIN', 'MANAGER', 'ASESOR'].includes(targetRole) || (role !== 'SUPERADMIN' && targetRole === 'ADMIN')) {
    return c.json({ error: 'Rol no permitido.' }, 403);
  }
  if (!String(name || '').trim() || !String(lastName || '').trim() || !String(email || '').includes('@') || typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Nombre, apellido, correo y contraseña de al menos 8 caracteres son obligatorios.' }, 400);
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(normalizedEmail).first();
  if (exists) return c.json({ error: 'Ya existe una cuenta con ese correo.' }, 409);
  const id = 'usr-' + crypto.randomUUID();
  const now = new Date().toISOString();
  const pwHash = await hashPassword(password);
  const avatar = body.avatar || PRESET_AVATARS[0]?.url || '';
  await c.env.DB.prepare(`INSERT INTO users (id, name, last_name, email, role, avatar, phone, active, address, city, province, country, password_hash, is_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(id, String(name).trim(), String(lastName).trim(), normalizedEmail, targetRole, avatar, phone || '', address || '', city || '', province || '', country || '', pwHash, now, now).run();
  await createAudit(c.env.DB, auth.user.id, 'Creó usuario habilitado', 'User', id, normalizedEmail);
  return c.json({ success: true, id }, 201);
});

app.put('/api/users/:id', async (c) => {
  const auth = c.get('auth')!;
  const currentUser = auth.user;
  const { id } = c.req.param();
  const body = await c.req.json();
  const {
    name,
    lastName,
    email,
    phone,
    role,
    active,
    address,
    city,
    province,
    country,
    password,
    avatar,
    isVerified,
    hasSensitiveEditPermissionOverride,
  } = body;

  const targetRow = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!targetRow) {
    return c.json({ error: 'Usuario destino no encontrado.' }, 404);
  }

  if (targetRow.role === 'SUPERADMIN' && currentUser.role !== 'SUPERADMIN') {
    return c.json({ error: 'Acceso denegado. El Superadmin es invisible e intocable.' }, 403);
  }

  const isEditingSensitive =
    email !== undefined ||
    password !== undefined ||
    role !== undefined ||
    active !== undefined ||
    isVerified !== undefined ||
    hasSensitiveEditPermissionOverride !== undefined;

  // Every sensitive field is independently authorized by the persisted RBAC matrix.
  // Hierarchy and the single-Superadmin invariant below remain additional restrictions.
  if (isEditingSensitive && auth.realUser.role !== 'SUPERADMIN') {
    const { hasRbacPermission } = await import('../src/rbac');
    const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
    const checks: Array<[boolean, string]> = [
      [email !== undefined, 'userEmail.edit'],
      [role !== undefined, 'userRole.edit'],
      [password !== undefined, 'userPassword.edit'],
      [active !== undefined || isVerified !== undefined, 'userStatus.edit'],
      [hasSensitiveEditPermissionOverride !== undefined, 'userSensitive.edit'],
    ];
    for (const [changed, permission] of checks) {
      if (changed && !hasRbacPermission(matrix, auth.realUser.role, auth.realUser.id, permission as any)) {
        return c.json({ error: 'Permiso RBAC insuficiente para modificar ' + permission }, 403);
      }
    }
  }

  if (isEditingSensitive) {
    const actorRole = currentUser.role;
    const targetRole = targetRow.role;
    let allowed = false;

    if (currentUser.hasSensitiveEditPermissionOverride === false) {
      allowed = false;
    } else if (currentUser.hasSensitiveEditPermissionOverride === true) {
      allowed = targetRole !== 'SUPERADMIN' || actorRole === 'SUPERADMIN';
    } else if (actorRole === 'SUPERADMIN') {
      allowed = true;
    } else if (actorRole === 'ADMIN') {
      allowed = targetRole === 'MANAGER' || targetRole === 'ASESOR';
    }

    if (!allowed) {
      return c.json(
        { error: 'No tienes permisos suficientes para modificar los datos sensibles de este usuario.' },
        403
      );
    }
  }

  // Only the Superadmin may grant or revoke administrator status.
  if (role !== undefined && String(role).toUpperCase() === 'ADMIN' && targetRow.role !== 'ADMIN' && currentUser.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede designar administradores.' }, 403);
  }
  if (targetRow.role === 'ADMIN' && role !== undefined && String(role).toUpperCase() !== 'ADMIN' && currentUser.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede modificar el rol de un administrador.' }, 403);
  }
  // Exactly one Superadmin: the role cannot be assigned through user management.
  if (role !== undefined && String(role).toUpperCase() === 'SUPERADMIN' && targetRow.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo puede existir un Superadmin. Este rol no puede asignarse a otras cuentas.' }, 403);
  }
  if (targetRow.role === 'SUPERADMIN' && role !== undefined && String(role).toUpperCase() !== 'SUPERADMIN') {
    return c.json({ error: 'No se puede degradar al único Superadmin.' }, 403);
  }

  const now = new Date().toISOString();
  const newHash = password ? await hashPassword(password) : targetRow.password_hash;
  const overrideVal =
    hasSensitiveEditPermissionOverride !== undefined
      ? hasSensitiveEditPermissionOverride
        ? 1
        : 0
      : targetRow.has_sensitive_edit_override;

  await c.env.DB.prepare(
    `UPDATE users SET name = ?, last_name = ?, email = ?, phone = ?, role = ?, active = ?, is_verified = ?,
     address = ?, city = ?, province = ?, country = ?, avatar = ?, password_hash = ?, has_sensitive_edit_override = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      name !== undefined ? name : targetRow.name,
      lastName !== undefined ? lastName : targetRow.last_name,
      email !== undefined ? String(email).trim().toLowerCase() : targetRow.email,
      phone !== undefined ? phone : targetRow.phone,
      role !== undefined ? String(role).toUpperCase() : targetRow.role,
      active !== undefined ? (active ? 1 : 0) : targetRow.active,
      isVerified !== undefined ? (isVerified ? 1 : 0) : targetRow.is_verified,
      address !== undefined ? address : targetRow.address,
      city !== undefined ? city : targetRow.city,
      province !== undefined ? province : targetRow.province,
      country !== undefined ? country : targetRow.country,
      avatar !== undefined ? avatar : targetRow.avatar,
      newHash,
      overrideVal,
      now,
      id
    )
    .run();

  if (active === false) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  await createAudit(
    c.env.DB,
    currentUser.id,
    `Modificó usuario ${updated.name} ${updated.last_name}`,
    'User',
    id,
    `${updated.name} ${updated.last_name}`
  );
  return c.json(mapUserRow(updated, false));
});

app.post('/api/users/:id/approve', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'Solo Administradores o Superadmin pueden aprobar cuentas.' }, 403);
  }
  const { id } = c.req.param();
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!target) {
    return c.json({ error: 'Usuario no encontrado.' }, 404);
  }
  await c.env.DB.prepare('UPDATE users SET is_verified = 1, active = 1, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();
  await createAudit(
    c.env.DB,
    auth.user.id,
    `Aprobó y verificó la cuenta de ${target.name} ${target.last_name}`,
    'User',
    id,
    `${target.name} ${target.last_name}`
  );
  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  return c.json({ success: true, user: mapUserRow(updated, false) });
});

app.delete('/api/users/:id', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json(
      { error: 'Solo el Superadmin puede eliminar usuarios de la base de datos de forma definitiva.' },
      403
    );
  }
  const { id } = c.req.param();
  if (id === auth.user.id || id === auth.realUser.id) {
    return c.json({ error: 'No puedes eliminar tu propia cuenta de Superadmin.' }, 400);
  }
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!target) {
    return c.json({ error: 'Usuario destino no encontrado.' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await createAudit(
    c.env.DB,
    auth.user.id,
    `Eliminó de forma permanente al usuario ${target.name} ${target.last_name} (${target.role})`,
    'User',
    id,
    `${target.name} ${target.last_name}`
  );
  return c.json({
    success: true,
    message: `Usuario ${target.name} ${target.last_name} eliminado definitivamente.`,
  });
});

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

// ============================================================================
// 7. Cases (Expedientes / Legajos) & Participants
// ============================================================================
// Advisor statistics use persisted cases and audit events, never client-supplied scores.
// Personal activity feed: scoped to the authenticated advisor, never arbitrary user input.
app.get('/api/cases/my-activity', async (c) => {
  const auth = c.get('auth')!;
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.user_name, a.user_role, a.action, a.entity_type,
            a.entity_name, a.created_at,
            CASE WHEN a.entity_type = 'Case' THEN a.entity_id
                 WHEN a.entity_type = 'Document' THEN d.case_id
                 WHEN a.entity_type = 'Observation' THEN o.case_id
                 WHEN a.entity_type = 'Participant' THEN p.case_id END AS case_id
     FROM audit_logs a
     LEFT JOIN documents d ON a.entity_type = 'Document' AND a.entity_id = d.id
     LEFT JOIN observations o ON a.entity_type = 'Observation' AND a.entity_id = o.id
     LEFT JOIN case_participants p ON a.entity_type = 'Participant' AND a.entity_id = p.id
     WHERE (a.entity_type = 'Case' AND a.entity_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
        OR (a.entity_type = 'Document' AND d.case_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
        OR (a.entity_type = 'Observation' AND o.case_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
        OR (a.entity_type = 'Participant' AND p.case_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
     ORDER BY a.created_at DESC, a.id DESC LIMIT 50`
  ).bind(auth.user.id, auth.user.id, auth.user.id, auth.user.id).all<any>();
  return c.json((rows.results || []).map((row: any) => ({
    id: row.id, userName: row.user_name, userRole: row.user_role,
    action: row.action, entityType: row.entity_type,
    entityName: row.entity_name, createdAt: row.created_at, caseId: row.case_id
  })));
});

// Team-level statistics: only users with statistics.manage may inspect other advisors.
app.get('/api/statistics/advisors', async (c) => {
  const auth = c.get('auth')!;
  const { hasRbacPermission } = await import('../src/rbac');
  const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
  if (!hasRbacPermission(matrix, auth.user.role, auth.user.id, 'statistics.manage')) {
    return c.json({ error: 'No tiene permiso para consultar estadísticas del equipo.' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT u.id AS advisorId, u.name AS name, u.last_name AS lastName,
       COUNT(cs.id) AS total,
       SUM(CASE WHEN cs.status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN cs.status = 'observed' THEN 1 ELSE 0 END) AS observed,
       SUM(CASE WHEN cs.status = 'pending_review' THEN 1 ELSE 0 END) AS pendingReview,
       SUM(CASE WHEN cs.status = 'active' THEN 1 ELSE 0 END) AS active
     FROM users u LEFT JOIN cases cs ON cs.assigned_advisor_id = u.id
     WHERE u.role = 'ASESOR'
     GROUP BY u.id, u.name, u.last_name ORDER BY total DESC, u.name ASC`
  ).all<any>();
  const advisors = await Promise.all((rows.results || []).map(async (row: any) => {
    const total = Number(row.total || 0);
    const completed = Number(row.completed || 0);
    const observed = Number(row.observed || 0);
    const resolved = completed + observed;
    const rejected = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM documents d JOIN cases cs ON cs.id = d.case_id WHERE cs.assigned_advisor_id = ? AND d.status = 'rejected'`
    ).bind(row.advisorId).first<{ count: number }>();
    const rejectedDocuments = Number(rejected?.count || 0);
    // Transparent descriptive index. Do not present as a definitive personnel assessment.
    // 60% completed vs observed; 25% avoidance of rejected documents per case;
    // 15% proportion of cases without an observed status, excluding active work.
    const completionRate = resolved ? completed / resolved : null;
    const documentQuality = total ? Math.max(0, 1 - rejectedDocuments / total) : null;
    const observedAvoidance = resolved ? 1 - observed / resolved : null;
    const score = completionRate === null || documentQuality === null || observedAvoidance === null
      ? null : Math.round(100 * (0.6 * completionRate + 0.25 * documentQuality + 0.15 * observedAvoidance));
    const grade = score === null ? 'Sin datos' : score >= 95 ? 'Excelente' : score >= 85 ? 'Muy bueno' : score >= 70 ? 'Bueno' : score >= 55 ? 'Regular' : score >= 35 ? 'Deficiente' : 'Crítico';
    return {
      ...row, total, completed, observed, rejectedDocuments,
      pendingReview: Number(row.pendingReview || 0), active: Number(row.active || 0),
      score, grade, sampleSize: resolved,
      factors: { completionRate: completionRate === null ? null : Math.round(completionRate * 100), documentQuality: documentQuality === null ? null : Math.round(documentQuality * 100), observedAvoidance: observedAvoidance === null ? null : Math.round(observedAvoidance * 100) }
    };
  }));
  return c.json({
    advisors,
    methodology: 'Índice descriptivo: 60% finalizados/(finalizados+observados), 25% máximo(0,1-documentos rechazados/legajos), 15% legajos no observados/(finalizados+observados). Sin legajos resueltos no se califica.',
    note: 'Índice orientativo, no evaluación laboral definitiva: una observación puede depender del cliente o del responsable. No mide demoras atribuibles individualmente ni reemplaza la revisión humana.'
  });
});

app.get('/api/cases/advisor-statistics', async (c) => {
  const auth = c.get('auth')!;
  const requestedAdvisor = c.req.query('advisorId') || auth.user.id;
  const { hasRbacPermission } = await import('../src/rbac');
  const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
  const own = requestedAdvisor === auth.user.id;
  const permission: 'statistics.view' | 'statistics.manage' = own ? 'statistics.view' : 'statistics.manage';
  if (!hasRbacPermission(matrix, auth.user.role, auth.user.id, permission)) {
    return c.json({ error: 'No tiene permiso para consultar estas estadísticas.' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT assigned_advisor_id AS advisorId,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'observed' THEN 1 ELSE 0 END) AS observed,
       SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pendingReview,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'pending_assignment' THEN 1 ELSE 0 END) AS pendingAssignment,
       ROUND(AVG(CASE WHEN status = 'completed' AND julianday(updated_at) >= julianday(created_at)
         THEN (julianday(updated_at) - julianday(created_at)) * 24 END), 1) AS averageCompletedHours,
       MIN(CASE WHEN status = 'completed' THEN created_at END) AS firstCompletedCaseCreatedAt,
       MAX(CASE WHEN status = 'completed' THEN updated_at END) AS lastCompletedCaseUpdatedAt
     FROM cases WHERE assigned_advisor_id = ? GROUP BY assigned_advisor_id`
  ).bind(requestedAdvisor).first<any>();
  const summary = rows || { advisorId: requestedAdvisor, total: 0, completed: 0, observed: 0, pendingReview: 0, active: 0, pendingAssignment: 0, averageCompletedHours: null, firstCompletedCaseCreatedAt: null, lastCompletedCaseUpdatedAt: null };
  const completionEvents = await c.env.DB.prepare(
    `SELECT cs.id AS caseId, cs.created_at AS createdAt, MIN(a.created_at) AS completedAt
     FROM cases cs JOIN audit_logs a ON a.entity_type = 'Case'
       AND a.entity_id = cs.id AND a.action = 'Finalizó legajo'
     WHERE cs.assigned_advisor_id = ? AND cs.status = 'completed'
     GROUP BY cs.id, cs.created_at`
  ).bind(requestedAdvisor).all<any>();
  const durations = (completionEvents.results || [])
    .map((row: any) => (Date.parse(row.completedAt) - Date.parse(row.createdAt)) / 3600000)
    .filter((hours: number) => Number.isFinite(hours) && hours >= 0);
  const averageCompletedHours = durations.length
    ? Math.round(durations.reduce((sum: number, hours: number) => sum + hours, 0) / durations.length * 10) / 10
    : null;
  return c.json({
    ...summary,
    averageCompletedHours,
    completedCasesWithAudit: durations.length,
    note: 'Tiempo desde la creación hasta el primer evento auditado de finalización. Solo incluye legajos con evento registrado; no mide responsabilidad individual ni constituye calificación de desempeño.'
  });
});

// Drafts are private, incomplete forms; they never create cases, tasks or notifications.
app.get('/api/case-drafts', async (c) => {
  const auth = c.get('auth')!;
  const rows = await c.env.DB.prepare('SELECT id, payload_json, created_at, updated_at FROM case_drafts WHERE owner_id = ? ORDER BY updated_at DESC').bind(auth.user.id).all<any>();
  return c.json((rows.results || []).map(row => ({ id: row.id, ...JSON.parse(row.payload_json), createdAt: row.created_at, updatedAt: row.updated_at })));
});
app.put('/api/case-drafts/:id', async (c) => {
  const auth = c.get('auth')!;
  const id = c.req.param('id');
  if (!/^draft-[a-zA-Z0-9-]{8,100}$/.test(id)) return c.json({error:'Identificador de borrador inválido'},400);
  const payload = await c.req.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 250000) return c.json({error:'Datos de borrador inválidos'},400);
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO case_drafts (id, owner_id, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
    WHERE case_drafts.owner_id = excluded.owner_id`).bind(id,auth.user.id,JSON.stringify(payload),now,now).run();
  const row = await c.env.DB.prepare('SELECT id FROM case_drafts WHERE id = ? AND owner_id = ?').bind(id,auth.user.id).first();
  if (!row) return c.json({error:'No tenés acceso a este borrador'},403);
  return c.json({id,updatedAt:now});
});
app.delete('/api/case-drafts/:id', async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('DELETE FROM case_drafts WHERE id = ? AND owner_id = ?').bind(c.req.param('id'),auth.user.id).run();
  return c.json({ok:true});
});

app.get('/api/cases', async (c) => {
  const cases = await getAllCases(c.env.DB);
  return c.json(cases);
});

app.post('/api/cases', async (c) => {
  const auth = c.get('auth')!;
  const body = await c.req.json();
  const {
    title,
    description,
    templateId,
    assignedAdvisorId,
    assignedManagerId,
    participants,
    documentContent,
    pendingDocumentNames,
    generalFieldValues,
  } = body;

  if (!templateId || String(templateId).startsWith('doc-') || String(templateId).startsWith('tmpl-dig-')) {
    return c.json({ error: 'Seleccione un tipo de proceso configurado por un responsable. Los documentos digitalizados no son procesos.' }, 400);
  }
  let template = templateId ? await findTemplateOrVirtualById(c.env, templateId) : null;
  if (template?.originalDocumentContent) return c.json({ error: 'Un documento digitalizado no es un proceso operativo.' }, 400);
  if (!template) {
    if (!templateId) {
      const activeIndustry = await getSystemConfigValue<string>(c.env.DB, 'activeIndustry', 'Inmobiliaria');
      template = {
        id: '',
        name: 'Sin Plantilla',
        description: 'Proceso personalizado sin plantilla predefinida',
        industry: activeIndustry as ProcessTemplate['industry'],
        stages: [
          {
            id: 'stage-default',
            name: 'Revisión General',
            description: 'Etapa inicial de carga y validación de documentos',
            requirements: [],
          },
        ],
        originalDocumentContent: '',
      };
    } else {
      return c.json({ error: 'Plantilla de proceso no encontrada o documento no válido.' }, 404);
    }
  }

  if (!title?.trim() || !templateId || !template?.stages?.length) {
    return c.json({ error: 'Debe seleccionar un proceso configurado con al menos una etapa.' }, 400);
  }
  // Older digitized processes imported actor fields as tasks, not actor requirements.
  const importedRoles = new Set<string>();
  for (const req of template.stages.flatMap(stage => stage.requirements)) {
    if (req.type !== 'task' || !/CAMPO_\\d+/i.test(req.name)) continue;
    const prefix = String(req.name).split(' — ')[0].normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
    if (/^locador(?:es)?$/.test(prefix)) importedRoles.add('Locador');
    if (/^locatario(?:s)?$/.test(prefix)) importedRoles.add('Locatario');
    if (/^garante(?:s)?$/.test(prefix)) importedRoles.add('Garante');
    if (/^vendedor(?:es)?$/.test(prefix)) importedRoles.add('Vendedor');
    if (/^comprador(?:es)?$/.test(prefix)) importedRoles.add('Comprador');
  }
  for (const role of importedRoles) {
    if (!(Array.isArray(participants) ? participants : []).some((p:any) => p.role === role && p.name?.trim() && p.lastName?.trim() && p.dni?.trim()))
      return c.json({error:'Falta cargar el actor requerido: '+role},400);
  }
  const actorRequirements = template.stages.flatMap(stage => stage.requirements).filter(req => req.type === 'actor' && req.isRequired);
  for (const req of actorRequirements) {
    const count = (Array.isArray(participants) ? participants : []).filter((p: any) => p.role === req.actorRole && p.name?.trim() && p.lastName?.trim() && p.dni?.trim()).length;
    const min = Math.max(1, Number(req.minQuantity) || 1);
    if (count < min) return c.json({ error: `Faltan actores obligatorios: ${req.actorRole || req.name} (${count}/${min}).` }, 400);
  }

  const caseId = `case-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const code = `EXP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const finalManagerId = assignedManagerId || '';
  const requiredDocNames = template.stages.flatMap(stage => stage.requirements).filter(req => req.type === 'document' && req.isRequired).map(req => req.name);
  // Client-declared pending documents are advisory until uploads are verified in R2.
  const pendingNames = Array.isArray(pendingDocumentNames) ? pendingDocumentNames.filter((name: unknown) => typeof name === 'string' && requiredDocNames.some(reqName => (name as string).startsWith(reqName + ' — '))) : [];
  const status = pendingNames.length ? 'observed' : (finalManagerId ? 'active' : 'pending_assignment');
  const finalAdvisorId = assignedAdvisorId || auth.user.id;
  const now = new Date().toISOString();
  const finalDocContent = documentContent || template.originalDocumentContent || '';
  const showDoc = template.showDocumentToAll !== undefined ? (template.showDocumentToAll ? 1 : 0) : 1;
  const viewMode = template.sharedViewMode || 'both';

  await c.env.DB.prepare(
    `INSERT INTO cases (id, code, title, description, status, template_id, current_stage_index, assigned_advisor_id, assigned_manager_id, document_content, show_document_to_all, shared_view_mode, is_current_stage_approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      caseId,
      code,
      title,
      description || '',
      status,
      templateId || '',
      finalAdvisorId,
      finalManagerId,
      finalDocContent,
      showDoc,
      viewMode,
      now,
      now
    )
    .run();

  if (Array.isArray(participants) && participants.length > 0) {
    const pStmts = participants.map((p: any) =>
      c.env.DB.prepare(
        `INSERT INTO case_participants (id, case_id, name, last_name, dni, cuit_cuil, email, phone, birth_date, role, comments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        p.id || `prt-${crypto.randomUUID().slice(0, 8)}`,
        caseId,
        p.name || '',
        p.lastName || '',
        p.dni || '',
        p.cuitCuil || '',
        p.email || '',
        p.phone || '',
        p.birthDate || null,
        p.role || 'Vendedor',
        p.comments || ''
      )
    );
    await c.env.DB.batch(pStmts);
    const allowedFields = new Set(template.stages.flatMap(st => st.requirements).map(req => (String(req.name).match(/CAMPO_\\d+/i) || [])[0]).filter(Boolean));
    const values = participants.flatMap((p:any) => Object.entries(p.fieldValues || {}).filter(([fieldId,value]) => allowedFields.has(fieldId) && typeof value === 'string' && value.length <= 5000).map(([fieldId,value]) => ({participantId:p.id,fieldId,value})));
    if (values.length) await c.env.DB.batch(values.map((v:any) => c.env.DB.prepare('INSERT INTO case_field_values (case_id, participant_id, field_id, value) VALUES (?, ?, ?, ?)').bind(caseId,v.participantId,v.fieldId,v.value)));
  }

  if (generalFieldValues && typeof generalFieldValues === 'object' && !Array.isArray(generalFieldValues)) {
    const allowedFields = new Set(template.stages.flatMap(st => st.requirements).map(req => (String(req.name).match(/CAMPO_\d+/i) || [])[0]).filter(Boolean));
    const values = Object.entries(generalFieldValues).filter(([id,value]) => allowedFields.has(id) && typeof value === 'string' && value.length <= 5000);
    if (values.length) await c.env.DB.batch(values.map(([id,value]) => c.env.DB.prepare('INSERT INTO case_field_values (case_id, participant_id, field_id, value) VALUES (?, ?, ?, ?)').bind(caseId,'__operation__',id,value)));
  }

  const currentStage = template.stages[0];
  if (currentStage) {
    const tStmts = currentStage.requirements
      .filter((r) => r.type === 'task')
      .map((reqObj) =>
        c.env.DB.prepare(
          `INSERT INTO tasks (id, case_id, stage_id, requirement_id, name, description, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(
          `tsk-${Date.now()}-${crypto.randomUUID().slice(0, 5)}`,
          caseId,
          currentStage.id,
          reqObj.id,
          reqObj.name,
          reqObj.description || ''
        )
      );
    if (tStmts.length > 0) {
      await c.env.DB.batch(tStmts);
    }
  }

  await createAudit(
    c.env.DB,
    auth.user.id,
    pendingNames.length ? `Legajo creado OBSERVADO: ${pendingNames.length} documentos pendientes (${pendingNames.join('; ')})` : status === 'pending_assignment' ? 'Solicitud de legajo creada' : 'Legajo creado',
    'Case',
    caseId,
    title
  );

  if (finalAdvisorId) {
    await createNotification(
      c.env.DB,
      finalAdvisorId,
      'Nuevo Legajo Creado',
      `Tu legajo ${code}: "${title}" fue registrado.`,
      'info',
      caseId
    );
  }

  if (status === 'pending_assignment') {
    const managers = await c.env.DB.prepare(
      "SELECT id FROM users WHERE role IN ('MANAGER', 'ADMIN', 'SUPERADMIN') AND active = 1"
    ).all<{ id: string }>();
    await dispatchQueueJob(c.env, {
      type: 'notification_fanout',
      payload: {
        userIds: (managers.results || []).map((m) => m.id),
        title: 'Nueva Solicitud de Legajo',
        message: `El asesor solicita iniciar el legajo ${code}: "${title}". Disponible para asignar.`,
        notifType: 'warning',
        caseId,
      },
    });
  } else if (finalManagerId) {
    await createNotification(
      c.env.DB,
      finalManagerId,
      'Legajo Asignado',
      `Se te asignó el legajo ${code}: "${title}".`,
      'info',
      caseId
    );
  }

  const created = await getCaseById(c.env.DB, caseId);
  return c.json(created, 201);
});

app.post('/api/cases/:id/assign-manager', async (c) => {
  const auth = c.get('auth')!;
  if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para asignar Managers.' }, 403);
  }
  const { id } = c.req.param();
  const { managerId } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Expediente no encontrado' }, 404);

  const manager = await c.env.DB.prepare(
    "SELECT * FROM users WHERE id = ? AND role IN ('MANAGER', 'ADMIN', 'SUPERADMIN')"
  )
    .bind(managerId)
    .first<any>();
  if (!manager) {
    return c.json({ error: 'Usuario especificado no es un Manager/Responsable válido.' }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE cases SET assigned_manager_id = ?, status = 'active', updated_at = ? WHERE id = ?"
  )
    .bind(managerId, new Date().toISOString(), id)
    .run();

  await createAudit(c.env.DB, auth.user.id, 'Asignó manager a legajo', 'Case', id, caseObj.title);
  await createNotification(
    c.env.DB,
    caseObj.assignedAdvisorId,
    'Manager Asignado',
    `El manager ${manager.name} ${manager.last_name} ha sido asignado a tu legajo.`,
    'success',
    id
  );
  await createNotification(
    c.env.DB,
    managerId,
    'Nuevo Legajo Asignado',
    `Has sido asignado al legajo ${caseObj.code}: "${caseObj.title}".`,
    'info',
    id
  );

  return c.json(await getCaseById(c.env.DB, id));
});

app.post('/api/cases/:id/request-review', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { note } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado.' }, 404);

  const templateForReview = await findTemplateOrVirtualById(c.env, caseObj.templateId);
  const stageForReview = templateForReview?.stages?.[caseObj.currentStageIndex];
  if (!stageForReview) return c.json({ error: 'El proceso no tiene una etapa válida.' }, 400);
  const validationForReview = await validateStageRequirements(c.env.DB, id, stageForReview.id, templateForReview!, 'submission');
  if (!validationForReview.isValid) return c.json({ error: 'Requisitos obligatorios pendientes', reasons: validationForReview.missing }, 400);

  await c.env.DB.prepare("UPDATE cases SET status = 'pending_review', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();

  if (caseObj.assignedManagerId) {
    const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
    const stageName = template?.stages?.[caseObj.currentStageIndex]?.name || 'Etapa actual';
    await createNotification(
      c.env.DB,
      caseObj.assignedManagerId,
      'Revisión de Etapa Solicitada',
      `El asesor ${auth.user.name} ${auth.user.lastName} ha completado el trabajo de la etapa "${stageName}" en el legajo "${caseObj.title}" y solicita su revisión.${note ? ` Nota: "${note}"` : ''}`,
      'info',
      caseObj.id
    );
  }

  await createAudit(c.env.DB, auth.user.id, 'Solicitó revisión de la etapa actual al Manager', 'Case', caseObj.id, caseObj.title);
  return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
});

app.post('/api/cases/:id/request-reassignment', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { reason } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado.' }, 404);

  const msgId = `msg-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const subject = `Solicitud de Reasignación: Legajo "${caseObj.title}"`;
  const content = `El Manager ${auth.user.name} ${auth.user.lastName} solicita reasignar o liberar el legajo "${caseObj.title}" (ID: ${caseObj.id}).

Motivo:
"${reason}"`;

  await c.env.DB.prepare(
    `INSERT INTO system_messages (id, sender_id, sender_name, sender_role, receiver_id, receiver_name, receiver_role, subject, content, created_at, read, deleted_by_sender, deleted_by_receiver, permanent_deleted_by_sender, permanent_deleted_by_receiver)
     VALUES (?, ?, ?, ?, 'system', 'Sistema de Reasignaciones', 'SYSTEM', ?, ?, ?, 0, 0, 0, 0, 0)`
  )
    .bind(
      msgId,
      auth.user.id,
      `${auth.user.name} ${auth.user.lastName}`,
      auth.user.role,
      subject,
      content,
      now
    )
    .run();

  const admins = await c.env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('SUPERADMIN', 'ADMIN') AND active = 1"
  ).all<{ id: string }>();

  await dispatchQueueJob(c.env, {
    type: 'notification_fanout',
    payload: {
      userIds: (admins.results || []).map((a) => a.id),
      title: 'Solicitud de Reasignación',
      message: `El manager ${auth.user.name} ha solicitado reasignar el legajo "${caseObj.title}".`,
      notifType: 'warning',
      caseId: caseObj.id,
    },
  });

  await createAudit(c.env.DB, auth.user.id, 'Solicitó reasignación / liberación del legajo', 'Case', caseObj.id, caseObj.title);
  return c.json({
    success: true,
    message: {
      id: msgId,
      senderId: auth.user.id,
      senderName: `${auth.user.name} ${auth.user.lastName}`,
      senderRole: auth.user.role,
      receiverId: 'system',
      receiverName: 'Sistema de Reasignaciones',
      receiverRole: 'SYSTEM',
      subject,
      content,
      createdAt: now,
      read: false,
      attachments: [],
    },
  });
});

app.put('/api/cases/:id', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const body = await c.req.json();
  const oldCase = await getCaseById(c.env.DB, id);
  if (!oldCase) return c.json({ error: 'Legajo no encontrado' }, 404);

  const now = new Date().toISOString();
  const updatedTitle = body.title || oldCase.title;
  const updatedAdvisor = body.assignedAdvisorId || oldCase.assignedAdvisorId;

  await c.env.DB.prepare(
    `UPDATE cases SET title = ?, description = ?, assigned_advisor_id = ?, status = ?, document_content = ?,
     show_document_to_all = ?, shared_view_mode = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      updatedTitle,
      body.description || oldCase.description,
      updatedAdvisor,
      body.status || oldCase.status,
      body.documentContent !== undefined ? body.documentContent : oldCase.documentContent || '',
      body.showDocumentToAll !== undefined
        ? body.showDocumentToAll
          ? 1
          : 0
        : oldCase.showDocumentToAll !== false
          ? 1
          : 0,
      body.sharedViewMode !== undefined ? body.sharedViewMode : oldCase.sharedViewMode || 'both',
      now,
      id
    )
    .run();

  if (body.assignedAdvisorId && body.assignedAdvisorId !== oldCase.assignedAdvisorId) {
    await createNotification(
      c.env.DB,
      body.assignedAdvisorId,
      'Legajo Reasignado',
      `Se te reasignó el legajo ${oldCase.code}: "${updatedTitle}"`,
      'info',
      id
    );
  }

  await createAudit(c.env.DB, auth.user.id, body.auditAction || 'Legajo actualizado', 'Case', id, updatedTitle);
  return c.json(await getCaseById(c.env.DB, id));
});

app.delete('/api/cases/:id', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede eliminar legajos.' }, 403);
  }
  const { id } = c.req.param();
  const existing = await getCaseById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Legajo no encontrado.' }, 404);

  // Clean up R2 objects belonging to case documents
  const vers = await c.env.DB.prepare(
    `SELECT dv.r2_key FROM document_versions dv
     JOIN documents d ON d.id = dv.document_id
     WHERE d.case_id = ? AND dv.r2_key IS NOT NULL`
  )
    .bind(id)
    .all<{ r2_key: string }>();

  for (const v of vers.results || []) {
    await c.env.R2_BUCKET.delete(v.r2_key);
  }

  await c.env.DB.prepare('DELETE FROM notifications WHERE case_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM case_field_values WHERE case_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, 'Legajo eliminado permanentemente', 'Case', id, existing.title);
  return c.json({ success: true, id });
});

app.post('/api/cases/:id/participants', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const p = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const partId = p.id || `prt-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  await c.env.DB.prepare(
    `INSERT INTO case_participants (id, case_id, name, last_name, dni, cuit_cuil, email, phone, birth_date, role, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      partId,
      id,
      p.name || '',
      p.lastName || '',
      p.dni || '',
      p.cuitCuil || '',
      p.email || '',
      p.phone || '',
      p.birthDate || null,
      p.role || 'Vendedor',
      p.comments || ''
    )
    .run();

  await c.env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Añadió el actor ${p.name} ${p.lastName} (Rol: ${p.role || 'Vendedor'})`,
    'Case',
    id,
    caseObj.title
  );
  return c.json(await getCaseById(c.env.DB, id));
});

app.put('/api/cases/:id/participants/:participantId', async (c) => {
  const auth = c.get('auth')!;
  const { id, participantId } = c.req.param();
  const p = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const oldPart = await c.env.DB.prepare(
    'SELECT * FROM case_participants WHERE id = ? AND case_id = ?'
  )
    .bind(participantId, id)
    .first<any>();
  if (!oldPart) return c.json({ error: 'Actor no encontrado en el legajo' }, 404);

  const nextName = p.name !== undefined ? p.name : oldPart.name;
  const nextLast = p.lastName !== undefined ? p.lastName : oldPart.last_name;
  const nextRole = p.role !== undefined ? p.role : oldPart.role;

  await c.env.DB.prepare(
    `UPDATE case_participants SET name = ?, last_name = ?, dni = ?, cuit_cuil = ?, email = ?, phone = ?, birth_date = ?, role = ?, comments = ?
     WHERE id = ? AND case_id = ?`
  )
    .bind(
      nextName,
      nextLast,
      p.dni !== undefined ? p.dni : oldPart.dni,
      p.cuitCuil !== undefined ? p.cuitCuil : oldPart.cuit_cuil,
      p.email !== undefined ? p.email : oldPart.email,
      p.phone !== undefined ? p.phone : oldPart.phone,
      p.birthDate !== undefined ? p.birthDate : oldPart.birth_date,
      nextRole,
      p.comments !== undefined ? p.comments : oldPart.comments,
      participantId,
      id
    )
    .run();

  await c.env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Modificó datos del actor ${nextName} ${nextLast} (Rol: ${nextRole})`,
    'Case',
    id,
    caseObj.title
  );
  return c.json(await getCaseById(c.env.DB, id));
});

app.delete('/api/cases/:id/participants/:participantId', async (c) => {
  const auth = c.get('auth')!;
  const { id, participantId } = c.req.param();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const oldPart = await c.env.DB.prepare(
    'SELECT * FROM case_participants WHERE id = ? AND case_id = ?'
  )
    .bind(participantId, id)
    .first<any>();

  await c.env.DB.prepare('DELETE FROM case_field_values WHERE case_id = ? AND participant_id = ?').bind(id,participantId).run();
  await c.env.DB.prepare('DELETE FROM case_participants WHERE id = ? AND case_id = ?')
    .bind(participantId, id)
    .run();

  await c.env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    oldPart
      ? `Eliminó el actor ${oldPart.name} ${oldPart.last_name} (Rol: ${oldPart.role || 'Actor'})`
      : 'Eliminó un actor del legajo',
    'Case',
    id,
    caseObj.title
  );
  return c.json(await getCaseById(c.env.DB, id));
});

app.post('/api/cases/:id/reopen', async (c) => {
  const auth = c.get('auth')!;
  if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para reabrir legajos.' }, 403);
  }
  const { id } = c.req.param();
  const { password } = await c.req.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) return c.json({ error: 'Ingrese su contraseña.' }, 400);
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado.' }, 404);
  if (caseObj.status !== 'completed') return c.json({ error: 'El legajo no está finalizado.' }, 409);
  if (auth.user.role === 'MANAGER' && caseObj.assignedManagerId !== auth.user.id) {
    return c.json({ error: 'Solo el manager responsable puede reabrir este legajo.' }, 403);
  }
  const userRow = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ? AND active = 1').bind(auth.user.id).first<{ password_hash: string }>();
  const rateKey = `reopen:${getClientIp(c.req.raw)}:${auth.user.id}`;
  const rateCheck = await checkLoginRateLimit(c.env, rateKey);
  if (!rateCheck.allowed) return c.json({ error: 'Demasiados intentos. Intente nuevamente más tarde.' }, 429);
  if (!userRow || !(await verifyPassword(password, userRow.password_hash))) {
    await recordFailedLoginAttempt(c.env, rateKey);
    return c.json({ error: 'Contraseña incorrecta.' }, 401);
  }
  await c.env.DB.prepare("UPDATE cases SET status = 'active', is_current_stage_approved = 1, updated_at = ? WHERE id = ? AND status = 'completed'")
    .bind(new Date().toISOString(), id).run();
  await createAudit(c.env.DB, auth.user.id, 'Reabrió legajo con validación de contraseña', 'Case', id, caseObj.title);
  return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
});


/** Confecciones: persistent, independent copies of finalized case templates. */
async function ensureConfecciones(db: Env['DB']) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS confecciones (
    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, template_id TEXT NOT NULL,
    title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    last_field_number INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS confeccion_chat (
    id TEXT PRIMARY KEY, confeccion_id TEXT NOT NULL, sender TEXT NOT NULL,
    message TEXT NOT NULL, created_at TEXT NOT NULL
  )`).run();
}
const confeccionesRoles = ['SUPERADMIN', 'ADMIN', 'MANAGER'];
app.get('/api/confecciones', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const rows = await c.env.DB.prepare(`SELECT f.*, cs.code AS case_code, cs.title AS case_title
    FROM confecciones f JOIN cases cs ON cs.id = f.case_id WHERE (? != 'MANAGER' OR cs.assigned_manager_id = ?) ORDER BY f.updated_at DESC`).bind(auth.user.role, auth.user.id).all();
  return c.json(rows.results || []);
});
app.get('/api/confecciones/:id/chat', async (c) => {
  const auth=c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({error:'No autorizado.'},403);
  await ensureConfecciones(c.env.DB);
  const row=await c.env.DB.prepare('SELECT case_id FROM confecciones WHERE id = ?').bind(c.req.param('id')).first<{case_id:string}>();
  if (!row) return c.json({error:'Confección inexistente.'},404);
  const caseObj=await getCaseById(c.env.DB,row.case_id);
  if (!caseObj || (auth.user.role==='MANAGER' && caseObj.assignedManagerId!==auth.user.id)) return c.json({error:'No autorizado.'},403);
  const rows=await c.env.DB.prepare('SELECT sender, message FROM confeccion_chat WHERE confeccion_id = ? ORDER BY created_at DESC, id DESC LIMIT 80')
    .bind(c.req.param('id')).all<{sender:string;message:string}>();
  return c.json((rows.results||[]).reverse().map(x=>({from:x.sender,text:x.message})));
});
app.post('/api/confecciones', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  const { caseId, templateId } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, String(caseId || ''));
  if (!caseObj || caseObj.status !== 'completed') return c.json({ error: 'Seleccioná un legajo finalizado.' }, 400);
  if (auth.user.role === 'MANAGER' && caseObj.assignedManagerId !== auth.user.id) return c.json({ error: 'Legajo fuera de tu responsabilidad.' }, 403);
  const template = await findTemplateOrVirtualById(c.env, String(templateId || ''));
  if (!template?.originalDocumentContent?.trim()) return c.json({ error: 'La plantilla no tiene contenido digitalizado.' }, 400);
  // Fill only unambiguous structured attributes whose marker meanings were
  // explicitly saved on this exact digitized template. Never use AI guesses.
  const originalContent = template.originalDocumentContent;
  const participants = Array.isArray(caseObj.participants) ? caseObj.participants as any[] : [];
  const normalized = (v:string) => v.toLocaleLowerCase('es-AR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const roleFor = (v:string):string => {
    const x=normalized(v);
    if(/conyuge|espos/.test(x))return 'spouse';
    if(/locatario|inquilino/.test(x))return 'locatario';
    if(/locador|propietario/.test(x))return 'locador';
    if(/garante|fiador/.test(x))return 'garante';
    return '';
  };
  const keysFor = (v:string):string[] => {
    const x=normalized(v);
    if(x==='dni'||x.includes('documentodeidentidad'))return ['dni','documentNumber','document_number'];
    if(/mail|email|correo/.test(x))return ['email','mail'];
    if(/fechadenacimiento|nacimiento/.test(x))return ['birthDate','birth_date','dateOfBirth','fechaNacimiento'];
    if(/estadocivil/.test(x))return ['maritalStatus','marital_status','estadoCivil'];
    if(/domicilioactual|direccion/.test(x))return ['address','domicilio','domicilioActual'];
    if(/nombreyapellido|nombrecompleto/.test(x))return ['fullName','name','nombreCompleto'];
    return [];
  };
  let content=originalContent;
  for(const field of template.fieldMap||[]){
    if(field.review || !field.label || !field.actor)continue;
    const kind=roleFor(String(field.actor));
    const keys=keysFor(String(field.label));
    if(!kind || !keys.length)continue;
    const candidates=participants.filter(p=>roleFor(String(p.role||p.type||''))===kind);
    if(candidates.length!==1)continue;
    const values=[...new Set(keys.map(k=>candidates[0][k]).filter(v=>typeof v==='string'&&v.trim()))];
    if(values.length!==1)continue;
    const value=String(values[0]).trim();
    if(value.length>2000 || /\[CAMPO_\d+\*?\]/.test(value))continue;
    content=content.split(field.id).join(value);
  }
  const lastField = Math.max(0, ...Array.from(originalContent.matchAll(/\[CAMPO_(\d+)\*?\]/g), m => Number(m[1])));
  await ensureConfecciones(c.env.DB);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO confecciones
    (id, case_id, template_id, title, content, status, last_field_number, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
    .bind(id, caseObj.id, template.id, template.name + ' — ' + caseObj.title, content, lastField, auth.user.id, now, now).run();
  await createAudit(c.env.DB, auth.user.id, 'Inició confección', 'Case', caseObj.id, template.name);
  return c.json({ success: true, id }, 201);
});
app.delete('/api/confecciones/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'Confección no encontrada.' }, 404);
  const caseObj = await getCaseById(c.env.DB, row.case_id);
  if (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  await c.env.DB.prepare('DELETE FROM confeccion_chat WHERE confeccion_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM confecciones WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, 'Eliminó definitivamente confección', 'Case', row.case_id, row.title);
  return c.json({ success: true });
});
app.put('/api/confecciones/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!existing) return c.json({ error: 'Confección no encontrada.' }, 404);
  const caseObj = await getCaseById(c.env.DB, existing.case_id);
  if (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  if (existing.status !== 'draft') return c.json({ error: 'La confección está cerrada.' }, 409);
  const body = await c.req.json();
  if (typeof body.content !== 'string' || body.content.length > 500000) return c.json({ error: 'Contenido inválido.' }, 400);
  const maxInText = Math.max(0, ...Array.from(body.content.matchAll(/\[CAMPO_(\d+)\*?\]/g), (m: RegExpMatchArray) => Number(m[1])));
  const lastField = Math.max(existing.last_field_number, maxInText);
  const now = new Date().toISOString();
  await c.env.DB.prepare('UPDATE confecciones SET content = ?, last_field_number = ?, updated_at = ? WHERE id = ?')
    .bind(body.content, lastField, now, id).run();
  return c.json({ success: true, updatedAt: now, lastFieldNumber: lastField });
});
app.post('/api/confecciones/:id/close', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'Confección no encontrada.' }, 404);
  const caseObj = await getCaseById(c.env.DB, row.case_id);
  if (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  if (row.status !== 'draft') return c.json({ error: 'Ya está cerrada.' }, 409);
  if (/\[CAMPO_\d+\*?\]/.test(row.content)) return c.json({ error: 'Quedan campos sin completar. Revisalos antes de cerrar.' }, 409);
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE confecciones SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, id).run();
  await createAudit(c.env.DB, auth.user.id, 'Finalizó confección', 'Case', row.case_id, row.title);
  return c.json({ success: true });
});
app.post('/api/confecciones/:id/agent', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!row || row.status !== 'draft') return c.json({ error: 'Confección inexistente o cerrada.' }, 409);
  const caseObj = await getCaseById(c.env.DB, row.case_id);
  if (!caseObj) return c.json({ error: 'Legajo inexistente.' }, 404);
  if (auth.user.role === 'MANAGER' && caseObj.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  const { instruction, content, conversation } = await c.req.json();
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2500 || typeof content !== 'string' || content.length > 500000) return c.json({ error: 'Instrucción o documento inválido.' }, 400);
  const current = await c.env.DB.prepare('SELECT content FROM confecciones WHERE id = ?').bind(id).first<{content: string}>();
  if (current?.content !== content) return c.json({ error: 'Guardá los cambios del documento antes de consultar al agente.' }, 409);
  const docs = (await getAllDocuments(c.env.DB)).filter(d => d.caseId === caseObj.id)
    .map(d => ({ name: d.name, fileName: d.fileName, status: d.status }));
  // Read actual R2 contents where a safe text extractor is available. Never claim
  // scanned images or unsupported formats were read successfully.
  const documentEvidence: Array<{name:string;status:string;text?:string;note?:string}> = [];
  for (const doc of (await getAllDocuments(c.env.DB)).filter(d=>d.caseId===caseObj.id).slice(0,60)) {
    const entry:{name:string;status:string;text?:string;note?:string} = {name:doc.name,status:doc.status};
    const key=doc.r2Key || doc.versions?.[doc.versions.length-1]?.r2Key;
    const mime=guessMimeType(doc.fileName || doc.name,doc.mimeType);
    if (!key) entry.note='Sin archivo disponible en almacenamiento';
    else if (!/^(text\/plain|application\/json|application\/pdf|application\/vnd.openxmlformats-officedocument.wordprocessingml.document)/.test(mime)) entry.note='Formato pendiente de lectura visual o conversión';
    else {
      try {
        const obj=await c.env.R2_BUCKET.get(key);
        if (!obj) entry.note='Archivo no encontrado';
        else if (obj.size>8_000_000) entry.note='Archivo demasiado grande para extracción directa';
        else {
          const bytes=new Uint8Array(await obj.arrayBuffer());
          const value=mime.includes('wordprocessingml')?extractTextFromDocx(bytes):mime.includes('pdf')?extractTextFromPdf(bytes):new TextDecoder().decode(bytes);
          if(value.trim()) entry.text=value.slice(0,30000);
          else entry.note='No se pudo extraer texto; requiere OCR o revisión manual';
        }
      } catch (e) {
        console.warn('Confecciones attachment extraction failed', {documentId:doc.id,error:e});
        entry.note='Extracción fallida; requiere revisión';
      }
    }
    documentEvidence.push(entry);
  }
  const template = await findTemplateOrVirtualById(c.env, row.template_id);
  // A confección may use a digitized document while the case belongs to an
  // operational process. Prefer the process's reviewed semantic map ONLY when
  // both documents share the exact marker meanings (same original text).
  const processTemplate = caseObj.templateId ? await findTemplateOrVirtualById(c.env,caseObj.templateId) : null;
  const sameSource = Boolean(processTemplate?.originalDocumentContent &&
    processTemplate.originalDocumentContent === template?.originalDocumentContent);
  const authoritativeMap = sameSource && processTemplate?.fieldMap?.length
    ? processTemplate.fieldMap : (template?.fieldMap || []);
  const storedFieldMap = authoritativeMap.filter(f => content.includes(f.id));
  const markers = [...new Set(Array.from(content.matchAll(/\[CAMPO_\d+\*?\]/g), m => m[0]))];
  // Infer each marker's meaning from the original template itself, even when
  // legacy digitizations have no semantic fieldMap.
  const inferField = (field:string) => {
    const at=content.indexOf(field);
    if(at<0)return {id:field,label:'Dato pendiente de identificar',actor:'No determinado'};
    const before=content.slice(Math.max(0,at-700),at);
    const after=content.slice(at+field.length,at+field.length+100);
    const actorMatch=[...before.matchAll(/\b(LOCADOR(?:ES|\/S)?|LOCATARIO(?:S|\/S)?|FIADOR(?:ES|\/S)?|GARANTE(?:S|\/S)?)\s*:/gi)].pop();
    const actorBase=actorMatch?actorMatch[1].toUpperCase():'No determinado';
    const currentLine=before.slice(before.lastIndexOf('\n')+1);
    // A spouse's details belong to a distinct person. The spouse context may
    // span adjacent markers (name, DNI, email) and must not inherit the main actor.
    const sectionTail=actorMatch?before.slice((actorMatch.index||0)+actorMatch[0].length):before;
    const spouseStart=[...sectionTail.matchAll(/(?:NOMBRE\s+Y\s+APELLIDO\s+(?:DEL?\s+)?C[ÓO]NYUGE|DATOS\s+DEL?\s+C[ÓO]NYUGE)\s*:/gi)].pop();
    const spouseContext=spouseStart?sectionTail.slice((spouseStart.index||0)+spouseStart[0].length):'';
    const spouseFields=spouseContext.match(/\[CAMPO_\d+\*?\]/g)||[];
    const actor=spouseStart && spouseFields.length<3 ? 'CÓNYUGE DE '+actorBase : actorBase;
    const labelMatch=[...currentLine.matchAll(/(FECHA DE NACIMIENTO|NOMBRE Y APELLIDO(?: DEL? C[ÓO]NYUGE)?|DOMICILIO ACTUAL|ESTADO CIVIL|DURACI[ÓO]N(?: DEL? CONTRATO)?|MESES DE GRACIA|VALOR DE LA LOCACI[ÓO]N INICIAL|IMPORTE DE MES DE DEP[ÓO]SITO|SERVICIOS? QUE ABONA (?:EL )?(?:LOCADOR|LOCATARIO)|POSESI[ÓO]N|INVENTARIO|AJUSTE|MAIL|DNI|A PARTIR|HASTA|INDICAR)\s*:?\s*$/gi)].pop();
    let label=labelMatch?.[1]||'';
    if(!label){
      const tail=currentLine.split(/[;:]/).pop()?.trim()||'';
      if(tail.length>=3&&tail.length<=65)label=tail;
    }
    if(!label && /^\s*(?:,|\.|;|\n)/.test(after))label='Dato solicitado en el contexto anterior';
    if(actor.startsWith('CÓNYUGE') && !label) label='Dato del cónyuge';
    return {id:field,label:label||'Dato pendiente de identificar',actor};
  };
  const fieldMap=markers.map(field=>{
    const inferred=inferField(field);
    const stored=storedFieldMap.find(f=>f.id===field);
    return {...inferred,...stored,
      label:stored?.label && !/^(pendiente de identificar|sin significado identificado|dato sin identificar)$/i.test(stored.label)?stored.label:inferred.label,
      actor:stored?.actor && !/^(no determinado|por identificar)$/i.test(stored.actor)?stored.actor:inferred.actor};
  });
  // Fill structured actor attributes without an LLM. The semantic map is the
  // source of truth; never substitute a different participant or spouse.
  const normalizeRole = (value:string) => value.toLocaleLowerCase('es-AR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const actorKind = (actor:string):string => {
    const a=normalizeRole(actor);
    if(/conyuge|espos/.test(a))return 'spouse';
    if(/locatario|inquilino/.test(a))return 'locatario';
    if(/locador|propietario/.test(a))return 'locador';
    if(/garante|fiador/.test(a))return 'garante';
    return '';
  };
  const propertyFor = (label:string):string => {
    const v=normalizeRole(label);
    if(/\bdni\b|documentodeidentidad/.test(v))return 'dni';
    if(/\bmail\b|correo|email/.test(v))return 'email';
    if(/fechadenacimiento|nacimiento|fnac/.test(v))return 'birthDate';
    if(/estadocivil/.test(v))return 'maritalStatus';
    if(/domicilioactual|direccion/.test(v))return 'address';
    if(/nombreyapellido|nombrecompleto/.test(v))return 'name';
    return '';
  };
  const structuredProposals:Array<{field:string;value:string;source:string}> = [];
  const actors=Array.isArray(caseObj.participants)?caseObj.participants as any[]:[];
  for(const entry of fieldMap){
    const kind=actorKind(String(entry.actor||''));
    const property=propertyFor(String(entry.label||''));
    if(!kind || kind==='spouse' || !property)continue;
    const matching=actors.filter(p=>actorKind(String(p.role||p.type||''))===kind);
    // Multiple actors of the same role require explicit disambiguation.
    if(matching.length!==1)continue;
    const actor=matching[0];
    const keys:Record<string,string[]>={
      dni:['dni','documentNumber','document_number'],
      email:['email','mail'],birthDate:['birthDate','birth_date','dateOfBirth','fechaNacimiento'],
      maritalStatus:['maritalStatus','marital_status','estadoCivil'],
      address:['address','domicilio','domicilioActual'],
      name:['fullName','name','nombreCompleto']
    };
    const values=(keys[property]||[]).map(k=>actor[k]).filter(v=>typeof v==='string'&&v.trim());
    if(values.length!==1)continue;
    const value=String(values[0]).trim();
    if(value.length>2000 || /\[CAMPO_\d+\*?\]/.test(value))continue;
    structuredProposals.push({field:entry.id,value,source:'Dato estructurado del legajo · '+kind+' · '+property});
  }
  const coverage = (proposed: Array<{field:string;value:string;source:string}>) => {
    const matched = new Set(proposed.map(p => p.field));
    const unresolved = markers.filter(field => !matched.has(field)).map(field => {
      const entry = fieldMap.find(f => f.id === field);
      return {field, label: entry?.label || 'Dato pendiente de identificar', status:'sin_dato_verificado'};
    });
    return {total:markers.length, proposed:matched.size, unresolved:unresolved.length, fields:unresolved};
  };
  const questionFor = (field:string):string => {
    const entry=fieldMap.find(f=>f.id===field);
    const at=content.indexOf(field);
    const preceding=at>=0?content.slice(Math.max(0,at-220),at):'';
    const lastLine=preceding.split(/\r?\n/).pop() || '';
    const suffix=lastLine.split(/[.;]/).pop()?.trim() || '';
    const label=entry?.label && entry.label!=='Pendiente de identificar'
      ? entry.label : (suffix.match(/(?:DNI|MAIL|EMAIL|ESTADO CIVIL|DOMICILIO|FECHA DE NACIMIENTO|NOMBRE Y APELLIDO|CUIT)\s*:?\s*$/i)?.[0] || suffix.slice(-45)).trim();
    const role=entry?.actor || 'actor correspondiente';
    return '¿Me indicás '+(label||'el valor')+' de '+role+' para '+field+'? Podés responder "'+field+' = valor".';
  };
  const missingSummary = () => 'Vamos a completar la plantilla juntos. '+questionFor(markers.find(m=>!structuredProposals.some(p=>p.field===m))||markers[0]);
  if (!markers.length) return c.json({ reply: 'La plantilla no tiene campos pendientes para completar.', replacements: [], pendingFields: 0, coverage:coverage([]) });
  // Deterministic operator entry: a confirmed field/value must not depend on AI availability.
  const directMatch=instruction.match(/^\s*(\[?CAMPO_(\d+)(\*)?\]?)\s*(?:=|:|es\s+)\s*(.+?)\s*$/is);
  if (directMatch) {
    const field='[CAMPO_'+directMatch[2]+(directMatch[3]?'*':'')+']';
    const value=directMatch[4].trim();
    if (!markers.includes(field)) return c.json({reply:'Ese campo no está pendiente en esta plantilla.',replacements:[],pendingFields:markers.length,coverage:coverage([])});
    if (!value || value.length>2000 || /\[CAMPO_\d+\*?\]/.test(value))
      return c.json({reply:'Necesito un valor concreto para '+field+'. '+questionFor(field),replacements:[],pendingFields:markers.length,coverage:coverage([])});
    const proposal={field,value,source:'Respuesta explícita del operador'};
    const next=markers.find(m=>m!==field);
    const reply='Registré una propuesta para '+field+'. Revisala y aplicala. '+(next?questionFor(next):'No quedan otros marcadores pendientes.');
    const now=new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),id,'user',instruction.trim(),now),
      c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),id,'agent',reply,now)
    ]);
    return c.json({reply,replacements:[proposal],pendingFields:markers.length,coverage:coverage([proposal])});
  }
  // Persist the conversation per confection, so confirmed operator answers survive
  // navigation and later requests. Client-provided history is not trusted as evidence.
  await c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(),id,'user',instruction.trim(),new Date().toISOString()).run();
  const storedChat=await c.env.DB.prepare('SELECT sender, message FROM confeccion_chat WHERE confeccion_id = ? ORDER BY created_at DESC, id DESC LIMIT 40')
    .bind(id).all<{sender:string;message:string}>();
  const history=(storedChat.results||[]).reverse().map(m=>({role:m.sender,text:m.message.slice(0,2000)}));
  const rememberReply = async (reply:string) => {
    await c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(),id,'agent',reply.slice(0,3000),new Date().toISOString()).run();
  };
  const baseEvidence = {
    semanticFieldMap:fieldMap,
    code:caseObj.code, title:caseObj.title, description:caseObj.description,
    participants:caseObj.participants
  };
  const caseEvidence = String(caseObj.documentContent || '');
  const evidenceFor = (batch:string[]):string => {
    const terms = batch.flatMap(field => {
      const entry=fieldMap.find(f=>f.id===field);
      const at=content.indexOf(field);
      const context=at>=0?content.slice(Math.max(0,at-110),Math.min(content.length,at+field.length+110)):'';
      return [entry?.label||'',entry?.actor||'',context];
    }).join(' ').toLocaleLowerCase('es-AR');
    const keywords=[...new Set(terms.match(/[a-záéíóúñü]{4,}/g)||[])]
      .filter(w=>!['campo','para','esta','este','datos','parte','debe','donde','sobre','entre','documento','plantilla','completar'].includes(w))
      .slice(0,35);
    const snippets=(value:string,limit:number):string => {
      if(value.length<=limit)return value;
      const windows:Array<{at:number;score:number}>=[];
      for(let at=0;at<value.length;at+=850) {
        const chunk=value.slice(at,at+1100).toLocaleLowerCase('es-AR');
        const score=keywords.reduce((n,k)=>n+(chunk.includes(k)?1:0),0);
        windows.push({at,score});
      }
      const chosen=windows.sort((a,b)=>b.score-a.score||a.at-b.at).slice(0,Math.max(1,Math.floor(limit/1100)))
        .sort((a,b)=>a.at-b.at);
      return chosen.map(w=>'[posición '+w.at+'] '+value.slice(w.at,w.at+1050)).join('\n[…]\n').slice(0,limit);
    };
    // Reserve space for every attachment's status, even when its text is unreadable.
    const docs= documentEvidence.map((d,i)=>({
      name:d.name,status:d.status,note:d.note,
      excerpt:d.text?snippets(d.text,Math.min(2500,Math.max(180,Math.floor(18000/Math.max(1,documentEvidence.length))))):undefined,
      index:i+1
    }));
    return JSON.stringify({
      ...baseEvidence,
      caseDocumentContent:snippets(caseEvidence,4500),
      documents:docs
    });
  };
  // Process every marker in bounded batches instead of truncating the marker list.
  const batches: string[][] = [];
  for (let i=0;i<markers.length;i+=6) batches.push(markers.slice(i,i+6));
  const promptFor = (batch:string[], index:number) => `Sos un copiloto de confección documental inmobiliaria argentina.
Tu tarea es completar todos los campos que tengan evidencia verificable y continuar preguntando al operador hasta terminar. No te detengas por datos faltantes: resolvé los que sí tengan datos.
Respondé exclusivamente JSON {"reply":"mensaje breve o pregunta concreta","replacements":[{"field":"[CAMPO_1]","value":"valor","source":"origen concreto"}]}.
Cada reemplazo debe tener evidencia en los datos suministrados o en una respuesta explícita del operador. Nunca inventes DNI, fechas, personas, montos ni condiciones. No confundas locador, locatario ni cónyuges. No modifiques texto fuera de marcadores. Si hay contradicciones, preguntá antes de proponer.
Si faltan datos, hacé una pregunta específica y útil al operador, no una negativa genérica. Algunos documentos incluyen texto extraído y otros solo metadatos o notas de extracción. Usá únicamente el texto realmente presente; no afirmes haber leído archivos sin texto.
Lote ${index+1}/${batches.length}. Marcadores: ${JSON.stringify(batch)}
Campos y contexto: ${JSON.stringify(batch.map(field => {
 const entry=fieldMap.find(f=>f.id===field);
 const positions=[...content.matchAll(/\[CAMPO_\d+\*?\]/g)].filter(m=>m[0]===field).slice(0,4).map(m=>content.slice(Math.max(0,(m.index||0)-220),Math.min(content.length,(m.index||0)+field.length+220)));
 return {field,label:entry?.label,actor:entry?.actor,contexts:positions};
}))}
Datos disponibles del legajo (pueden incluir contenido digitalizado; extractos identificados por posición): ${evidenceFor(batch)}
Conversación histórica de esta confección (las afirmaciones del operador son datos declarados; verificá el actor y pedí confirmación ante contradicciones): ${JSON.stringify(history)}
Instrucción actual: ${instruction}`;
  const extractJson = (raw: string): any => {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(cleaned); } catch {}
    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
    return null;
  };
  try {
    const seen = new Set<string>();
    const valid: Array<{field:string;value:string;source:string}> = [...structuredProposals];
    structuredProposals.forEach(p=>seen.add(p.field));
    // A model's claim of a source is not proof. Only propose literal values
    // actually found in the case evidence or explicitly supplied by the operator.
    const normalizeEvidence=(v:string)=>v.toLocaleLowerCase('es-AR').normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
    const evidenceCorpus=normalizeEvidence(JSON.stringify({
      participants:caseObj.participants,description:caseObj.description,
      documentContent:caseObj.documentContent,documents:documentEvidence.map(d=>d.text||''),
      operatorStatements:history.filter(m=>m.role==='user').map(m=>m.text)
    }));
    const supportedValue=(value:string)=> {
      const normalized=normalizeEvidence(value);
      return normalized.length>=3 && evidenceCorpus.includes(normalized);
    };
    const roleCompatible=(field:string,value:string,source:string):boolean => {
      const entry=fieldMap.find(f=>f.id===field);
      if(!entry)return false;
      const expected=String(entry.actor||'').toLocaleLowerCase('es-AR');
      const declared=source.toLocaleLowerCase('es-AR');
      const spouse=/c[óo]nyuge|espos[ao]/i.test(expected);
      if(!spouse){
        const kind=actorKind(String(entry.actor||''));
        const property=propertyFor(String(entry.label||''));
        if(kind && property){
          const aliases:Record<string,string[]>={
            dni:['dni','documentNumber','document_number'],
            email:['email','mail'],birthDate:['birthDate','birth_date','dateOfBirth','fechaNacimiento'],
            maritalStatus:['maritalStatus','marital_status','estadoCivil'],
            address:['address','domicilio','domicilioActual'],
            name:['fullName','name','nombreCompleto']
          };
          const matches=actors.filter(p=>actorKind(String(p.role||p.type||''))===kind);
          if(matches.length>1)return false;
          const normalizedValue=normalizeEvidence(value);
          // If the value is a known attribute of a different actor, reject it.
          const otherActors=actors.filter(p=>actorKind(String(p.role||p.type||''))!==kind);
          if(otherActors.some(p=>(aliases[property]||[]).some(k=>
            typeof p[k]==='string' && normalizeEvidence(p[k])===normalizedValue)))return false;
          if(matches.length===1){
            const known=(aliases[property]||[]).map(k=>matches[0][k])
              .filter(v=>typeof v==='string'&&v.trim());
            if(known.length && !known.some(v=>normalizeEvidence(v)===normalizedValue)){
              // The operator can override contradictory structured data only
              // through an explicit field assignment, not a model inference.
              return false;
            }
          }
        }
        return true;
      }
      // No spouse proposal can be based solely on the main participant's
      // record or generic case data, even if the literal value exists there.
      if(!/c[óo]nyuge|espos[ao]/i.test(declared))return false;
      const primaryActors=caseObj.participants||[];
      const primaryValues=Array.isArray(primaryActors)?primaryActors.filter((p:any)=>
        !/c[óo]nyuge|espos[ao]/i.test(String(p.role||p.type||''))):[];
      const normalized=normalizeEvidence(value);
      if(primaryValues.some((p:any)=>Object.values(p).some(v=>typeof v==='string'&&normalizeEvidence(v)===normalized)))
        return false;
      return true;
    };
    const replies: string[] = [];
    let failures = 0;
    let lastFailure = '';
    const models = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'] as const;
    const runAgentBatch = async (batch:string[], index:number):Promise<any> => {
      if (!c.env.AI) throw new Error('Binding Workers AI no disponible');
      let lastError = '';
      for (const model of models) {
        // Retry on a smaller, structured prompt if the primary context is rejected.
        for (const compact of [false,true]) {
          try {
            const compactPrompt = JSON.stringify({
              task:'Completar marcadores con datos verificados. No inventar. Responder solo JSON: {"reply":"texto","replacements":[{"field":"[CAMPO_1]","value":"dato","source":"fuente"}]}',
              fields:batch.map(field=>({field,label:fieldMap.find(f=>f.id===field)?.label,actor:fieldMap.find(f=>f.id===field)?.actor,
                context:content.slice(Math.max(0,content.indexOf(field)-130),content.indexOf(field)+field.length+130)})),
              caseData:{code:caseObj.code,title:caseObj.title,participants:caseObj.participants},
              evidence:evidenceFor(batch).slice(0,6500),
              instruction,history:history.slice(-6)
            });
            const response = await (c.env.AI as any).run(model,{
              messages:[
                {role:'system',content:'Sos un asistente documental. Solo JSON válido. Proponé únicamente datos respaldados por evidencia; no inventes.'},
                {role:'user',content:compact?compactPrompt:promptFor(batch,index)}
              ],
              temperature:0,max_tokens:compact?1200:1600
            });
            const raw=typeof response?.response==='string'?response.response:
              typeof response==='string'?response:
              typeof response?.choices?.[0]?.message?.content==='string'?response.choices[0].message.content:'';
            const parsed=extractJson(raw);
            if (parsed && typeof parsed==='object') return parsed;
            lastError='Respuesta no interpretable del modelo '+model;
          } catch (error) {
            lastError=error instanceof Error?error.message:String(error);
            console.warn('Confecciones AI retry',{batch:index,model,compact,error:lastError.slice(0,250)});
          }
        }
      }
      throw new Error(lastError||'Los modelos no devolvieron una respuesta válida');
    };
    for (let i=0;i<batches.length;i++) {
      if(batches[i].every(field=>seen.has(field)))continue;
      try {
        const parsed = await runAgentBatch(batches[i],i);
        if (typeof parsed.reply === 'string' && parsed.reply.trim()) replies.push(parsed.reply.trim().slice(0,500));
        if (!Array.isArray(parsed.replacements)) continue;
        for (const x of parsed.replacements) {
          if (typeof x?.field !== 'string' || !batches[i].includes(x.field) || seen.has(x.field) ||
              typeof x.value !== 'string' || !x.value.trim() || x.value.length > 2000 ||
              /\[CAMPO_\d+\*?\]/.test(x.value) ||
              typeof x.source !== 'string' || !x.source.trim() || !supportedValue(x.value) || !roleCompatible(x.field,x.value,x.source)) continue;
          seen.add(x.field);
          valid.push({field:x.field,value:x.value.trim(),source:x.source.trim()});
        }
      } catch (batchError) {
        failures++;
        lastFailure = batchError instanceof Error ? batchError.message : String(batchError);
        console.error('Confecciones AI batch error', {batch:i,error:batchError});
      }
    }
    const unresolved = markers.filter(field=>!seen.has(field));
    const reply = valid.length
      ? 'Encontré '+valid.length+' propuestas verificables de '+markers.length+' campos. '+(unresolved.length ? 'Quedan '+unresolved.length+' pendientes. ' : 'No quedan marcadores pendientes de propuesta. ')+(replies[0]||'Revisá las propuestas y confirmá antes de aplicarlas.')
      : (failures === batches.length ? 'El servicio de IA falló en los '+batches.length+' lotes. '+(lastFailure?'Diagnóstico: '+lastFailure.slice(0,160)+'. ':'')+'No se modificó la plantilla. '+missingSummary() : (replies.find(r=>r.includes('¿')) || missingSummary()));
    await rememberReply(reply);
    return c.json({reply, replacements:valid, pendingFields:markers.length, coverage:coverage(valid), partialFailure:failures>0, batches:batches.length, failedBatches:failures});
  } catch (error) {
    console.error('Confecciones AI service error:', error);
    return c.json({reply:'El servicio de IA no respondió en este momento. No modifiqué la plantilla. ' + missingSummary(), replacements:[], pendingFields:markers.length, coverage:coverage([]), fallback:true});
  }
});

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

// ============================================================================
// 9. Case Documents (R2 Storage + D1 Metadata & Versions)
// ============================================================================
app.get('/api/cases/:caseId/documents', async (c) => {
  const auth = c.get('auth')!;
  const { caseId } = c.req.param();
  const allDocs = (await getAllDocuments(c.env.DB)).filter((d) => d.caseId === caseId);
  const caseObj = await getCaseById(c.env.DB, caseId);
  return c.json(allDocs.filter(d => {
    if (d.status !== 'approved') return true;
    if (d.allowedRoles?.includes('PRIVATE_CASE_ADVISOR')) {
      return ['SUPERADMIN', 'ADMIN'].includes(auth.user.role) ||
        (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId === auth.user.id) ||
        (auth.user.role === 'ASESOR' && caseObj?.assignedAdvisorId === auth.user.id);
    }
    return ['SUPERADMIN', 'ADMIN'].includes(auth.user.role) ||
      !d.allowedRoles?.length || d.allowedRoles.includes(auth.user.role);
  }));
});

async function handleDocumentUpload(c: AppContext) {
  const auth = c.get('auth')!;
  const contentType = c.req.header('Content-Type') || '';

  let caseId = '';
  let stageId = '';
  let requirementId = '';
  let name = '';
  let fileName = '';
  let fileSize = 0;
  let mimeType = 'application/octet-stream';
  let fileBytes: Uint8Array | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    caseId = String(form.get('caseId') || '');
    stageId = String(form.get('stageId') || '');
    requirementId = String(form.get('requirementId') || '');
    name = String(form.get('name') || '');
    const file = form.get('file') as File | null;
    if (file) {
      fileName = file.name;
      fileSize = file.size;
      mimeType = guessMimeType(file.name, file.type);
      fileBytes = new Uint8Array(await file.arrayBuffer());
    }
  } else {
    const body = await c.req.json();
    caseId = body.caseId || '';
    stageId = body.stageId || '';
    requirementId = body.requirementId || '';
    name = body.name || '';
    fileName = body.fileName || '';
    fileSize = body.fileSize || 0;
    if (body.fileBase64) {
      const decoded = decodeDataUrl(body.fileBase64, guessMimeType(fileName));
      fileBytes = decoded.bytes;
      mimeType = decoded.mimeType;
      fileSize = decoded.bytes.byteLength;
    } else if (body.textContent !== undefined) {
      fileBytes = new TextEncoder().encode(String(body.textContent));
      mimeType = 'text/plain; charset=utf-8';
      fileSize = fileBytes.byteLength;
    }
  }

  if (!caseId || !stageId || !requirementId) {
    return c.json({ error: 'caseId, stageId y requirementId son obligatorios.' }, 400);
  }

  // Permiso acotado: un asesor solo carga requisitos de la etapa actual de su legajo asignado.
  // La autorización no se extiende a la sección general Documentos ni a otros legajos.
  const targetCase = await getCaseById(c.env.DB, caseId);
  if (!targetCase) return c.json({ error: 'Legajo no encontrado.' }, 404);
  const targetTemplate = await findTemplateOrVirtualById(c.env, targetCase.templateId);
  const targetStage = targetTemplate?.stages[targetCase.currentStageIndex];
  if (!targetStage || targetStage.id !== stageId ||
      !targetStage.requirements.some((r) => r.id === requirementId && r.type === 'document')) {
    return c.json({ error: 'El documento no corresponde a un requisito de la etapa actual.' }, 403);
  }
  if (auth.user.role === 'ASESOR') {
    if (targetCase.assignedAdvisorId !== auth.user.id || targetCase.isCurrentStageApproved) {
      return c.json({ error: 'No autorizado para cargar documentos en este legajo o etapa.' }, 403);
    }
  } else if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado.' }, 403);
  }

  // Enforce upload authorization constraints for ASESOR if an approved request exists
  if (auth.user.role === 'ASESOR') {
    const approvedReq = await c.env.DB.prepare(
      "SELECT * FROM upload_requests WHERE case_id = ? AND requirement_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1"
    )
      .bind(caseId, requirementId)
      .first<any>();

    const caseObjCheck = await getCaseById(c.env.DB, caseId);
    const tpl = caseObjCheck ? await findTemplateOrVirtualById(c.env, caseObjCheck.templateId) : null;
    const reqDef = tpl?.stages.flatMap((s) => s.requirements).find((r) => r.id === requirementId);
    const isDigitalContract = reqDef?.documentSourceType === 'digital_contract';

    if (!isDigitalContract && approvedReq) {
      const maxBytes = (approvedReq.allowed_max_weight || 5) * 1024 * 1024;
      if (fileSize > maxBytes) {
        return c.json(
          { error: `El archivo excede el tamaño máximo autorizado (${approvedReq.allowed_max_weight || 5} MB).` },
          400
        );
      }
      if (
        approvedReq.allowed_extension &&
        fileName &&
        !fileName.toLowerCase().endsWith(String(approvedReq.allowed_extension).toLowerCase())
      ) {
        return c.json(
          { error: `Extensión no autorizada. Se requiere ${approvedReq.allowed_extension}.` },
          400
        );
      }
    }
  }

  let resolvedName = name;
  if (!resolvedName && requirementId) {
    if (requirementId.startsWith('req-digital-')) {
      const sId = requirementId.replace(/^req-digital-/, '');
      const shared = await c.env.DB.prepare('SELECT name FROM shared_documents WHERE id = ?')
        .bind(sId)
        .first<{ name: string }>();
      resolvedName = shared?.name || fileName || 'Documento';
    } else {
      const templates = await getAllTemplates(c.env.DB);
      const reqObj = templates.flatMap((t) => t.stages).flatMap((s) => s.requirements).find((r) => r.id === requirementId);
      resolvedName = reqObj?.name || fileName || 'Documento';
    }
  } else if (!resolvedName) {
    resolvedName = fileName || 'Documento';
  }

  const finalFileName = fileName || `${sanitizeFileName(resolvedName)}.pdf`;
  const now = new Date().toISOString();

  const existingDoc = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE case_id = ? AND requirement_id = ?'
  )
    .bind(caseId, requirementId)
    .first<any>();

  const docId = existingDoc ? existingDoc.id : `doc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const versionId = `ver-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const r2Key = `cases/${caseId}/${docId}/${versionId}-${sanitizeFileName(finalFileName)}`;

  if (fileBytes) {
    await c.env.R2_BUCKET.put(r2Key, fileBytes, {
      httpMetadata: { contentType: mimeType },
    });
  } else {
    // Digital contract snapshot placeholder if only text was persisted on case
    const caseRow = await c.env.DB.prepare('SELECT document_content FROM cases WHERE id = ?')
      .bind(caseId)
      .first<{ document_content: string }>();
    const contentBytes = new TextEncoder().encode(caseRow?.document_content || resolvedName);
    mimeType = 'text/plain; charset=utf-8';
    fileSize = contentBytes.byteLength;
    await c.env.R2_BUCKET.put(r2Key, contentBytes, {
      httpMetadata: { contentType: mimeType },
    });
  }

  if (existingDoc) {
    await c.env.DB.prepare(
      `UPDATE documents SET status = 'uploaded', file_name = ?, mime_type = ?, file_size = ?, r2_key = ?, uploaded_by = ?, uploaded_at = ?
       WHERE id = ?`
    )
      .bind(finalFileName, mimeType, fileSize, r2Key, auth.user.id, now, docId)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO documents (id, case_id, stage_id, requirement_id, name, status, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        docId,
        caseId,
        stageId,
        requirementId,
        resolvedName,
        finalFileName,
        mimeType,
        fileSize,
        r2Key,
        auth.user.id,
        now
      )
      .run();
  }

  await c.env.DB.prepare(
    `INSERT INTO document_versions (id, document_id, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(versionId, docId, finalFileName, mimeType, fileSize, r2Key, auth.user.id, now)
    .run();

  const caseObj = await getCaseById(c.env.DB, caseId);
  if (caseObj && caseObj.status !== 'observed') {
    await c.env.DB.prepare("UPDATE cases SET status = 'pending_review', updated_at = ? WHERE id = ?")
      .bind(now, caseId)
      .run();
  }

  await createAudit(c.env.DB, auth.user.id, `Cargó documento "${resolvedName}"`, 'Document', docId, resolvedName);
  if (caseObj && caseObj.assignedManagerId) {
    await createNotification(
      c.env.DB,
      caseObj.assignedManagerId,
      'Documento para Revisar',
      `El asesor cargó "${resolvedName}" en el legajo ${caseObj.code}`,
      'info',
      caseId
    );
  }

  const allDocs = await getAllDocuments(c.env.DB);
  return c.json(allDocs.find((d) => d.id === docId), 201);
}

app.post('/api/documents', handleDocumentUpload);
app.post('/api/documents/upload', handleDocumentUpload);

app.get('/api/documents/:id/download', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const versionId = c.req.query('versionId');

  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  if (doc.status === 'approved' && doc.allowed_roles_json) {
    const allowed: string[] = JSON.parse(doc.allowed_roles_json);
    const caseObj = await getCaseById(c.env.DB, doc.case_id);
    const privateAccess = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role) ||
      (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId === auth.user.id) ||
      (auth.user.role === 'ASESOR' && caseObj?.assignedAdvisorId === auth.user.id);
    if (allowed.includes('PRIVATE_CASE_ADVISOR') ? !privateAccess :
      (!['SUPERADMIN', 'ADMIN'].includes(auth.user.role) && allowed.length > 0 && !allowed.includes(auth.user.role))) {
      return c.json({ error: 'No tienes permiso para descargar este documento.' }, 403);
    }
  }

  let r2Key = doc.r2_key;
  let fileName = doc.file_name || 'documento';
  let mimeType = doc.mime_type || guessMimeType(fileName);

  if (versionId) {
    const ver = await c.env.DB.prepare(
      'SELECT * FROM document_versions WHERE id = ? AND document_id = ?'
    )
      .bind(versionId, id)
      .first<any>();
    if (!ver) return c.json({ error: 'Versión no encontrada.' }, 404);
    r2Key = ver.r2_key;
    fileName = ver.file_name;
    mimeType = ver.mime_type || guessMimeType(fileName);
  }

  if (!r2Key) {
    return c.json({ error: 'Este documento no tiene archivo almacenado en R2.' }, 404);
  }

  const obj = await c.env.R2_BUCKET.get(r2Key);
  if (!obj) return c.json({ error: 'Archivo no encontrado en R2.' }, 404);

  await createAudit(c.env.DB, auth.user.id, `Descargó documento "${doc.name}"`, 'Document', doc.id, doc.name);
  return new Response(obj.body, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${sanitizeFileName(fileName)}"`,
    },
  });
});

app.post('/api/upload-requests/create', async (c) => {
  const auth = c.get('auth')!;
  const { caseId, stageId, requirementId, requirementName, requestedExtension } = await c.req.json();
  if (!caseId || !requirementId) {
    return c.json({ error: 'Faltan parámetros obligatorios.' }, 400);
  }

  const id = `uprq-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const now = new Date().toISOString();
  const reqName = requirementName || 'Documento';
  const ext = requestedExtension || '.pdf';

  await c.env.DB.prepare(
    `INSERT INTO upload_requests (id, case_id, stage_id, requirement_id, requirement_name, requested_by, requested_at, status, requested_extension)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(id, caseId, stageId, requirementId, reqName, auth.user.id, now, ext)
    .run();

  const caseObj = await getCaseById(c.env.DB, caseId);
  await createAudit(
    c.env.DB,
    auth.user.id,
    `Solicitó permiso para subir archivo para "${reqName}" (Extensión: ${ext})`,
    'Case',
    caseId,
    caseObj?.title || 'Legajo'
  );

  if (caseObj) {
    let notifyId = caseObj.assignedManagerId;
    if (!notifyId) {
      const mgr = await c.env.DB.prepare(
        "SELECT id FROM users WHERE role IN ('MANAGER', 'ADMIN', 'SUPERADMIN') AND active = 1 LIMIT 1"
      ).first<{ id: string }>();
      notifyId = mgr?.id || '';
    }
    if (notifyId) {
      await createNotification(
        c.env.DB,
        notifyId,
        'Solicitud de Subida de Archivo',
        `El asesor ${auth.user.name} solicita subir un archivo ${ext} para "${reqName}" en legajo ${caseObj.code}`,
        'warning',
        caseId
      );
    }
  }

  return c.json(
    {
      id,
      caseId,
      stageId,
      requirementId,
      requirementName: reqName,
      requestedBy: auth.user.id,
      requestedAt: now,
      status: 'pending',
      requestedExtension: ext,
    },
    201
  );
});

app.post('/api/upload-requests/review', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para revisar solicitudes de carga.' }, 403);
  }
  const { id, status, allowedExtension, allowedMaxWeight, responseComment } = await c.req.json();
  const reqObj = await c.env.DB.prepare('SELECT * FROM upload_requests WHERE id = ?').bind(id).first<any>();
  if (!reqObj) return c.json({ error: 'Solicitud no encontrada.' }, 404);

  const now = new Date().toISOString();
  const finalExt = allowedExtension || reqObj.requested_extension;
  const finalWeight = allowedMaxWeight ? Number(allowedMaxWeight) : 5;

  await c.env.DB.prepare(
    `UPDATE upload_requests SET status = ?, allowed_extension = ?, allowed_max_weight = ?, response_comment = ?, reviewed_by = ?, reviewed_at = ?
     WHERE id = ?`
  )
    .bind(status, finalExt, finalWeight, responseComment || '', auth.user.id, now, id)
    .run();

  const caseObj = await getCaseById(c.env.DB, reqObj.case_id);
  await createAudit(
    c.env.DB,
    auth.user.id,
    `${status === 'approved' ? 'Aprobó' : 'Rechazó'} solicitud de subida para "${reqObj.requirement_name}"`,
    'Case',
    reqObj.case_id,
    caseObj?.title || 'Legajo'
  );

  await createNotification(
    c.env.DB,
    reqObj.requested_by,
    status === 'approved' ? 'Solicitud de Subida Aprobada' : 'Solicitud de Subida Rechazada',
    `Tu solicitud para subir "${reqObj.requirement_name}" fue ${status === 'approved' ? 'APROBADA' : 'RECHAZADA'} por ${auth.user.name}. ${status === 'approved' ? `Peso máx: ${finalWeight}MB, Ext: ${finalExt}` : `Nota: ${responseComment || ''}`}`,
    status === 'approved' ? 'success' : 'error',
    reqObj.case_id
  );

  return c.json({
    id: reqObj.id,
    caseId: reqObj.case_id,
    stageId: reqObj.stage_id,
    requirementId: reqObj.requirement_id,
    requirementName: reqObj.requirement_name,
    requestedBy: reqObj.requested_by,
    requestedAt: reqObj.requested_at,
    status,
    requestedExtension: reqObj.requested_extension,
    allowedExtension: finalExt,
    allowedMaxWeight: finalWeight,
    responseComment: responseComment || '',
    reviewedBy: auth.user.id,
    reviewedAt: now,
  });
});

async function handleDocumentReview(c: AppContext) {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para revisar documentos.' }, 403);
  }
  const { id } = c.req.param();
  const { status, observationText, allowedRoles } = await c.req.json();
  const docRow = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!docRow) return c.json({ error: 'Documento no encontrado' }, 404);
  if (!['approved', 'rejected', 'uploaded'].includes(status)) return c.json({ error: 'Estado inválido.' }, 400);
  if (docRow.status === 'approved' && status === 'rejected') {
    return c.json({ error: 'Primero debe revertir la aprobación para rechazar el documento.' }, 409);
  }
  if (status === 'uploaded' && docRow.status !== 'approved') {
    return c.json({ error: 'Solo se puede revertir un documento aprobado.' }, 409);
  }
  if (status === 'rejected' && (!observationText || !String(observationText).trim())) {
    return c.json({ error: 'Debe indicar una observación para el rechazo.' }, 400);
  }

  const rolesJson =
    status === 'approved'
      ? JSON.stringify(Array.isArray(allowedRoles) && allowedRoles.length ? allowedRoles : ['PRIVATE_CASE_ADVISOR'])
      : docRow.allowed_roles_json;

  await c.env.DB.prepare('UPDATE documents SET status = ?, allowed_roles_json = ? WHERE id = ?')
    .bind(status, rolesJson, id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Documento ${status === 'approved' ? 'aprobado' : status === 'uploaded' ? 'con aprobación revertida' : 'rechazado'}: "${docRow.name}"`,
    'Document',
    id,
    docRow.name
  );

  const caseObj = await getCaseById(c.env.DB, docRow.case_id);
  const now = new Date().toISOString();

  if (status === 'rejected') {
    const obsId = `obs-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
    const obsText = observationText || 'Documento rechazado por el gestor. Favor de verificar.';
    await c.env.DB.prepare(
      `INSERT INTO observations (id, case_id, stage_id, requirement_id, document_id, text, created_by, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    )
      .bind(obsId, docRow.case_id, docRow.stage_id, docRow.requirement_id, docRow.id, obsText, auth.user.id, now)
      .run();

    if (caseObj) {
      await c.env.DB.prepare("UPDATE cases SET status = 'observed', updated_at = ? WHERE id = ?")
        .bind(now, caseObj.id)
        .run();
      await createNotification(
        c.env.DB,
        caseObj.assignedAdvisorId,
        'Documento Rechazado',
        `Tu documento "${docRow.name}" en ${caseObj.code} fue rechazado. Motivo: ${obsText}`,
        'error',
        docRow.case_id
      );
    }
  } else if (caseObj) {
    const stageDocs = await c.env.DB.prepare(
      'SELECT status FROM documents WHERE case_id = ? AND stage_id = ?'
    )
      .bind(caseObj.id, docRow.stage_id)
      .all<{ status: string }>();
    const openObs = await c.env.DB.prepare(
      "SELECT id FROM observations WHERE case_id = ? AND stage_id = ? AND status = 'open' LIMIT 1"
    )
      .bind(caseObj.id, docRow.stage_id)
      .first();

    const hasObserved =
      Boolean(openObs) || (stageDocs.results || []).some((d) => d.status === 'rejected');
    const hasPendingReview = (stageDocs.results || []).some((d) => d.status === 'uploaded');
    const nextStatus = hasObserved ? 'observed' : hasPendingReview ? 'pending_review' : 'active';

    await c.env.DB.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, now, caseObj.id)
      .run();

    if (status === 'approved') await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Documento Aprobado',
      `¡Excelente! Tu documento "${docRow.name}" en ${caseObj.code} fue aprobado.`,
      'success',
      docRow.case_id
    );
  }

  const allDocs = await getAllDocuments(c.env.DB);
  return c.json({
    doc: allDocs.find((d) => d.id === id),
    case: await getCaseById(c.env.DB, docRow.case_id),
  });
}

app.post('/api/documents/:id/review', handleDocumentReview);
app.put('/api/documents/:id/review', handleDocumentReview);

registerCaseWorkflowRoutes(app);
registerNotificationRoutes(app);

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
