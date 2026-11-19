import type { Hono } from 'hono';
import type { Env, AppVariables, QueueJob } from './types';
import { createAudit, setSystemConfigValue, getSystemConfigValue, DEFAULT_SYSTEM_SETTINGS, getFullState } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;
export function registerConfigAdminRoutes(app: WorkerApp, dispatchQueueJob: (env: Env, job: QueueJob) => Promise<void>): void {
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


}
