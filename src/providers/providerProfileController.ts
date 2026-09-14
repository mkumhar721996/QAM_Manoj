import type { ProviderProfile } from "./providerProfileModel.ts";
import type { ProviderProfileInput, ProviderProfileService } from "./providerProfileService.ts";
import {
  ForbiddenProfileAccessError,
  ProviderApprovalRequiredError,
  ProviderNotFoundError,
  ProviderProfileValidationError,
} from "./providerProfileService.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

function toManagedResponseBody(profile: ProviderProfile): Record<string, unknown> {
  return {
    provider_id: profile.providerId,
    business_name: profile.businessName,
    description: profile.description,
    contact_email: profile.contactEmail,
    contact_phone: profile.contactPhone,
    status: profile.status,
  };
}

function toPublicResponseBody(profile: Omit<ProviderProfile, "status">): Record<string, unknown> {
  return {
    provider_id: profile.providerId,
    business_name: profile.businessName,
    description: profile.description,
    contact_email: profile.contactEmail,
    contact_phone: profile.contactPhone,
  };
}

function authenticate(authorizationHeader: string | undefined): string | undefined {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    return undefined;
  }
  const payload = verifyAccessToken(token);
  return payload?.userId;
}

export function handleGetProviderProfile(
  service: ProviderProfileService,
  authorizationHeader: string | undefined,
  providerId: string,
): ControllerResponse {
  const requestingUserId = authenticate(authorizationHeader);
  if (!requestingUserId) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }

  try {
    const profile = service.getManagedProfile(requestingUserId, providerId);
    return { status: 200, body: toManagedResponseBody(profile) };
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export function handleUpdateProviderProfile(
  service: ProviderProfileService,
  authorizationHeader: string | undefined,
  providerId: string,
  requestBody: unknown,
): ControllerResponse {
  const requestingUserId = authenticate(authorizationHeader);
  if (!requestingUserId) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }

  const record = asRecord(requestBody);
  const input: ProviderProfileInput = {
    businessName: typeof record.business_name === "string" ? record.business_name : "",
    description: typeof record.description === "string" ? record.description : "",
    contactEmail: typeof record.contact_email === "string" ? record.contact_email : "",
    contactPhone: typeof record.contact_phone === "string" ? record.contact_phone : "",
  };

  try {
    const profile = service.updateManagedProfile(requestingUserId, providerId, input);
    return { status: 200, body: toManagedResponseBody(profile) };
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export function handleGetPublicProviderProfile(service: ProviderProfileService, providerId: string): ControllerResponse {
  try {
    const profile = service.getPublicProfile(providerId);
    return { status: 200, body: toPublicResponseBody(profile) };
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(err: unknown): ControllerResponse {
  if (err instanceof ForbiddenProfileAccessError) {
    return { status: 403, body: { error: "Forbidden" } };
  }
  if (err instanceof ProviderApprovalRequiredError) {
    return { status: 403, body: { error: err.message } };
  }
  if (err instanceof ProviderProfileValidationError) {
    return { status: 400, body: { errors: err.fieldErrors } };
  }
  if (err instanceof ProviderNotFoundError) {
    return { status: 404, body: { error: "Provider not found" } };
  }
  throw err;
}
