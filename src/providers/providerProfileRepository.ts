import type { ProviderProfile } from "./providerProfileModel.ts";
import { testProviderProfiles } from "./fixtures/testProviderProfiles.ts";

export interface ProviderProfileInput {
  businessName: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
}

export class ProviderNotFoundError extends Error {
  constructor() {
    super("Provider not found");
  }
}

export class ProviderProfileRepository {
  private profilesByProviderId: Map<string, ProviderProfile>;

  constructor(profiles: ProviderProfile[] = testProviderProfiles) {
    this.profilesByProviderId = new Map(profiles.map((p) => [p.providerId, { ...p }]));
  }

  findByProviderId(providerId: string): ProviderProfile | undefined {
    return this.profilesByProviderId.get(providerId);
  }

  update(providerId: string, updates: ProviderProfileInput, now: number = Date.now()): ProviderProfile {
    const existing = this.profilesByProviderId.get(providerId);
    if (!existing) {
      throw new ProviderNotFoundError();
    }
    const updated: ProviderProfile = {
      ...existing,
      ...updates,
      updatedAt: now,
    };
    this.profilesByProviderId.set(providerId, updated);
    return updated;
  }
}
