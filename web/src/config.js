export const API_PORT = 8001;

export function getApiBaseUrl() {
  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}
