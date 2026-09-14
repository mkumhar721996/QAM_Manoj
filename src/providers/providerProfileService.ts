import type { ProviderProfile } from "./providerProfileModel.ts";
import { ProviderNotFoundError, ProviderProfileRepository } from "./providerProfileRepository.ts";
import type { ProviderProfileInput } from "./providerProfileRepository.ts";

export { ProviderNotFoundError };
export type { ProviderProfileInput };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

export class ForbiddenProfileAccessError extends Error {
  constructor() {
    super("Forbidden");
  }
}

export class ProviderApprovalRequiredError extends Error {
  constructor() {
    super("Your provider application must be approved before you can access profile management.");
  }
}

export class ProviderProfileValidationError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super("Validation failed");
    this.fieldErrors = fieldErrors;
  }
}

export class ProviderProfileService {
  private repository: ProviderProfileRepository;

  constructor(repository: ProviderProfileRepository) {
    this.repository = repository;
  }

  getManagedProfile(requestingUserId: string, targetProviderId: string): ProviderProfile {
    return this.authorizeManagedAccess(requestingUserId, targetProviderId);
  }

  updateManagedProfile(
    requestingUserId: string,
    targetProviderId: string,
    input: ProviderProfileInput,
  ): ProviderProfile {
    this.authorizeManagedAccess(requestingUserId, targetProviderId);

    const fieldErrors = validateInput(input);
    if (Object.keys(fieldErrors).length > 0) {
      throw new ProviderProfileValidationError(fieldErrors);
    }

    return this.repository.update(targetProviderId, input);
  }

  getPublicProfile(targetProviderId: string): Omit<ProviderProfile, "status"> {
    const profile = this.repository.findByProviderId(targetProviderId);
    if (!profile || profile.status !== "approved") {
      throw new ProviderNotFoundError();
    }
    const { status: _status, ...publicProfile } = profile;
    return publicProfile;
  }

  private authorizeManagedAccess(requestingUserId: string, targetProviderId: string): ProviderProfile {
    if (requestingUserId !== targetProviderId) {
      throw new ForbiddenProfileAccessError();
    }

    const profile = this.repository.findByProviderId(targetProviderId);
    if (!profile) {
      throw new ProviderNotFoundError();
    }

    if (profile.status !== "approved") {
      throw new ProviderApprovalRequiredError();
    }

    return profile;
  }
}

function validateInput(input: ProviderProfileInput): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!input.businessName || input.businessName.trim() === "") {
    errors.business_name = "Business name is required.";
  }

  if (!input.description || input.description.trim() === "") {
    errors.description = "Description is required.";
  }

  if (!input.contactEmail || !EMAIL_PATTERN.test(input.contactEmail)) {
    errors.contact_email = "Enter a valid email address.";
  }

  if (!input.contactPhone || !PHONE_PATTERN.test(input.contactPhone)) {
    errors.contact_phone = "Enter a valid phone number, e.g. +15551234567.";
  }

  return errors;
}
