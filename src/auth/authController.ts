import type { AuthService } from "./authService.ts";
import { InvalidCredentialsError, InvalidRefreshTokenError } from "./authService.ts";
import { decodeAccessToken, verifyAccessToken } from "./tokenService.ts";
import { FacebookAuthError } from "./facebookOAuthClient.ts";
import { asRecord } from "../httpUtils.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

export async function handleLogin(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
  const { username, password } = asRecord(requestBody);

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
  const { refresh_token: refreshToken } = asRecord(requestBody);

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
  const { refresh_token: refreshToken } = asRecord(requestBody);

  if (typeof refreshToken !== "string") {
    return { status: 400, body: { error: "refresh_token is required" } };
  }

  const revoked = authService.logout(refreshToken);
  console.log(`logout ${revoked ? "succeeded" : "no-op: token already invalid"}`);
  return { status: 204 };
}

export async function handleFacebookAuth(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
  const { code } = asRecord(requestBody);

  if (typeof code !== "string" || code.length === 0) {
    return { status: 400, body: { error: "code is required" } };
  }

  try {
    const { result, isNewAccount, profile } = await authService.loginWithFacebook(code);
    console.log(`facebook auth succeeded, isNewAccount=${isNewAccount}`);
    return {
      status: 200,
      body: {
        access_token: result.accessToken,
        expires_in: result.accessTokenExpiresInSeconds,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
        is_new_account: isNewAccount,
        user: { name: profile.name, email: profile.email },
      },
    };
  } catch (err) {
    if (err instanceof FacebookAuthError) {
      console.warn(`facebook auth failed: ${err.message}`);
      return { status: 401, body: { error: "Facebook sign-in failed. Please try again." } };
    }
    throw err;
  }
}

export function handleGetSession(authorizationHeader: string | undefined, now: number = Date.now()): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    console.warn("session lookup failed: missing or malformed authorization header");
    return { status: 401, body: { error: "missing or malformed authorization header" } };
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
    return { status: 401, body: { error: "invalid or expired access token" } };
  }

  console.log(`session lookup succeeded for userId=${payload.userId}`);
  return { status: 200, body: { user_id: payload.userId, role: payload.role } };
}
