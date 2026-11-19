import { registerAccessAndAiSettings } from './access-ai-settings';
import { registerStageTransitionRoutes } from './stage-transition-routes';
import { dispatchQueueJob, processQueueJob } from './queue-jobs';
import { registerConfigAdminRoutes } from './config-admin-routes';
import { registerAiDocumentRoutes } from './ai-document-routes';
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

registerAccessAndAiSettings(app);

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

registerConfigAdminRoutes(app, dispatchQueueJob);

registerSystemMessageRoutes(app);

const identifyDigitizedFields = registerTemplateRoutes(app);

registerCaseRoutes(app, { dispatchQueueJob, getClientIp });

registerConfeccionesRoutes(app);

registerStageTransitionRoutes(app);

registerSharedDocumentRoutes(app, dispatchQueueJob);

registerDocumentRoutes(app);

registerCaseWorkflowRoutes(app, registerNotificationRoutes);

registerAiDocumentRoutes(app, identifyDigitizedFields);

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
