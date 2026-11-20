/**
 * Shared HTTP transport for feature modules.
 * Preserve the caller's RequestInit exactly: credentials, cache, headers, body,
 * abort signals and error handling remain owned by the feature service.
 * Do not retry mutations automatically.
 */
export function apiRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
