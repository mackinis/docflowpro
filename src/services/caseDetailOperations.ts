import { apiRequest } from './apiTransport';

/** Case detail endpoints, isolated from the React presentation layer. */
export function sharedDocumentsForUser(userId: string, role: string): Promise<Response> {
  return apiRequest(`/api/shared-documents?userId=${userId}&role=${role}`, { credentials: 'include' });
}
export function downloadCaseFile(url: string): Promise<Response> {
  return apiRequest(url, { credentials: 'include' });
}
export function createUploadRequest(options: RequestInit): Promise<Response> {
  return apiRequest('/api/upload-requests/create', options);
}
export function reviewUploadRequest(options: RequestInit): Promise<Response> {
  return apiRequest('/api/upload-requests/review', options);
}
export function requestCaseReassignment(caseId: string, options: RequestInit): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}/request-reassignment`, options);
}
export function requestCaseReview(caseId: string, options: RequestInit): Promise<Response> {
  return apiRequest(`/api/cases/${caseId}/request-review`, options);
}
export function analyzeCaseDocument(options: RequestInit): Promise<Response> {
  return apiRequest('/api/ai/analyze-document', options);
}
export function caseHistory(caseId: string): Promise<Response> {
  return apiRequest(`/api/cases/${encodeURIComponent(caseId)}/history`, { credentials: 'include' });
}
