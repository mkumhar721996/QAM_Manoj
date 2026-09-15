export interface RouteMetricsSnapshot {
  requestCount: number;
  errorCount: number;
  averageDurationMs: number;
}

interface RouteMetrics {
  requestCount: number;
  errorCount: number;
  totalDurationMs: number;
}

class MetricsRegistry {
  private routes = new Map<string, RouteMetrics>();

  recordRequest(route: string, status: number, durationMs: number): void {
    const current = this.routes.get(route) ?? { requestCount: 0, errorCount: 0, totalDurationMs: 0 };
    current.requestCount += 1;
    current.totalDurationMs += durationMs;
    if (status >= 400) {
      current.errorCount += 1;
    }
    this.routes.set(route, current);
  }

  snapshot(): Record<string, RouteMetricsSnapshot> {
    const result: Record<string, RouteMetricsSnapshot> = {};
    for (const [route, current] of this.routes) {
      result[route] = {
        requestCount: current.requestCount,
        errorCount: current.errorCount,
        averageDurationMs: current.requestCount > 0 ? current.totalDurationMs / current.requestCount : 0,
      };
    }
    return result;
  }
}

export const metricsRegistry = new MetricsRegistry();
