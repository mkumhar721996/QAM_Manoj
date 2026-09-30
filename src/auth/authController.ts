import type { AuthService } from "./authService.ts";
import { InvalidCredentialsError, InvalidRefreshTokenError } from "./authService.ts";
import type { AuthContext } from "./requestAuth.ts";
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

export function handleGetSession(authContext: AuthContext): ControllerResponse {
  console.log(`session lookup succeeded for userId=${authContext.userId}`);
  return { status: 200, body: { user_id: authContext.userId, role: authContext.role } };
}
