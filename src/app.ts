import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { NoShowPolicyRepository } from "./noShowPolicy/noShowPolicyRepository.ts";
import { NoShowPolicyService } from "./noShowPolicy/noShowPolicyService.ts";
import {
  handleGetNoShowPolicy,
  handleResolveNoShowOutcome,
  handleUpdateNoShowPolicy,
} from "./noShowPolicy/noShowPolicyController.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  noShowPolicyRepository?: NoShowPolicyRepository;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const noShowPolicyService = new NoShowPolicyService(deps.noShowPolicyRepository ?? new NoShowPolicyRepository());

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, noShowPolicyService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  noShowPolicyService: NoShowPolicyService,
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

    if (route === "GET /no-show-policy") {
      const result = handleGetNoShowPolicy(noShowPolicyService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /no-show-policy/resolve") {
      const result = handleResolveNoShowOutcome(noShowPolicyService);
      sendJson(res, result.status, result.body);
      return;
    }

    const bodyRoutes = new Set(["POST /auth/login", "POST /auth/refresh", "POST /auth/logout", "PUT /no-show-policy"]);
    if (!bodyRoutes.has(route)) {
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

    if (route === "PUT /no-show-policy") {
      const result = handleUpdateNoShowPolicy(noShowPolicyService, req.headers.authorization, body);
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
