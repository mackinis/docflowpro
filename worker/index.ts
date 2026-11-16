import { ensureDatabaseReady } from './startup-migrations';
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

// Permission overrides are checked for every authenticated API request, before route handlers.
app.use('/api/*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth) return next();
  // Impersonation is a real permission boundary: only the selected user may bypass RBAC.
  if (auth.user.role === 'SUPERADMIN') return next();
  const path = c.req.path;
  if (path.startsWith('/api/admin/rbac')) return c.json({ error: 'Acceso RBAC reservado al Superadmin.' }, 403);
  // Audit ingestion must remain available regardless of audit-report viewing rights.
  if (path === '/api/audit/navigation' || path === '/api/audit-logs/log') return next();
  const routes: Array<[RegExp, string]> = [
    [/^\/api\/users(?:\/|$)|^\/api\/admin\/user-creators|^\/api\/admin\/registration-policy/, 'users'],
    [/^\/api\/audit(?:-|\/)|^\/api\/audit-logs/, 'audit'],
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
  return c.json({ documents: { view: can('view'), download: can('download'), edit: can('edit'), create: can('create'), delete: can('delete') } });
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
  const { isRbacKey } = await import('../src/rbac');
  const roles = ['ADMIN', 'MANAGER', 'ASESOR'];
  const input = body?.matrix;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json({ error: 'Matriz inválida.' }, 400);
  const validate = (values: unknown) => values && typeof values === 'object' && !Array.isArray(values) && Object.entries(values).every(([key, value]) => isRbacKey(key) && typeof value === 'boolean');
  if (!input.roles || !input.users || typeof input.roles !== 'object' || typeof input.users !== 'object' || Array.isArray(input.roles) || Array.isArray(input.users)) return c.json({ error: 'Matriz inválida.' }, 400);
  if (Object.entries(input.roles).some(([role, permissions]) => !roles.includes(role) || !validate(permissions))) return c.json({ error: 'Roles o permisos inválidos.' }, 400);
  if (Object.entries(input.users).some(([id, permissions]) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !validate(permissions))) return c.json({ error: 'Usuarios o permisos inválidos.' }, 400);
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
  const avatar = PRESET_AVATARS[0]?.url || '';
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

// ============================================================================
// 5. Internal System Messages (Metadata in D1, Attachments in R2)
// ============================================================================
app.post('/api/system-messages', async (c) => {
  const auth = c.get('auth')!;
  const { receiverId, subject, content, attachments } = await c.req.json();
  const sender = auth.user;

  let receiver: { id: string; name: string; lastName: string; role: string } | null = null;
  if (receiverId === 'system') {
    receiver = { id: 'system', name: 'Sistema', lastName: 'de Reasignaciones', role: 'SYSTEM' };
  } else {
    const recRow = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(receiverId).first<any>();
    if (recRow) {
      receiver = { id: recRow.id, name: recRow.name, lastName: recRow.last_name, role: recRow.role };
    }
  }

  if (!receiver) {
    return c.json({ error: 'Destinatario no encontrado.' }, 404);
  }

  const settings = await getSystemConfigValue(c.env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  const configs = settings.roleMessagingConfigs || DEFAULT_SYSTEM_SETTINGS.roleMessagingConfigs!;
  const senderConfig = (configs as any)[sender.role] || { allowed: true, rule: 'free' };

  if (!senderConfig.allowed) {
    return c.json({ error: `Tu rol (${sender.role}) no tiene permisos para enviar mensajes internos.` }, 403);
  }

  if (senderConfig.rule === 'wait_reply') {
    const lastExchanged = await c.env.DB.prepare(
      `SELECT sender_id FROM system_messages
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
         AND permanent_deleted_by_sender = 0
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(sender.id, receiverId, receiverId, sender.id)
      .first<{ sender_id: string }>();

    if (lastExchanged && lastExchanged.sender_id === sender.id) {
      return c.json(
        {
          error:
            'La política del sistema para tu rol te impide enviar otro mensaje hasta que recibas una respuesta.',
        },
        400
      );
    }
  }

  const msgId = `msg-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO system_messages (id, sender_id, sender_name, sender_role, receiver_id, receiver_name, receiver_role, subject, content, created_at, read, deleted_by_sender, deleted_by_receiver, permanent_deleted_by_sender, permanent_deleted_by_receiver)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`
  )
    .bind(
      msgId,
      sender.id,
      `${sender.name} ${sender.lastName}`,
      sender.role,
      receiver.id,
      `${receiver.name} ${receiver.lastName}`,
      receiver.role,
      subject || '(Sin Asunto)',
      content,
      now
    )
    .run();

  const savedAttachments: any[] = [];
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      const attId = `att-${crypto.randomUUID().slice(0, 8)}`;
      const safeName = sanitizeFileName(att.name || 'adjunto');
      const r2Key = `messages/${msgId}/${attId}-${safeName}`;
      let mimeType = guessMimeType(safeName);
      let byteSize = att.size || 0;

      if (att.dataUrl) {
        const decoded = decodeDataUrl(att.dataUrl, mimeType);
        mimeType = decoded.mimeType;
        byteSize = decoded.bytes.byteLength;
        await c.env.R2_BUCKET.put(r2Key, decoded.bytes, {
          httpMetadata: { contentType: mimeType },
        });
      } else if (att.r2Key) {
        const srcObj = await c.env.R2_BUCKET.get(att.r2Key);
        if (srcObj) {
          const buf = new Uint8Array(await srcObj.arrayBuffer());
          mimeType = srcObj.httpMetadata?.contentType || att.mimeType || mimeType;
          byteSize = buf.byteLength;
          await c.env.R2_BUCKET.put(r2Key, buf, {
            httpMetadata: { contentType: mimeType },
          });
        } else {
          await c.env.R2_BUCKET.put(r2Key, new Uint8Array(0), {
            httpMetadata: { contentType: mimeType },
          });
        }
      } else {
        await c.env.R2_BUCKET.put(r2Key, new Uint8Array(0), {
          httpMetadata: { contentType: mimeType },
        });
      }

      await c.env.DB.prepare(
        `INSERT INTO message_attachments (id, message_id, name, mime_type, size, r2_key)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(attId, msgId, att.name || safeName, mimeType, byteSize, r2Key)
        .run();

      savedAttachments.push({
        id: attId,
        name: att.name || safeName,
        mimeType,
        size: byteSize,
        r2Key,
        downloadUrl: `/api/system-messages/attachments/${attId}/download`,
      });
    }
  }

  await createAudit(
    c.env.DB,
    sender.id,
    `Envió un mensaje interno a ${receiver.name} ${receiver.lastName}`,
    'Message',
    msgId,
    subject || '(Sin Asunto)'
  );

  return c.json(
    {
      success: true,
      message: {
        id: msgId,
        senderId: sender.id,
        senderName: `${sender.name} ${sender.lastName}`,
        senderRole: sender.role,
        receiverId: receiver.id,
        receiverName: `${receiver.name} ${receiver.lastName}`,
        receiverRole: receiver.role,
        subject: subject || '(Sin Asunto)',
        content,
        createdAt: now,
        read: false,
        deletedBySender: false,
        deletedByReceiver: false,
        attachments: savedAttachments,
      },
    },
    201
  );
});

app.get('/api/system-messages/attachments/:attachmentId/download', async (c) => {
  const auth = c.get('auth')!;
  const { attachmentId } = c.req.param();
  const att = await c.env.DB.prepare(
    `SELECT a.*, m.sender_id, m.receiver_id
     FROM message_attachments a
     JOIN system_messages m ON m.id = a.message_id
     WHERE a.id = ?`
  )
    .bind(attachmentId)
    .first<any>();

  if (!att) {
    return c.json({ error: 'Adjunto no encontrado.' }, 404);
  }

  const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role);
  if (
    att.sender_id !== auth.user.id &&
    att.receiver_id !== auth.user.id &&
    !(att.receiver_id === 'system' && isAdmin) &&
    !isAdmin
  ) {
    return c.json({ error: 'No autorizado para descargar este adjunto.' }, 403);
  }

  const obj = await c.env.R2_BUCKET.get(att.r2_key);
  if (!obj) {
    return c.json({ error: 'Archivo no encontrado en R2.' }, 404);
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': att.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${sanitizeFileName(att.name)}"`,
    },
  });
});

