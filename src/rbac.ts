export const RBAC_MODULES = ['dashboard','statistics','audit','cases','documents','messages','notifications','templates','users','userEmail','userRole','userPassword','userStatus','userSensitive','settings','ai'] as const;
export const RBAC_ACTIONS = ['view','create','edit','delete','download','manage'] as const;
export type RbacModule = typeof RBAC_MODULES[number];
export type RbacAction = typeof RBAC_ACTIONS[number];
export type RbacRole = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'ASESOR';
export type PermissionKey = `${RbacModule}.${RbacAction}`;
export type RbacMatrix = { roles: Partial<Record<Exclude<RbacRole,'SUPERADMIN'>, Partial<Record<PermissionKey, boolean>>>>; users: Record<string, Partial<Record<PermissionKey, boolean>>> };
export const RBAC_LABELS: Record<RbacModule,string> = {dashboard:'Tablero',statistics:'Estadísticas de asesores',audit:'Auditoría',cases:'Legajos',documents:'Documentos',messages:'Mensajes',notifications:'Notificaciones',templates:'Plantillas y procesos',users:'Usuarios',userEmail:'Email de acceso',userRole:'Rol de usuario',userPassword:'Contraseña de usuario',userStatus:'Estado de usuario',userSensitive:'Permisos sensibles',settings:'Configuración',ai:'Agente IA'};

// Only actions with a concrete API/UI effect may be configured.
// "manage" is retained for statistics where it is a distinct authorization.
export const RBAC_APPLICABLE_ACTIONS: Record<RbacModule, readonly RbacAction[]> = {
  dashboard: ['view'],
  statistics: ['view', 'manage'],
  audit: ['view', 'download'],
  cases: ['view', 'create', 'edit', 'delete', 'download'],
  documents: ['view', 'create', 'edit', 'delete', 'download'],
  messages: ['view', 'create', 'edit', 'delete'],
  notifications: ['view', 'edit', 'delete'],
  templates: ['view', 'create', 'edit', 'delete'],
  users: ['view', 'create', 'edit', 'delete'],
  userEmail: ['edit'],
  userRole: ['edit'],
  userPassword: ['edit'],
  userStatus: ['edit'],
  userSensitive: ['edit'],
  settings: ['view', 'edit'],
  ai: ['view', 'edit'],
};
export function isApplicableRbacPermission(key: PermissionKey): boolean {
  const [module, action] = key.split('.') as [RbacModule, RbacAction];
  return RBAC_APPLICABLE_ACTIONS[module]?.includes(action) === true;
}

export const RBAC_ACTION_LABELS: Record<RbacAction,string> = {view:'Ver',create:'Crear',edit:'Editar',delete:'Eliminar',download:'Descargar',manage:'Administrar'};
// Asesor: explicit allowlist. Every unspecified action is denied by default.
const ASESOR_ALLOWED: Partial<Record<RbacModule, readonly RbacAction[]>> = {
  dashboard: ['view'],
  statistics: ['view'],
  audit: ['view'],
  cases: ['view','create','edit'],
  documents: ['view'],
  messages: ['view','create'],
  notifications: ['view'],

  userEmail: ['view','edit'],
  userRole: ['view'],
  userPassword: ['view','edit'],
  userStatus: ['view'],
  ai: ['view','create','edit'],
};
const ASESOR_DEFAULTS = Object.fromEntries(
  RBAC_MODULES.flatMap(module => RBAC_ACTIONS.map(action =>
    [`${module}.${action}`, (ASESOR_ALLOWED[module] || []).includes(action)]
  ))
) as Record<PermissionKey, boolean>;
// Materialize the legacy ADMIN/MANAGER grants explicitly. Unknown/new permissions
// are denied until reviewed, without silently revoking today's established grants.
const LEGACY_GRANTED_ACTIONS = Object.fromEntries(
  RBAC_MODULES.flatMap(module => RBAC_ACTIONS.map(action => {
    const key = `${module}.${action}` as PermissionKey;
    return [key, isApplicableRbacPermission(key)];
  }))
) as Record<PermissionKey, boolean>;
export const RBAC_DEFAULTS: Record<Exclude<RbacRole,'SUPERADMIN'>,Partial<Record<PermissionKey,boolean>>> = {
  ADMIN: { ...LEGACY_GRANTED_ACTIONS, 'userRole.edit':false, 'userSensitive.edit':false },
  MANAGER: { ...LEGACY_GRANTED_ACTIONS, 'statistics.manage':true,'users.manage':false,'userEmail.edit':false,'userRole.edit':false,'userPassword.edit':false,'userStatus.edit':false,'userSensitive.edit':false,'settings.manage':false,'audit.view':false },
  ASESOR: ASESOR_DEFAULTS,
};
// Non-delegable boundaries for advisers, even when an old stored override says otherwise.
export function isForbiddenForAsesor(key: PermissionKey): boolean {
  return key.startsWith('templates.') || key.endsWith('.manage') || key.startsWith('userSensitive.') || key.startsWith('settings.') ||
    key === 'users.create' || key === 'users.edit' || key === 'users.delete';
}
export function isRbacKey(key: string): key is PermissionKey {
  const [module, action, extra] = key.split('.');
  return !extra && RBAC_MODULES.includes(module as RbacModule) && RBAC_ACTIONS.includes(action as RbacAction);
}
// Hard server-side boundaries. These permissions cannot be delegated through RBAC.
export function isNonDelegablePermission(role: RbacRole, key: PermissionKey): boolean {
  if (role === 'SUPERADMIN') return false;
  if (!isApplicableRbacPermission(key)) return true;
  if (key === 'cases.delete') return true;
  return role === 'ASESOR' && isForbiddenForAsesor(key);
}
export function hasRbacPermission(matrix: RbacMatrix | null | undefined, role: RbacRole, userId: string, key: PermissionKey): boolean {
  if (!isApplicableRbacPermission(key)) return false;
  if (role === 'SUPERADMIN') return true;
  if (isNonDelegablePermission(role, key)) return false;
  const userOverride = matrix?.users?.[userId]?.[key];
  if (typeof userOverride === 'boolean') return userOverride;
  const roleOverride = matrix?.roles?.[role]?.[key];
  if (typeof roleOverride === 'boolean') return roleOverride;
  const baseline = RBAC_DEFAULTS[role]?.[key];
  return baseline === true;
}
