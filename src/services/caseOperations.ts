import { apiRequest } from './apiTransport';

/** HTTP boundary for case lifecycle operations. Response handling stays with callers. */
export function createCase(payload: unknown): Promise<Response> {
  return apiRequest('/api/cases', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export function assignCaseManager(caseId: string, managerId: string, currentUserId: string): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}/assign-manager`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ managerId, currentUserId }),
  });
}
export function deleteCase(caseId: string, currentUserId: string): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}?currentUserId=${currentUserId}`, {
    method: 'DELETE', credentials: 'include',
  });
}
export function uploadCaseDocument(data: FormData): Promise<Response> {
  return apiRequest('/api/documents/upload', { method: 'POST', credentials: 'include', body: data });
}
