import { apiRequest } from './apiTransport';

/** Template and shared-document API routes. Request options are forwarded unchanged. */
export function analyzeTemplateFields(options: RequestInit): Promise<Response> {
  return apiRequest('/api/templates/analyze-fields', options);
}
export function confirmTemplateFieldReview(options: RequestInit): Promise<Response> {
  return apiRequest('/api/templates/confirm-field-review', options);
}
export function digitizeTemplate(options: RequestInit): Promise<Response> {
  return apiRequest('/api/ai/digitize-template', options);
}
export function templateCollection(options: RequestInit): Promise<Response> {
  return apiRequest('/api/templates', options);
}
export function templateItem(id: string, options: RequestInit, currentUserId?: string): Promise<Response> {
  const path = `/api/templates/${id}` + (currentUserId === undefined ? '' : `?currentUserId=${currentUserId}`);
  return apiRequest(path, options);
}
export function publishSharedDocument(options: RequestInit): Promise<Response> {
  return apiRequest('/api/shared-documents', options);
}