app.post('/api/system-messages/read', async (c) => {
  const { messageId } = await c.req.json();
  await c.env.DB.prepare('UPDATE system_messages SET read = 1 WHERE id = ?').bind(messageId).run();
  return c.json({ success: true });
});

app.post('/api/system-messages/trash', async (c) => {
  const auth = c.get('auth')!;
  const { messageId, action } = await c.req.json();
  const msg = await c.env.DB.prepare('SELECT * FROM system_messages WHERE id = ?').bind(messageId).first<any>();
  if (!msg) {
    return c.json({ error: 'Mensaje no encontrado' }, 404);
  }
  const isTrash = action === 'trash' ? 1 : 0;
  const isAdminOrSuper = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role);

  if (msg.sender_id === auth.user.id) {
    await c.env.DB.prepare('UPDATE system_messages SET deleted_by_sender = ? WHERE id = ?')
      .bind(isTrash, messageId)
      .run();
  }
  if (msg.receiver_id === auth.user.id || (msg.receiver_id === 'system' && isAdminOrSuper)) {
    await c.env.DB.prepare('UPDATE system_messages SET deleted_by_receiver = ? WHERE id = ?')
      .bind(isTrash, messageId)
      .run();
  }
  return c.json({ success: true });
});

app.post('/api/system-messages/delete-permanent', async (c) => {
  const auth = c.get('auth')!;
  const { messageId } = await c.req.json();
  const msg = await c.env.DB.prepare('SELECT * FROM system_messages WHERE id = ?').bind(messageId).first<any>();
  if (!msg) {
    return c.json({ error: 'Mensaje no encontrado' }, 404);
  }

  const isAdminOrSuper = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role);
  let delSender = msg.permanent_deleted_by_sender === 1;
  let delReceiver = msg.permanent_deleted_by_receiver === 1;

  if (msg.sender_id === auth.user.id) {
    delSender = true;
    await c.env.DB.prepare('UPDATE system_messages SET permanent_deleted_by_sender = 1 WHERE id = ?')
      .bind(messageId)
      .run();
  }
  if (msg.receiver_id === auth.user.id || (msg.receiver_id === 'system' && isAdminOrSuper)) {
    delReceiver = true;
    await c.env.DB.prepare('UPDATE system_messages SET permanent_deleted_by_receiver = 1 WHERE id = ?')
      .bind(messageId)
      .run();
  }

  if (delSender && delReceiver) {
    const atts = await c.env.DB.prepare('SELECT r2_key FROM message_attachments WHERE message_id = ?')
      .bind(messageId)
      .all<{ r2_key: string }>();
    for (const a of atts.results || []) {
      await c.env.R2_BUCKET.delete(a.r2_key);
    }
    await c.env.DB.prepare('DELETE FROM system_messages WHERE id = ?').bind(messageId).run();
  }

  return c.json({ success: true });
});

