// Short-lived, per-tab cache. Never persisted: credentials and permissions stay session-scoped.
const requests = new Map<string, { expires: number; promise: Promise<unknown> }>();
const TTL_MS = 30_000;

export function cachedJson<T>(key: string, url: string, force = false): Promise<T> {
  const now = Date.now();
  if (force) requests.delete(key);
  const previous = requests.get(key);
  if (previous && previous.expires > now) return previous.promise as Promise<T>;
  const promise = fetch(url, { credentials: 'include' }).then(async response => {
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'No se pudieron cargar los datos.');
    }
    return response.json() as Promise<T>;
  }).catch(error => {
    if (requests.get(key)?.promise === promise) requests.delete(key);
    throw error;
  });
  requests.set(key, { expires: now + TTL_MS, promise });
  return promise;
}

export function invalidateCachedJson(prefix?: string): void {
  for (const key of requests.keys()) {
    if (!prefix || key.startsWith(prefix)) requests.delete(key);
  }
}
