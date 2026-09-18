type LogFields = Record<string, unknown>;

function log(level: "info" | "warn" | "error", message: string, fields: LogFields = {}): void {
  const entry = JSON.stringify({ level, message, ...fields, timestamp: new Date().toISOString() });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

interface EndpointCounters {
  requests: number;
  errors: number;
}

const endpointMetrics = new Map<string, EndpointCounters>();

// Minimal in-process RED (rate/error/duration) counters, logged as structured
// records on every request so an on-call engineer can grep/aggregate them
// without a separate metrics backend.
function recordRequest(endpoint: string, durationMs: number, isError: boolean): void {
  const counters = endpointMetrics.get(endpoint) ?? { requests: 0, errors: 0 };
  counters.requests += 1;
  if (isError) counters.errors += 1;
  endpointMetrics.set(endpoint, counters);
  log(isError ? "error" : "info", "request completed", {
    endpoint,
    duration_ms: durationMs,
    error: isError,
    total_requests: counters.requests,
    total_errors: counters.errors,
  });
}

export function getEndpointMetrics(endpoint: string): EndpointCounters | undefined {
  return endpointMetrics.get(endpoint);
}

export { log, recordRequest };