// ============================================================================
// 6. Process Templates (Normalized D1 Tables)
// ============================================================================
async function saveTemplateInDb(db: D1Database, tpl: ProcessTemplate, isUpdate = false): Promise<void> {
  const now = new Date().toISOString();
  if (isUpdate) {
    await db
      .prepare(
        `UPDATE process_templates SET name = ?, description = ?, industry = ?, original_document_content = ?,
         show_document_to_all = ?, shared_view_mode = ?, updated_at = ? WHERE id = ?`
      )
      .bind(
        tpl.name,
        tpl.description || '',
        tpl.industry,
        tpl.originalDocumentContent || '',
        tpl.showDocumentToAll !== false ? 1 : 0,
        tpl.sharedViewMode || 'both',
        now,
        tpl.id
      )
      .run();
    await db.prepare('DELETE FROM template_stages WHERE template_id = ?').bind(tpl.id).run();
  } else {
    await db
      .prepare(
        `INSERT INTO process_templates (id, name, description, industry, original_document_content, show_document_to_all, shared_view_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tpl.id,
        tpl.name,
        tpl.description || '',
        tpl.industry,
        tpl.originalDocumentContent || '',
        tpl.showDocumentToAll !== false ? 1 : 0,
        tpl.sharedViewMode || 'both',
        now,
        now
      )
      .run();
  }

  const stmts: D1PreparedStatement[] = [];
  (tpl.stages || []).forEach((stg, sIdx) => {
    const stageId = stg.id || `stg-${sIdx}-${Date.now()}`;
    stmts.push(
      db
        .prepare(
          `INSERT INTO template_stages (id, template_id, stage_order, name, description)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(stageId, tpl.id, sIdx, stg.name, stg.description || '')
    );

    (stg.requirements || []).forEach((req, rIdx) => {
      const reqId = req.id || `req-${sIdx}-${rIdx}-${Date.now()}`;
      stmts.push(
        db
          .prepare(
            `INSERT INTO stage_requirements (id, stage_id, template_id, req_order, name, type, description, is_required, form_fields_json, document_source_type, linked_template_id, linked_shared_document_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            reqId,
            stageId,
            tpl.id,
            rIdx,
            req.name,
            req.type,
            req.description || '',
            req.isRequired !== false ? 1 : 0,
            req.type === 'actor' ? JSON.stringify({ actorRole: req.actorRole, minQuantity: Math.max(1, Number(req.minQuantity) || 1) }) : (req.formFields ? JSON.stringify(req.formFields) : null),
            req.documentSourceType || null,
            req.linkedTemplateId || null,
            req.linkedSharedDocumentId || null
          )
      );
    });
  });

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

app.get('/api/templates', async (c) => {
  const templates = await getAllTemplates(c.env.DB);
  return c.json(templates);
});

/**
 * Process descriptions are authored by responsible users. Convert explicit
 * line-by-line obligations to persisted stage requirements; never use the
 * digitization pipeline to determine what an advisor must provide.
 */
function requirementsFromProcessDescription(description: string): ProcessTemplate['stages'] {
  const lines = description.split(/\r?\n|;/).map(x => x.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean);
  const requirements: ProcessTemplate['stages'][number]['requirements'] = [];
  const actorRoles: Record<string, string> = {
    locador: 'Locador', locatario: 'Locatario', garante: 'Garante',
    vendedor: 'Vendedor', comprador: 'Comprador', titular: 'Titular',
    cliente: 'Cliente', apoderado: 'Apoderado', escribano: 'Escribano'
  };
  const normalized = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const add = (name: string, type: 'actor' | 'document' | 'task', role?: string, minimum?: number) => {
    if (requirements.some(req => req.type === type && normalized(req.name) === normalized(name))) return;
    requirements.push({
      id: `req-${crypto.randomUUID()}`, name, type,
      description: '', isRequired: true,
      ...(role ? { actorRole: role as any, minQuantity: minimum || 1 } : {})
    });
  };
  for (const line of lines) {
    const clean = normalized(line);
    const actor = Object.entries(actorRoles).find(([key]) => new RegExp(`\\b${key}(?:es|s)?\\b`).test(clean));
    if (actor && !/(dni|document|copia|escritura|boleta|servicio|boleto|certificado|informe|credito|comprobante|constancia|recibo|factura)/.test(clean)) {
      const number = clean.match(/\b(?:minimo|minima|al menos|cantidad|requiere|exigir)\s*:?\s*(\d+)\b/) || clean.match(/^\s*(\d+)\s+/);
      const minimum = number ? Math.max(1, Number(number[1])) : /\bdos\b/.test(clean) ? 2 : /\btres\b/.test(clean) ? 3 : 1;
      add(actor[1], 'actor', actor[1], minimum);
      continue;
    }
    const stripped = line.replace(/^(documentaci[oó]n requerida|documentos requeridos|documentos|adjuntar|presentar|copia de|copia del)\s*:?\s*/i, '').trim();
    const low = normalized(stripped);
    if (!stripped || /^(documentacion requerida|documentos requeridos|documentos|actores|partes):?$/.test(low)) continue;
    if (/(dni|documento de identidad|escritura|boleta|servicio|boleto|certificado|informe|credito|comprobante|constancia|recibo|factura|documentacion|contrato|titulo de propiedad)/.test(low)) {
      add(stripped, 'document');
    } else if (/^(tarea|verificar|comprobar|revisar|confirmar)\b/.test(low)) {
      add(stripped, 'task');
    }
  }
  return [{ id: `stage-${crypto.randomUUID()}`, name: 'Presentación y revisión de requisitos', description: 'Requisitos establecidos por el responsable del proceso', requirements }];
}

app.post('/api/templates', async (c) => {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para crear plantillas de procesos.' }, 403);
  }
  const body = await c.req.json();
  const newTemplate: ProcessTemplate = {
    id: `tmpl-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
    name: body.name,
    description: body.description || '',
    industry: body.industry || 'Inmobiliaria',
    stages: Array.isArray(body.stages) && body.stages.length ? body.stages : requirementsFromProcessDescription(body.description || ''),
    originalDocumentContent: body.originalDocumentContent || '',
    showDocumentToAll: body.showDocumentToAll !== undefined ? body.showDocumentToAll : true,
    sharedViewMode: body.sharedViewMode || 'both',
  };

  await saveTemplateInDb(c.env.DB, newTemplate, false);
  await createAudit(c.env.DB, auth.user.id, 'Plantilla de proceso creada', 'ProcessTemplate', newTemplate.id, newTemplate.name);
  return c.json(newTemplate, 201);
});

app.put('/api/templates/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para modificar plantillas de procesos.' }, 403);
  }
  const { id } = c.req.param();
  const existing = (await getAllTemplates(c.env.DB)).find((t) => t.id === id);
  if (!existing) {
    return c.json({ error: 'Plantilla de proceso no encontrada.' }, 404);
  }
  const body = await c.req.json();
  const updated: ProcessTemplate = {
    ...existing,
    name: body.name || existing.name,
    description: body.description !== undefined ? body.description : existing.description,
    industry: body.industry || existing.industry,
    stages: body.stages !== undefined ? body.stages : existing.stages,
    originalDocumentContent:
      body.originalDocumentContent !== undefined
        ? body.originalDocumentContent
        : existing.originalDocumentContent,
    showDocumentToAll:
      body.showDocumentToAll !== undefined ? body.showDocumentToAll : existing.showDocumentToAll ?? true,
    sharedViewMode: body.sharedViewMode !== undefined ? body.sharedViewMode : existing.sharedViewMode ?? 'both',
  };

  await saveTemplateInDb(c.env.DB, updated, true);
  await createAudit(c.env.DB, auth.user.id, 'Plantilla de proceso actualizada', 'ProcessTemplate', id, updated.name);
  return c.json(updated);
});

