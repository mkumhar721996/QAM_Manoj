import type { CancellationPolicyService } from "./cancellationPolicyService.ts";
import { OverlappingTierWindowError } from "./cancellationPolicyService.ts";
import type { AccessTokenPayload } from "../auth/tokenService.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { CancellationOutcome, CancellationPolicyTierInput } from "./cancellationPolicyModel.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

type AdminAuthResult =
  | { ok: true; payload: AccessTokenPayload }
  | { ok: false; response: ControllerResponse };

function requireAdmin(authorizationHeader: string | undefined, now: number = Date.now()): AdminAuthResult {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    return { ok: false, response: { status: 401, body: { error: "missing or malformed authorization header" } } };
  }
  const payload = verifyAccessToken(token, now);
  if (!payload) {
    return { ok: false, response: { status: 401, body: { error: "invalid or expired access token" } } };
  }
  if (payload.role !== "admin") {
    return { ok: false, response: { status: 403, body: { error: "administrator role required" } } };
  }
  return { ok: true, payload };
}

export function handleGetCancellationPolicy(
  service: CancellationPolicyService,
  authorizationHeader: string | undefined,
): ControllerResponse {
  const auth = requireAdmin(authorizationHeader);
  if (!auth.ok) {
    return auth.response;
  }
  const policy = service.getPolicy();
  return { status: 200, body: { tiers: policy.tiers, configured: policy.configured } };
}

const VALID_OUTCOMES: CancellationOutcome[] = ["full_refund", "partial_refund", "no_refund"];

function parseTierInput(value: unknown): CancellationPolicyTierInput | null {
  const record = asRecord(value);
  const { label, minHoursBeforeAppointment, maxHoursBeforeAppointment, outcome, refundPercentage } = record;

  if (typeof label !== "string" || label.length === 0) {
    return null;
  }
  if (typeof minHoursBeforeAppointment !== "number") {
    return null;
  }
  if (maxHoursBeforeAppointment !== null && typeof maxHoursBeforeAppointment !== "number") {
    return null;
  }
  if (typeof outcome !== "string" || !VALID_OUTCOMES.includes(outcome as CancellationOutcome)) {
    return null;
  }
  if (refundPercentage !== undefined && typeof refundPercentage !== "number") {
    return null;
  }

  return {
    label,
    minHoursBeforeAppointment,
    maxHoursBeforeAppointment: maxHoursBeforeAppointment as number | null,
    outcome: outcome as CancellationOutcome,
    ...(refundPercentage !== undefined ? { refundPercentage } : {}),
  };
}

export function handleAddCancellationPolicyTiers(
  service: CancellationPolicyService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  const auth = requireAdmin(authorizationHeader);
  if (!auth.ok) {
    return auth.response;
  }

  const { tiers } = asRecord(requestBody);
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { status: 400, body: { error: "tiers must be a non-empty array" } };
  }

  const inputs: CancellationPolicyTierInput[] = [];
  for (const tier of tiers) {
    const parsed = parseTierInput(tier);
    if (!parsed) {
      return { status: 400, body: { error: "each tier requires label, minHoursBeforeAppointment, maxHoursBeforeAppointment, and outcome" } };
    }
    inputs.push(parsed);
  }

  try {
    const added = service.addTiers(inputs);
    return { status: 201, body: { tiers: added } };
  } catch (err) {
    if (err instanceof OverlappingTierWindowError) {
      return { status: 409, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleRemoveCancellationPolicyTier(
  service: CancellationPolicyService,
  authorizationHeader: string | undefined,
  tierId: string,
): ControllerResponse {
  const auth = requireAdmin(authorizationHeader);
  if (!auth.ok) {
    return auth.response;
  }

  const removed = service.removeTier(tierId);
  if (!removed) {
    return { status: 404, body: { error: "cancellation policy tier not found" } };
  }
  return { status: 204 };
}
