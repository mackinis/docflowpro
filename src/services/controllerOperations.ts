import { apiRequest } from './apiTransport';

/** Session, document review, forms and stage lifecycle HTTP boundary. */
export function impersonateUser(targetUserId: string): Promise<Response> {
  return apiRequest('/api/auth/impersonate', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId }),
  });
}
export function reviewDocument(docId: string, status: 'approved' | 'rejected' | 'uploaded', observationText?: string, allowedRoles?: string[]): Promise<Response> {
  return apiRequest(`/api/documents/${docId}/review`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, observationText, allowedRoles }),
  });
}
export function submitCaseForm(caseId: string, stageId: string, requirementId: string, values: Record<string, string | number | boolean>): Promise<Response> {
  return apiRequest('/api/forms/submit', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId, stageId, requirementId, values }),
  });
}
export function advanceCaseStage(caseId: string, userId: string): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}/advance`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}
export function approveCaseStage(caseId: string, userId: string): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}/approve-stage`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}
export function reopenCase(caseId: string, password: string): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}/reopen`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}