app.delete('/api/templates/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para eliminar plantillas de procesos.' }, 403);
  }
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT name FROM process_templates WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!existing) {
    return c.json({ error: 'Plantilla de proceso no encontrada.' }, 404);
  }
  await c.env.DB.prepare('DELETE FROM process_templates WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, 'Plantilla de proceso eliminada', 'ProcessTemplate', id, existing.name);
  return c.json({ success: true, id });
});

// ============================================================================
// 7. Cases (Expedientes / Legajos) & Participants
// ============================================================================
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
  const actorRequirements = template.stages.flatMap(stage => stage.requirements).filter(req => req.type === 'actor' && req.isRequired);
  for (const req of actorRequirements) {
    const count = (Array.isArray(participants) ? participants : []).filter((p: any) => p.role === req.actorRole && p.name?.trim() && p.lastName?.trim() && p.dni?.trim()).length;
    const min = Math.max(1, Number(req.minQuantity) || 1);
    if (count < min) return c.json({ error: `Faltan actores obligatorios: ${req.actorRole || req.name} (${count}/${min}).` }, 400);
  }

  const caseId = `case-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const code = `EXP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const finalManagerId = assignedManagerId || '';
  const status = finalManagerId ? 'active' : 'pending_assignment';
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
    status === 'pending_assignment' ? 'Solicitud de legajo creada' : 'Legajo creado',
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
  const validationForReview = await validateStageRequirements(c.env.DB, id, stageForReview.id, templateForReview!);
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

