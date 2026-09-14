import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { verifyAccessToken } from "./auth/tokenService.ts";
import { ApplicationRepository } from "./applications/applicationRepository.ts";
import { NullDocumentScanner } from "./applications/documentScanner.ts";
import type { DocumentScanner } from "./applications/documentScanner.ts";
import { ApplicationService } from "./applications/applicationService.ts";
import { handleResubmitApplication } from "./applications/applicationController.ts";
import { ConsoleEmailService } from "./notifications/emailService.ts";
import type { EmailService } from "./notifications/emailService.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  applicationRepository?: ApplicationRepository;
  documentScanner?: DocumentScanner;
  emailService?: EmailService;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);

  const applicationRepository = deps.applicationRepository ?? new ApplicationRepository();
  const documentScanner = deps.documentScanner ?? new NullDocumentScanner();
  const emailService = deps.emailService ?? new ConsoleEmailService();
  const applicationService = new ApplicationService(applicationRepository, documentScanner, emailService);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, applicationService);
  };

  return { requestListener };
}

function bearerTokenFrom(authorizationHeader: string | undefined): string | undefined {
  return authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  applicationService: ApplicationService,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${method} ${url.pathname}`;
  const resubmitMatch = method === "POST" ? url.pathname.match(/^\/applications\/([^/]+)\/resubmit$/) : null;

  try {
    if (route === "GET /auth/session") {
      const result = handleGetSession(req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (resubmitMatch) {
      const payload = verifyAccessToken(bearerTokenFrom(req.headers.authorization) ?? "");
      if (!payload) {
        sendJson(res, 401, { error: "missing or invalid access token" });
        return;
      }
      if (payload.role !== "provider") {
        sendJson(res, 403, { error: "only providers may resubmit applications" });
        return;
      }
      const body = await readJsonBody(req);
      const result = await handleResubmitApplication(applicationService, resubmitMatch[1], payload.userId, body);
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
