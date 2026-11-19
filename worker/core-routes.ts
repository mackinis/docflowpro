import type { Hono } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, getFullState } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

export function registerCoreRoutes(app: WorkerApp): void {
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
// 2. App State
// ============================================================================
app.get('/api/state', async (c) => {
  const auth = c.get('auth')!;
  const state = await getFullState(c.env, auth.user, auth.realUser);
  return c.json(state);
});

}