// ============================================================================
// 8. Shared Documents Library (R2 + D1)
// ============================================================================
app.get('/api/shared-documents', async (c) => {
  const auth = c.get('auth')!;
  const allDocs = await getAllSharedDocuments(c.env);
  if (auth.user.role === 'SUPERADMIN') {
    return c.json(allDocs);
  }
  const visible = allDocs.filter((doc) => {
    const roleAllowed = doc.allowedRoles && doc.allowedRoles.includes(auth.user.role);
    const userAllowed = doc.allowedUserIds && doc.allowedUserIds.includes(auth.user.id);
    return roleAllowed || userAllowed;
  });
  return c.json(visible);
});

app.get('/api/shared-documents/:id/content', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  const roles: string[] = doc.allowed_roles_json ? JSON.parse(doc.allowed_roles_json) : [];
  const userIds: string[] = doc.allowed_user_ids_json ? JSON.parse(doc.allowed_user_ids_json) : [];
  if (
    auth.user.role !== 'SUPERADMIN' &&
    !roles.includes(auth.user.role) &&
    !userIds.includes(auth.user.id)
  ) {
    return c.json({ error: 'Acceso denegado.' }, 403);
  }

  const obj = await c.env.R2_BUCKET.get(doc.r2_key);
  if (!obj) return c.json({ error: 'Contenido no encontrado en R2.' }, 404);
  const text = await obj.text();
  return c.json({ content: text });
});

app.get('/api/shared-documents/:id/download', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  const roles: string[] = doc.allowed_roles_json ? JSON.parse(doc.allowed_roles_json) : [];
  const userIds: string[] = doc.allowed_user_ids_json ? JSON.parse(doc.allowed_user_ids_json) : [];
  if (
    auth.user.role !== 'SUPERADMIN' &&
    !roles.includes(auth.user.role) &&
    !userIds.includes(auth.user.id)
  ) {
    return c.json({ error: 'Acceso denegado.' }, 403);
  }

  const obj = await c.env.R2_BUCKET.get(doc.r2_key);
  if (!obj) return c.json({ error: 'Archivo no encontrado en R2.' }, 404);

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Visualizó / descargó documento compartido "${doc.name}"`,
    'SharedDocument',
    doc.id,
    doc.name
  );

  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.mime_type || guessMimeType(doc.file_name),
      'Content-Disposition': `attachment; filename="${sanitizeFileName(doc.file_name)}"`,
    },
  });
});

app.post('/api/shared-documents', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN' && !(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para subir documentos compartidos.' }, 403);
  }

  const contentType = c.req.header('Content-Type') || '';
  let name = '';
  let fileName = '';
  let fileSize = 0;
  let mimeType = 'application/octet-stream';
  let fileBytes: Uint8Array | null = null;
  let allowedRoles: string[] = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'];
  let allowedUserIds: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    name = String(form.get('name') || '');
    const file = form.get('file') as File | null;
    if (file) {
      fileName = file.name;
      fileSize = file.size;
      mimeType = guessMimeType(file.name, file.type);
      fileBytes = new Uint8Array(await file.arrayBuffer());
    }
    const rolesRaw = form.get('allowedRoles');
    const usersRaw = form.get('allowedUserIds');
    if (rolesRaw) allowedRoles = JSON.parse(String(rolesRaw));
    if (usersRaw) allowedUserIds = JSON.parse(String(usersRaw));
  } else {
    const body = await c.req.json();
    name = body.name || '';
    fileName = body.fileName || '';
    fileSize = body.fileSize || 0;
    allowedRoles = body.allowedRoles || allowedRoles;
    allowedUserIds = body.allowedUserIds || [];
    if (body.fileBase64) {
      const decoded = decodeDataUrl(body.fileBase64, guessMimeType(fileName));
      fileBytes = decoded.bytes;
      mimeType = decoded.mimeType;
      fileSize = decoded.bytes.byteLength;
    }
  }

  if (!name || !fileName || !fileBytes) {
    return c.json({ error: 'Faltan campos obligatorios (nombre, nombre de archivo o contenido).' }, 400);
  }

  const docId = `sh-doc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const r2Key = `shared/${docId}/${sanitizeFileName(fileName)}`;
  await c.env.R2_BUCKET.put(r2Key, fileBytes, { httpMetadata: { contentType: mimeType } });

  const uploadedByLabel = `${auth.user.name} ${auth.user.lastName} (${auth.user.role})`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO shared_documents (id, name, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at, allowed_roles_json, allowed_user_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      docId,
      name,
      fileName,
      mimeType,
      fileSize,
      r2Key,
      uploadedByLabel,
      now,
      JSON.stringify(allowedRoles),
      JSON.stringify(allowedUserIds)
    )
    .run();

  await createAudit(c.env.DB, auth.user.id, `Subió documento compartido "${name}"`, 'SharedDocument', docId, name);

  const allUsers = await c.env.DB.prepare('SELECT id, role FROM users WHERE active = 1').all<{ id: string; role: string }>();
  const targetUserIds = (allUsers.results || [])
    .filter(
      (u) =>
        u.id !== auth.user.id &&
        (allowedRoles.includes(u.role) || allowedUserIds.includes(u.id))
    )
    .map((u) => u.id);

  if (targetUserIds.length > 0) {
    await dispatchQueueJob(c.env, {
      type: 'notification_fanout',
      payload: {
        userIds: targetUserIds,
        title: 'Nuevo Documento Compartido',
        message: `Se ha subido el documento "${name}" a la biblioteca para tu descarga.`,
        notifType: 'info',
      },
    });
  }

  return c.json(
    {
      id: docId,
      name,
      fileName,
      mimeType,
      fileSize,
      r2Key,
      uploadedBy: uploadedByLabel,
      uploadedAt: now,
      allowedRoles,
      allowedUserIds,
      downloadUrl: `/api/shared-documents/${docId}/download`,
    },
    201
  );
});

