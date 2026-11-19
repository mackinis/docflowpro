import type { Hono, Context } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import type { User } from '../src/types';
import { PRESET_AVATARS } from '../src/data';
import type { Env, AppVariables, QueueJob } from './types';
import { clearLoginRateLimit, checkLoginRateLimit, generateSecureToken, hashPassword, recordFailedLoginAttempt, sha256Hex, verifyPassword, verifyTurnstileToken } from './crypto';
import { createAudit, getSystemConfigValue, mapUserRow } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Auth, bootstrap, sessions, registration, impersonation and recovery. */
export function registerAuthRoutes(app: WorkerApp, dependencies: {
  getClientIp: (req: Request) => string;
  issueSessionCookie: (c: AppContext, rawToken: string) => void;
  dispatchQueueJob: (env: Env, job: QueueJob) => Promise<void>;
  sessionCookieName: string;
  sessionTtlSeconds: number;
}) {
const { getClientIp, issueSessionCookie, dispatchQueueJob, sessionCookieName: SESSION_COOKIE_NAME, sessionTtlSeconds: SESSION_TTL_SECONDS } = dependencies;
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


}
