import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { BookingRepository } from "./bookings/bookingRepository.ts";
import { NotificationService } from "./notifications/notificationService.ts";
import { RescheduleService } from "./bookings/rescheduleService.ts";
import { handleReschedule } from "./bookings/rescheduleController.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  bookingRepository?: BookingRepository;
  notificationService?: NotificationService;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const bookingRepository = deps.bookingRepository ?? new BookingRepository();
  const notificationService = deps.notificationService ?? new NotificationService();
  const rescheduleService = new RescheduleService(bookingRepository, notificationService);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, rescheduleService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  rescheduleService: RescheduleService,
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

    const rescheduleMatch = method === "POST" ? url.pathname.match(/^\/bookings\/([^/]+)\/reschedule$/) : null;
    if (rescheduleMatch) {
      const body = await readJsonBody(req);
      const result = handleReschedule(rescheduleService, req.headers.authorization, rescheduleMatch[1], body);
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
