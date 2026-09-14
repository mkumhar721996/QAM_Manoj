const DEFAULT_API_PORT = 8001;

export function getApiBaseUrl() {
  const apiPort = window.__DEFECT_TRACKER_API_PORT__ ?? DEFAULT_API_PORT;
  return `${window.location.protocol}//${window.location.hostname}:${apiPort}`;
}
