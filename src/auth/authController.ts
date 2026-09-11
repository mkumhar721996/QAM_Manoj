import type { AuthService } from "./authService.ts";
import { InvalidCredentialsError, InvalidRefreshTokenError } from "./authService.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

export function handleLogin(authService: AuthService, requestBody: unknown): ControllerResponse {
  const { username, password } =
    requestBody && typeof requestBody === "object" ? (requestBody as Record<string, unknown>) : {};

  if (typeof username !== "string" || typeof password !== "string") {
    return { status: 400, body: { error: "username and password are required" } };
  }

  try {
    const result = authService.login(username, password);
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

  authService.logout(refreshToken);
  return { status: 204 };
}
