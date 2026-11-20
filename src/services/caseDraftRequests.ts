import { apiRequest } from './apiTransport';

/** Case draft persistence. HTTP status and response parsing remain with callers. */
export function fetchCaseDrafts(): Promise<Response> {
  return apiRequest('/api/case-drafts', { credentials: 'include' });
}
export function saveCaseDraft(id: string, payload: unknown): Promise<Response> {
  return apiRequest('/api/case-drafts/' + id, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export function deleteCaseDraft(id: string): Promise<Response> {
  return apiRequest('/api/case-drafts/' + id, { method: 'DELETE', credentials: 'include' });
}