app.put('/api/shared-documents/:id', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const body = await c.req.json();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  if ((body.allowedRoles || body.allowedUserIds) && auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Sólo el Superadmin puede actualizar los permisos de acceso.' }, 403);
  }

  let nextFileSize = body.fileSize !== undefined ? body.fileSize : doc.file_size;
  if (body.dataUrl !== undefined) {
    const decoded = decodeDataUrl(body.dataUrl, doc.mime_type || guessMimeType(doc.file_name));
    await c.env.R2_BUCKET.put(doc.r2_key, decoded.bytes, {
      httpMetadata: { contentType: decoded.mimeType },
    });
    nextFileSize = decoded.bytes.byteLength;
  } else if (body.textContent !== undefined) {
    const bytes = new TextEncoder().encode(String(body.textContent));
    await c.env.R2_BUCKET.put(doc.r2_key, bytes, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
    nextFileSize = bytes.byteLength;
  }

  const nextName = body.name || doc.name;
  const nextRoles = body.allowedRoles ? JSON.stringify(body.allowedRoles) : doc.allowed_roles_json;
  const nextUsers = body.allowedUserIds ? JSON.stringify(body.allowedUserIds) : doc.allowed_user_ids_json;

  await c.env.DB.prepare(
    'UPDATE shared_documents SET name = ?, file_size = ?, allowed_roles_json = ?, allowed_user_ids_json = ? WHERE id = ?'
  )
    .bind(nextName, nextFileSize, nextRoles, nextUsers, id)
    .run();

  await createAudit(c.env.DB, auth.user.id, `Actualizó el documento compartido "${nextName}"`, 'SharedDocument', id, nextName);
  const updated = (await getAllSharedDocuments(c.env)).find((d) => d.id === id);
  return c.json({ success: true, doc: updated });
});

app.delete('/api/shared-documents/:id', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Sólo el Superadmin puede eliminar documentos de la biblioteca.' }, 403);
  }
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado en la biblioteca.' }, 404);

  if (doc.r2_key) {
    await c.env.R2_BUCKET.delete(doc.r2_key);
  }
  await c.env.DB.prepare('DELETE FROM shared_documents WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, `Eliminó documento compartido "${doc.name}"`, 'SharedDocument', id, doc.name);
  return c.json({ success: true, id });
});

