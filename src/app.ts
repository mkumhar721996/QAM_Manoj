import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { authenticateRequest } from "./auth/tokenService.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";
import { ApplicationRepository } from "./applications/applicationRepository.ts";
import { CredentialDocumentRepository } from "./applications/credentialDocumentRepository.ts";
import { ApplicationEventBus } from "./applications/applicationEventBus.ts";
import {
  ConsoleAdminAlertSender,
  ConsoleEmailSender,
  NotificationService,
  type AdminAlertSender,
  type EmailSender,
} from "./applications/notificationService.ts";
import { ApplicationService } from "./applications/applicationService.ts";
import {
  handleGetStatus,
  handleStatusStream,
  handleSubmit,
  handleTransition,
} from "./applications/applicationController.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  applicationRepository?: ApplicationRepository;
  credentialDocumentRepository?: CredentialDocumentRepository;
  emailSender?: EmailSender;
  adminAlertSender?: AdminAlertSender;
  eventBus?: ApplicationEventBus;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);

  const applicationRepository = deps.applicationRepository ?? new ApplicationRepository();
  const credentialDocumentRepository = deps.credentialDocumentRepository ?? new CredentialDocumentRepository();
  const emailSender = deps.emailSender ?? new ConsoleEmailSender();
  const adminAlertSender = deps.adminAlertSender ?? new ConsoleAdminAlertSender();
  const eventBus = deps.eventBus ?? new ApplicationEventBus();
  const notificationService = new NotificationService(emailSender, adminAlertSender);
  const applicationService = new ApplicationService(
    applicationRepository,
    credentialDocumentRepository,
    notificationService,
    eventBus,
    userRepository,
  );

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, applicationService, eventBus);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  applicationService: ApplicationService,
  eventBus: ApplicationEventBus,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${method} ${url.pathname}`;

  const applicationMatch = url.pathname.match(
    /^\/applications\/([^/]+)\/(submit|status|status\/stream|transition)$/,
  );

  try {
    if (applicationMatch) {
      const [, applicationId, action] = applicationMatch;
      const auth = authenticateRequest(req.headers.authorization);

      if (method === "POST" && action === "submit") {
        const result = handleSubmit(applicationService, applicationId, auth);
        sendJson(res, result.status, result.body);
        return;
      }

      if (method === "GET" && action === "status") {
        const result = handleGetStatus(applicationService, applicationId, auth);
        sendJson(res, result.status, result.body);
        return;
      }

      if (method === "GET" && action === "status/stream") {
        handleStatusStream(res, eventBus, applicationService, applicationId, auth);
        return;
      }

      if (method === "POST" && action === "transition") {
        const body = await readJsonBody(req);
        const result = await handleTransition(applicationService, applicationId, auth, body);
        sendJson(res, result.status, result.body);
        return;
      }

      sendJson(res, 404, { error: "not found" });
      return;
    }

    if (route === "GET /auth/session") {
      const result = handleGetSession(req.headers.authorization);
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
