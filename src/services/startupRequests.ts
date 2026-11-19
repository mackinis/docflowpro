// Startup requests are safe GETs. Retry only transient failures; never retry auth errors.
const STARTUP_RETRY_STATUSES = new Set([429, 502, 503, 504]);

export async function fetchStartupEndpoint(path: string): Promise<Response> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(path, {
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000)
      });
      if (!STARTUP_RETRY_STATUSES.has(response.status) || attempt === maxAttempts - 1) {
        return response;
      }
      console.warn('Transient startup response', { path, status: response.status, attempt: attempt + 1 });
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      console.warn('Transient startup request failure', { path, attempt: attempt + 1, error });
    }
    // Bounded backoff; no retry loop for permanent 4xx failures.
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new Error('No se pudo completar la solicitud inicial.');
}

export async function startupHttpError(response: Response, endpoint: string): Promise<Error> {
  const detail = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (detail.error === 'database_initializing') {
    return new Error('La base de datos todavía no está disponible (HTTP 503). Revisar inicialización D1.');
  }
  return new Error(`Error del servidor en ${endpoint} (HTTP ${response.status}): ${detail.message || detail.error || 'sin detalle'}`);
}