// ============================================================================
// 9. Case Documents (R2 Storage + D1 Metadata & Versions)
// ============================================================================
app.get('/api/cases/:caseId/documents', async (c) => {
  const auth = c.get('auth')!;
  const { caseId } = c.req.param();
  const allDocs = (await getAllDocuments(c.env.DB)).filter((d) => d.caseId === caseId);
  if (auth.user.role !== 'SUPERADMIN' && auth.user.role !== 'ADMIN') {
    return c.json(
      allDocs.filter((d) => {
        if (d.status === 'approved' && d.allowedRoles && d.allowedRoles.length > 0) {
          return d.allowedRoles.includes(auth.user.role);
        }
        return true;
      })
    );
  }
  return c.json(allDocs);
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

  if (doc.status === 'approved' && doc.allowed_roles_json && !['SUPERADMIN', 'ADMIN'].includes(auth.user.role)) {
    const allowed: string[] = JSON.parse(doc.allowed_roles_json);
    if (allowed.length > 0 && !allowed.includes(auth.user.role)) {
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

  const rolesJson =
    status === 'approved'
      ? JSON.stringify(allowedRoles || ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'])
      : docRow.allowed_roles_json;

  await c.env.DB.prepare('UPDATE documents SET status = ?, allowed_roles_json = ? WHERE id = ?')
    .bind(status, rolesJson, id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Documento ${status === 'approved' ? 'aprobado' : 'rechazado'}: "${docRow.name}"`,
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

    await createNotification(
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

// ============================================================================
// 10. Tasks, Observations, Forms, Notifications, Audit Logs
// ============================================================================
app.get('/api/cases/:caseId/tasks', async (c) => {
  const { caseId } = c.req.param();
  const res = await c.env.DB.prepare('SELECT * FROM tasks WHERE case_id = ?').bind(caseId).all<any>();
  return c.json(
    (res.results || []).map((t) => ({
      id: t.id,
      caseId: t.case_id,
      stageId: t.stage_id,
      requirementId: t.requirement_id,
      name: t.name,
      description: t.description || '',
      status: t.status,
      completedBy: t.completed_by || undefined,
      completedAt: t.completed_at || undefined,
    }))
  );
});

async function handleTaskToggle(c: AppContext) {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { status } = await c.req.json();
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<any>();
  if (!task) return c.json({ error: 'Tarea no encontrada' }, 404);

  const now = status === 'completed' ? new Date().toISOString() : null;
  const completedBy = status === 'completed' ? auth.user.id : null;

  await c.env.DB.prepare('UPDATE tasks SET status = ?, completed_by = ?, completed_at = ? WHERE id = ?')
    .bind(status, completedBy, now, id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Tarea marcada como ${status === 'completed' ? 'completa' : 'pendiente'}: "${task.name}"`,
    'Task',
    id,
    task.name
  );

  return c.json({
    id: task.id,
    caseId: task.case_id,
    stageId: task.stage_id,
    requirementId: task.requirement_id,
    name: task.name,
    description: task.description || '',
    status,
    completedBy: completedBy || undefined,
    completedAt: now || undefined,
  });
}

app.post('/api/tasks/:id', handleTaskToggle);
app.put('/api/tasks/:id', handleTaskToggle);
app.post('/api/tasks/:id/toggle', handleTaskToggle);
app.put('/api/tasks/:id/toggle', handleTaskToggle);

app.get('/api/cases/:caseId/observations', async (c) => {
  const { caseId } = c.req.param();
  const res = await c.env.DB.prepare('SELECT * FROM observations WHERE case_id = ? ORDER BY created_at DESC')
    .bind(caseId)
    .all<any>();
  return c.json(
    (res.results || []).map((o) => ({
      id: o.id,
      caseId: o.case_id,
      stageId: o.stage_id,
      requirementId: o.requirement_id || undefined,
      documentId: o.document_id || undefined,
      text: o.text,
      createdBy: o.created_by,
      createdAt: o.created_at,
      status: o.status,
      resolvedBy: o.resolved_by || undefined,
      resolvedAt: o.resolved_at || undefined,
      response: o.response || undefined,
    }))
  );
});

app.post('/api/observations', async (c) => {
  const auth = c.get('auth')!;
  const { caseId, stageId, text, requirementId } = await c.req.json();
  const obsId = `obs-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO observations (id, case_id, stage_id, requirement_id, text, created_by, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`
  )
    .bind(obsId, caseId, stageId, requirementId || null, text, auth.user.id, now)
    .run();

  const caseObj = await getCaseById(c.env.DB, caseId);
  if (caseObj) {
    await c.env.DB.prepare("UPDATE cases SET status = 'observed', updated_at = ? WHERE id = ?")
      .bind(now, caseId)
      .run();
    await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Nueva Observación',
      `Se agregó una observación en el legajo ${caseObj.code}: "${text}"`,
      'warning',
      caseId
    );
  }

  await createAudit(c.env.DB, auth.user.id, 'Observación agregada', 'Observation', obsId, `${text.substring(0, 30)}...`);
  return c.json(
    {
      id: obsId,
      caseId,
      stageId,
      requirementId,
      text,
      createdBy: auth.user.id,
      createdAt: now,
      status: 'open',
    },
    201
  );
});

async function handleResolveObservation(c: AppContext) {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { response } = await c.req.json();
  const obs = await c.env.DB.prepare('SELECT * FROM observations WHERE id = ?').bind(id).first<any>();
  if (!obs) return c.json({ error: 'Observación no encontrada' }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE observations SET status = 'resolved', response = ?, resolved_by = ?, resolved_at = ? WHERE id = ?"
  )
    .bind(response || '', auth.user.id, now, id)
    .run();

  if (obs.document_id) {
    await c.env.DB.prepare(
      "UPDATE documents SET status = 'uploaded' WHERE id = ? AND status = 'rejected'"
    )
      .bind(obs.document_id)
      .run();
  }

  const caseObj = await getCaseById(c.env.DB, obs.case_id);
  if (caseObj) {
    const [openObs, rejDocs, upDocs] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id FROM observations WHERE case_id = ? AND stage_id = ? AND status = 'open' LIMIT 1"
      )
        .bind(caseObj.id, obs.stage_id)
        .first(),
      c.env.DB.prepare(
        "SELECT id FROM documents WHERE case_id = ? AND stage_id = ? AND status = 'rejected' LIMIT 1"
      )
        .bind(caseObj.id, obs.stage_id)
        .first(),
      c.env.DB.prepare(
        "SELECT id FROM documents WHERE case_id = ? AND stage_id = ? AND status = 'uploaded' LIMIT 1"
      )
        .bind(caseObj.id, obs.stage_id)
        .first(),
    ]);

    const nextStatus =
      openObs || rejDocs ? 'observed' : upDocs ? 'pending_review' : 'active';
    await c.env.DB.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, now, caseObj.id)
      .run();

    if (caseObj.assignedManagerId) {
      await createNotification(
        c.env.DB,
        caseObj.assignedManagerId,
        'Observación Respondida',
        `El asesor respondió a la observación en ${caseObj.code}`,
        'success',
        obs.case_id
      );
    }
  }

  await createAudit(c.env.DB, auth.user.id, 'Observación resuelta', 'Observation', id, `${obs.text.substring(0, 30)}...`);
  return c.json({
    obs: {
      id: obs.id,
      caseId: obs.case_id,
      stageId: obs.stage_id,
      requirementId: obs.requirement_id || undefined,
      documentId: obs.document_id || undefined,
      text: obs.text,
      createdBy: obs.created_by,
      createdAt: obs.created_at,
      status: 'resolved',
      resolvedBy: auth.user.id,
      resolvedAt: now,
      response,
    },
    case: await getCaseById(c.env.DB, obs.case_id),
  });
}

