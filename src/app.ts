import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { ProviderProfileRepository } from "./providers/providerProfileRepository.ts";
import { ProviderProfileService } from "./providers/providerProfileService.ts";
import {
  handleGetProviderProfile,
  handleGetPublicProviderProfile,
  handleUpdateProviderProfile,
} from "./providers/providerProfileController.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  providerProfileRepository?: ProviderProfileRepository;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const providerProfileRepository = deps.providerProfileRepository ?? new ProviderProfileRepository();
  const providerProfileService = new ProviderProfileService(providerProfileRepository);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, providerProfileService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  providerProfileService: ProviderProfileService,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${method} ${url.pathname}`;

  try {
    if (route === "GET /auth/session") {
      const result = handleGetSession(req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    const manageMatch = url.pathname.match(/^\/providers\/([^/]+)\/profile$/);
    const publicMatch = url.pathname.match(/^\/providers\/([^/]+)\/public-profile$/);

    if (manageMatch && method === "GET") {
      const result = handleGetProviderProfile(providerProfileService, req.headers.authorization, manageMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    if (manageMatch && method === "PUT") {
      const body = await readJsonBody(req);
      const result = handleUpdateProviderProfile(providerProfileService, req.headers.authorization, manageMatch[1], body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (publicMatch && method === "GET") {
      const result = handleGetPublicProviderProfile(providerProfileService, publicMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route !== "POST /auth/login" && route !== "POST /auth/refresh" && route !== "POST /auth/logout") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const body = await readJsonBody(req);

    if (route === "POST /auth/login") {
      const result = await handleLogin(authService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /auth/refresh") {
      const result = handleRefresh(authService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    const result = handleLogout(authService, body);
    sendJson(res, result.status, result.body);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: err.message });
      return;
    }
    console.error(`unhandled error for ${route}:`, err);
    sendJson(res, 400, { error: "invalid request" });
  }
}
