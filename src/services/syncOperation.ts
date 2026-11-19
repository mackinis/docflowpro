import { invalidateCachedJson } from '../utils/requestCache';

/** Shared authenticated mutation transport; refreshes only after a successful write. */
export async function performSyncOperation(url: string, options: RequestInit, refresh: () => Promise<void>): Promise<void> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...((options.headers as Record<string, string>) || {})
  };
  const response = await fetch(url, { ...options, credentials: 'include', headers });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Ocurrió un error en el servidor.');
  }
  invalidateCachedJson('statistics:');
  await refresh();
}
