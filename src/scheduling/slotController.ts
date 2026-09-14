import type { SlotService } from "./slotService.ts";
import { SlotUnavailableError } from "./slotService.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import type { ControllerResponse } from "../auth/authController.ts";

export function handleListSlots(slotService: SlotService, providerId: string): ControllerResponse {
  const slots = slotService.listAvailableSlots(providerId);
  return { status: 200, body: { slots } };
}

export function handleHoldSlot(
  slotService: SlotService,
  providerId: string,
  slotId: string,
  authorizationHeader: string | undefined,
): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  const payload = token ? verifyAccessToken(token) : null;

  if (!payload) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }

  try {
    const slot = slotService.holdSlot(providerId, slotId, payload.userId);
    return { status: 200, body: { slot } };
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return { status: 409, body: { error: err.message } };
    }
    throw err;
  }
}
