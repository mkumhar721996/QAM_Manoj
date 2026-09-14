import type { AccessTokenPayload } from "./tokenService.ts";
import { verifyAccessToken } from "./tokenService.ts";

export function authenticateBearerToken(
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): AccessTokenPayload | undefined {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    return undefined;
  }
  return verifyAccessToken(token, now) ?? undefined;
}
