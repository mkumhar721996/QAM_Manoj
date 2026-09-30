import type { AuthService } from "./authService.ts";
import { InvalidCredentialsError, InvalidRefreshTokenError } from "./authService.ts";
import { decodeAccessToken, verifyAccessToken } from "./tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import { ERROR_CODES, errorEnvelope } from "../errors/errorEnvelope.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

export async function handleLogin(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
  const { username, password } = asRecord(requestBody);

  if (typeof username !== "string" || typeof password !== "string") {
    return { status: 400, body: errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "username and password are required") };
  }

  try {
    const result = await authService.login(username, password);
    console.log(`login succeeded for username=${username}`);
    return {
      status: 200,
      body: {
        access_token: result.accessToken,
        expires_in: result.accessTokenExpiresInSeconds,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
      },
    };
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      console.warn(`login failed for username=${username}: ${err.message}`);
      return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, err.message) };
    }
    throw err;
  }
}

export function handleRefresh(authService: AuthService, requestBody: unknown): ControllerResponse {
  const { refresh_token: refreshToken } = asRecord(requestBody);

  if (typeof refreshToken !== "string") {
    return { status: 400, body: errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "refresh_token is required") };
  }

  try {
    const result = authService.refresh(refreshToken);
    console.log("refresh succeeded");
    return {
      status: 200,
      body: {
        access_token: result.accessToken,
        expires_in: result.accessTokenExpiresInSeconds,
        token_type: "Bearer",
      },
    };
  } catch (err) {
    if (err instanceof InvalidRefreshTokenError) {
      console.warn(`refresh failed: ${err.message}`);
      return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, err.message) };
    }
    throw err;
  }
}

export function handleLogout(authService: AuthService, requestBody: unknown): ControllerResponse {
  const { refresh_token: refreshToken } = asRecord(requestBody);

  if (typeof refreshToken !== "string") {
    return { status: 400, body: errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "refresh_token is required") };
  }

  const revoked = authService.logout(refreshToken);
  console.log(`logout ${revoked ? "succeeded" : "no-op: token already invalid"}`);
  return { status: 204 };
}

export function handleGetSession(authorizationHeader: string | undefined, now: number = Date.now()): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    console.warn("session lookup failed: missing or malformed authorization header");
    return {
      status: 401,
      body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, "missing or malformed authorization header"),
    };
  }

  const payload = verifyAccessToken(token, now);
  if (!payload) {
    // decodeAccessToken skips the expiry check, so it tells us whether the
    // token was well-formed and correctly signed but simply expired, vs invalid outright.
    const decoded = decodeAccessToken(token);
    console.warn(
      decoded
        ? `session lookup failed: expired access token for userId=${decoded.userId}`
        : "session lookup failed: invalid access token",
    );
    return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, "invalid or expired access token") };
  }

  console.log(`session lookup succeeded for userId=${payload.userId}`);
  return { status: 200, body: { user_id: payload.userId, role: payload.role } };
}
