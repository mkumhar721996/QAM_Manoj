import { verifyAccessToken } from "./tokenService.ts";
import type { Role } from "../users/fixtures/testUsers.ts";

export interface AuthContext {
  userId: string;
  role: Role;
  tenantId: string;
}

export function resolveAuthContext(
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): AuthContext | null {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    return null;
  }
  const payload = verifyAccessToken(token, now);
  if (!payload) {
    return null;
  }
  return { userId: payload.userId, role: payload.role, tenantId: payload.tenantId };
}
