import type { Env } from './types';

const PBKDF2_ITERATIONS = 100000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function generateSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    keyMaterial,
    256
  );

  return `pbkdf2_sha512:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(derivedBits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha512') {
    return false;
  }

  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-512',
    },
    keyMaterial,
    expected.length * 8
  );

  return timingSafeEqual(new Uint8Array(derivedBits), expected);
}

export async function verifyTurnstileToken(
  env: Env,
  token: string | undefined,
  remoteIp: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!env.TURNSTILE_SECRET_KEY) {
    // Turnstile not configured in environment variables (e.g., local dev before adding secrets).
    return { success: true };
  }

  if (!token) {
    return { success: false, error: 'Verificación de seguridad Turnstile requerida.' };
  }

  const formData = new FormData();
  formData.append('secret', env.TURNSTILE_SECRET_KEY);
  formData.append('response', token);
  if (remoteIp) {
    formData.append('remoteip', remoteIp);
  }

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const outcome = (await resp.json()) as { success: boolean; 'error-codes'?: string[] };
    if (!outcome.success) {
      return {
        success: false,
        error: 'Validación Turnstile inválida o expirada. Intente nuevamente.',
      };
    }
    return { success: true };
  } catch (err) {
    console.error('Turnstile verification error:', err);
    return { success: false, error: 'No se pudo validar Turnstile contra Cloudflare.' };
  }
}

export async function checkLoginRateLimit(
  env: Env,
  key: string,
  maxAttempts = 5,
  windowSeconds = 900
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const raw = await env.KV.get(`rl:${key}`);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= maxAttempts) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: maxAttempts - count };
  } catch {
    return { allowed: true, remaining: maxAttempts };
  }
}

export async function recordFailedLoginAttempt(
  env: Env,
  key: string,
  windowSeconds = 900
): Promise<void> {
  try {
    const raw = await env.KV.get(`rl:${key}`);
    const next = (raw ? parseInt(raw, 10) : 0) + 1;
    await env.KV.put(`rl:${key}`, String(next), { expirationTtl: windowSeconds });
  } catch (err) {
    console.warn('KV rate limit record failed:', err);
  }
}

export async function clearLoginRateLimit(env: Env, key: string): Promise<void> {
  try {
    await env.KV.delete(`rl:${key}`);
  } catch {
    // ignore
  }
}
