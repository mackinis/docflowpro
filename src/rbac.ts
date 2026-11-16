export const RBAC_MODULES = ['dashboard','audit','cases','documents','messages','notifications','templates','users','userEmail','userRole','userPassword','userStatus','userSensitive','settings','ai'] as const;
export const RBAC_ACTIONS = ['view','create','edit','delete','download','manage'] as const;
export type RbacModule = typeof RBAC_MODULES[number];
export type RbacAction = typeof RBAC_ACTIONS[number];
export type RbacRole = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'ASESOR';
export type PermissionKey = `${RbacModule}.${RbacAction}`;
export type RbacMatrix = { roles: Partial<Record<Exclude<RbacRole,'SUPERADMIN'>, Partial<Record<PermissionKey, boolean>>>>; users: Record<string, Partial<Record<PermissionKey, boolean>>> };
export const RBAC_LABELS: Record<RbacModule,string> = {dashboard:'Tablero',audit:'Auditoría',cases:'Legajos',documents:'Documentos',messages:'Mensajes',notifications:'Notificaciones',templates:'Plantillas y procesos',users:'Usuarios',userEmail:'Email de acceso',userRole:'Rol de usuario',userPassword:'Contraseña de usuario',userStatus:'Estado de usuario',userSensitive:'Permisos sensibles',settings:'Configuración',ai:'Agente IA'};
export const RBAC_ACTION_LABELS: Record<RbacAction,string> = {view:'Ver',create:'Crear',edit:'Editar',delete:'Eliminar',download:'Descargar',manage:'Administrar'};
export const RBAC_DEFAULTS: Record<Exclude<RbacRole,'SUPERADMIN'>,Partial<Record<PermissionKey,boolean>>> = {
  ADMIN: { 'userRole.edit':false, 'userSensitive.edit':false }, MANAGER: { 'users.manage':false,'userEmail.edit':false,'userRole.edit':false,'userPassword.edit':false,'userStatus.edit':false,'userSensitive.edit':false,'settings.manage':false,'audit.view':false }, ASESOR: { 'users.manage':false,'users.create':false,'users.edit':false,'users.delete':false,'userEmail.edit':false,'userRole.edit':false,'userPassword.edit':false,'userStatus.edit':false,'userSensitive.edit':false,'settings.manage':false,'audit.view':false,'templates.manage':false }
};
export function isRbacKey(key: string): key is PermissionKey {
  const [module, action, extra] = key.split('.');
  return !extra && RBAC_MODULES.includes(module as RbacModule) && RBAC_ACTIONS.includes(action as RbacAction);
}
export function hasRbacPermission(matrix: RbacMatrix | null | undefined, role: RbacRole, userId: string, key: PermissionKey): boolean {
  if (role === 'SUPERADMIN') return true;
  const userOverride = matrix?.users?.[userId]?.[key];
  if (typeof userOverride === 'boolean') return userOverride;
  const roleOverride = matrix?.roles?.[role]?.[key];
  if (typeof roleOverride === 'boolean') return roleOverride;
  const baseline = RBAC_DEFAULTS[role]?.[key];
  return typeof baseline === 'boolean' ? baseline : true;
}