app.post('/api/observations/:id/resolve', handleResolveObservation);
app.put('/api/observations/:id/resolve', handleResolveObservation);

app.post('/api/forms/submit', async (c) => {
  const auth = c.get('auth')!;
  const { caseId, stageId, requirementId, values } = await c.req.json();
  const now = new Date().toISOString();
  const id = `frm-${crypto.randomUUID().slice(0, 8)}`;

  await c.env.DB.prepare(
    `INSERT INTO form_submissions (id, case_id, stage_id, requirement_id, values_json, submitted_by, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(requirement_id) DO UPDATE SET
       values_json = excluded.values_json,
       submitted_by = excluded.submitted_by,
       submitted_at = excluded.submitted_at`
  )
    .bind(id, caseId || null, stageId || null, requirementId, JSON.stringify(values), auth.user.id, now)
    .run();

  await createAudit(c.env.DB, auth.user.id, 'Formulario guardado', 'Form', requirementId, 'Valores guardados');
  return c.json({ requirementId, values, submittedBy: auth.user.id, submittedAt: now });
});

app.get('/api/forms/:requirementId', async (c) => {
  const { requirementId } = c.req.param();
  const sub = await c.env.DB.prepare('SELECT * FROM form_submissions WHERE requirement_id = ?')
    .bind(requirementId)
    .first<any>();
  if (!sub) return c.json(null);
  return c.json({
    requirementId: sub.requirement_id,
    values: JSON.parse(sub.values_json),
    submittedBy: sub.submitted_by,
    submittedAt: sub.submitted_at,
  });
});

app.get('/api/notifications', async (c) => {
  const auth = c.get('auth')!;
  const res = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC'
  )
    .bind(auth.user.id)
    .all<any>();
  return c.json(
    (res.results || []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      title: n.title,
      message: n.message,
      type: n.type,
      read: n.read === 1,
      createdAt: n.created_at,
      caseId: n.case_id || undefined,
    }))
  );
});

async function handleReadNotif(c: AppContext) {
  const { id } = c.req.param();
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ?').bind(id).run();
  const notif = await c.env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first<any>();
  return c.json(
    notif
      ? {
          id: notif.id,
          userId: notif.user_id,
          title: notif.title,
          message: notif.message,
          type: notif.type,
          read: notif.read === 1,
          createdAt: notif.created_at,
          caseId: notif.case_id || undefined,
        }
      : null
  );
}

app.post('/api/notifications/:id/read', handleReadNotif);
app.put('/api/notifications/:id/read', handleReadNotif);

app.delete('/api/notifications/:id', async (c) => {
  const { id } = c.req.param();
  await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

async function handleReadAllNotifs(c: AppContext) {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?')
    .bind(auth.user.id)
    .run();
  return c.json({ success: true });
}

app.post('/api/notifications/read-all', handleReadAllNotifs);
app.put('/api/notifications/read-all', handleReadAllNotifs);

app.post('/api/notifications/clear-all', async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(auth.user.id).run();
  return c.json({ success: true });
});

app.get('/api/audit-logs', async (c) => {
  const auth = c.get('auth')!;
  const isSuper = auth.realUser.role === 'SUPERADMIN';
  if (!isSuper && auth.realUser.role !== 'ADMIN') return c.json({ error: 'Acceso a auditoría no autorizado.' }, 403);
  const requestedLimit = Number(c.req.query('limit'));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 500;
  const offset = Math.max(0, Math.min(Number(c.req.query('offset')) || 0, 100000));
  const rows = await c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').bind(limit, offset).all<any>();
  const logs = (rows.results || [])
    .map((l) => ({
      id: l.id,
      userId: l.user_id,
      userName: l.user_name,
      userRole: l.user_role,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      entityName: l.entity_name,
      createdAt: l.created_at,
    }))
    .filter((l) => isSuper || l.userRole !== 'SUPERADMIN');
  return c.json(logs);
});

// Audit entries are server-generated. Clients cannot fabricate audit actions.
app.post('/api/audit-logs/log', (c) => c.json({ error: 'Los registros de auditoría se generan exclusivamente en el servidor.' }, 403));

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
      generateFlow: false,
    });

    const finalTemplate: ProcessTemplate = {
      id: `tmpl-dig-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
      ...digitized,
    };
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
    const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await ensureDatabaseReady(env.DB);
    await env.DB.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(cutoff).run();
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
