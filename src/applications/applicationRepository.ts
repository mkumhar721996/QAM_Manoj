import type { ProviderApplication } from "./applicationModel.ts";

export class ApplicationRepository {
  private applicationsById: Map<string, ProviderApplication>;

  constructor(seed: ProviderApplication[] = []) {
    this.applicationsById = new Map(seed.map((a) => [a.id, a]));
  }

  findById(id: string): ProviderApplication | undefined {
    return this.applicationsById.get(id);
  }

  findPendingReview(): ProviderApplication[] {
    return [...this.applicationsById.values()].filter((a) => a.status === "submitted");
  }

  save(application: ProviderApplication): void {
    this.applicationsById.set(application.id, application);
  }

  count(): number {
    return this.applicationsById.size;
  }
}
