import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { CancellationPolicyRepository } from "./cancellationPolicy/cancellationPolicyRepository.ts";
import { CancellationPolicyService } from "./cancellationPolicy/cancellationPolicyService.ts";
import {
  handleAddCancellationPolicyTiers,
  handleGetCancellationPolicy,
  handleRemoveCancellationPolicyTier,
} from "./cancellationPolicy/cancellationPolicyController.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  cancellationPolicyRepository?: CancellationPolicyRepository;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const cancellationPolicyRepository = deps.cancellationPolicyRepository ?? new CancellationPolicyRepository();
  const cancellationPolicyService = new CancellationPolicyService(cancellationPolicyRepository);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, cancellationPolicyService);
  };

  return { requestListener };
}

const CANCELLATION_POLICY_TIER_PATH_PREFIX = "/cancellation-policy/tiers/";

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  cancellationPolicyService: CancellationPolicyService,
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

    if (route === "GET /cancellation-policy") {
      const result = handleGetCancellationPolicy(cancellationPolicyService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (method === "DELETE" && url.pathname.startsWith(CANCELLATION_POLICY_TIER_PATH_PREFIX)) {
      const tierId = url.pathname.slice(CANCELLATION_POLICY_TIER_PATH_PREFIX.length);
      const result = handleRemoveCancellationPolicyTier(cancellationPolicyService, req.headers.authorization, tierId);
      sendJson(res, result.status, result.body);
      return;
    }

    if (
      route !== "POST /auth/login" &&
      route !== "POST /auth/refresh" &&
      route !== "POST /auth/logout" &&
      route !== "POST /cancellation-policy/tiers"
    ) {
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

    if (route === "POST /cancellation-policy/tiers") {
      const result = handleAddCancellationPolicyTiers(cancellationPolicyService, req.headers.authorization, body);
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
