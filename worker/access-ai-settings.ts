import type { Hono, Context } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, getSystemConfigValue, setSystemConfigValue, DEFAULT_SYSTEM_SETTINGS } from './db';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export function registerAccessAndAiSettings(app: Hono<{ Bindings: Env; Variables: AppVariables }>) {
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
    const { RBAC_MODULES, RBAC_ACTIONS } = await import('../src/rbac');
    const permissions = Object.fromEntries(RBAC_MODULES.map(module => [
      module,
      Object.fromEntries(RBAC_ACTIONS.map(action => [
        action, hasRbacPermission(matrix, auth.user.role, auth.user.id, `${module}.${action}`)
      ]))
    ]));
    return c.json(permissions);
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
  
  
}
