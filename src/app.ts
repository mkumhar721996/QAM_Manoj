import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { SlotRepository } from "./bookings/slotRepository.ts";
import { HoldRepository } from "./bookings/holdRepository.ts";
import { BookingRepository } from "./bookings/bookingRepository.ts";
import { BookingService } from "./bookings/bookingService.ts";
import { handleConfirmBooking, handleGetCustomerBookings, handleGetProviderSchedule } from "./bookings/bookingController.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  slotRepository?: SlotRepository;
  holdRepository?: HoldRepository;
  bookingRepository?: BookingRepository;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);

  const slotRepository = deps.slotRepository ?? new SlotRepository();
  const holdRepository = deps.holdRepository ?? new HoldRepository();
  const bookingRepository = deps.bookingRepository ?? new BookingRepository();
  const bookingService = new BookingService(slotRepository, holdRepository, bookingRepository, userRepository);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, bookingService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  bookingService: BookingService,
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

    if (route === "GET /bookings/mine") {
      const result = handleGetCustomerBookings(bookingService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /schedule/mine") {
      const result = handleGetProviderSchedule(bookingService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    const postRoutes = ["POST /auth/login", "POST /auth/refresh", "POST /auth/logout", "POST /bookings/confirm"];
    if (!postRoutes.includes(route)) {
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

    if (route === "POST /bookings/confirm") {
      const result = await handleConfirmBooking(bookingService, body, req.headers.authorization);
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
