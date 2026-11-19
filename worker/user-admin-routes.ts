import type { Hono } from 'hono';
import type { User } from '../src/types';
import { PRESET_AVATARS } from '../src/data';
import type { Env, AppVariables } from './types';
import { hashPassword } from './crypto';
import { createAudit, getSystemConfigValue, mapUserRow, setSystemConfigValue } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** User CRUD, account creation delegation and registration policy routes. */
export function registerUserAdminRoutes(app: WorkerApp) {
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


}
