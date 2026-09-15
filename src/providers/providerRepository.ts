import { testProviders } from "./fixtures/testProviders.ts";
import type { Provider } from "./providerModel.ts";

export class ProviderRepository {
  private providersById: Map<string, Provider>;

  constructor(providers: Provider[] = testProviders) {
    this.providersById = new Map(providers.map((p) => [p.id, p]));
  }

  findById(providerId: string): Provider | undefined {
    return this.providersById.get(providerId);
  }
}
