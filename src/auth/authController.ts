import type { AuthService } from "./authService.ts";
import { InvalidCredentialsError, InvalidRefreshTokenError } from "./authService.ts";
import { verifyAccessToken } from "./tokenService.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

export async function handleLogin(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
  const { username, password } =
    requestBody && typeof requestBody === "object" ? (requestBody as Record<string, unknown>) : {};

  if (typeof username !== "string" || typeof password !== "string") {
    return { status: 400, body: { error: "username and password are required" } };
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
      return { status: 401, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleRefresh(authService: AuthService, requestBody: unknown): ControllerResponse {
  const { refresh_token: refreshToken } =
    requestBody && typeof requestBody === "object" ? (requestBody as Record<string, unknown>) : {};

  if (typeof refreshToken !== "string") {
    return { status: 400, body: { error: "refresh_token is required" } };
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
      return { status: 401, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleLogout(authService: AuthService, requestBody: unknown): ControllerResponse {
  const { refresh_token: refreshToken } =
    requestBody && typeof requestBody === "object" ? (requestBody as Record<string, unknown>) : {};

  if (typeof refreshToken !== "string") {
    return { status: 400, body: { error: "refresh_token is required" } };
  }

  const revoked = authService.logout(refreshToken);
  console.log(`logout ${revoked ? "succeeded" : "no-op: token already invalid"}`);
  return { status: 204 };
}

export function handleGetSession(authorizationHeader: string | undefined): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return { status: 401, body: { error: "invalid or expired access token" } };
  }

  return { status: 200, body: { user_id: payload.userId, role: payload.role } };
}
