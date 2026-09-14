import type { NoShowPolicyService } from "./noShowPolicyService.ts";
import { NoShowPolicyValidationError } from "./noShowPolicyService.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { ControllerResponse } from "../auth/authController.ts";

function requireAdmin(authorizationHeader: string | undefined, now: number): { userId: string } | ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }
  const payload = verifyAccessToken(token, now);
  if (!payload) {
    return { status: 401, body: { error: "invalid or expired access token" } };
  }
  if (payload.role !== "admin") {
    return { status: 403, body: { error: "administrator privileges required" } };
  }
  return { userId: payload.userId };
}

export function handleGetNoShowPolicy(
  service: NoShowPolicyService,
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): ControllerResponse {
  const admin = requireAdmin(authorizationHeader, now);
  if ("status" in admin) return admin;

  const policy = service.getPolicy();
  return { status: 200, body: policy ? { ...policy } : { configured: false } };
}

export function handleUpdateNoShowPolicy(
  service: NoShowPolicyService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
  now: number = Date.now(),
): ControllerResponse {
  const admin = requireAdmin(authorizationHeader, now);
  if ("status" in admin) return admin;

  try {
    const policy = service.updatePolicy(asRecord(requestBody), now);
    return { status: 200, body: { ...policy } };
  } catch (err) {
    if (err instanceof NoShowPolicyValidationError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleResolveNoShowOutcome(service: NoShowPolicyService): ControllerResponse {
  return { status: 200, body: { ...service.resolveFinancialOutcome() } };
}
