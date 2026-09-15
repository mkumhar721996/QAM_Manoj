import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";
import { PizzaRepository } from "./pizzas/pizzaRepository.ts";
import { CartRepository } from "./cart/cartRepository.ts";
import { CartService } from "./cart/cartService.ts";
import { handleAddToCart, handleGetCart, handleGetPizza } from "./cart/cartController.ts";
import { BookingRepository } from "./bookings/bookingRepository.ts";
import { BookingService } from "./bookings/bookingService.ts";
import {
  handleDeleteBooking,
  handleGetBooking,
  handleGetCustomerBookingHistory,
  handleGetProviderBookingHistory,
} from "./bookings/bookingController.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  pizzaRepository?: PizzaRepository;
  cartRepository?: CartRepository;
  bookingRepository?: BookingRepository;
}

export interface App {
  requestListener: RequestListener;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const pizzaRepository = deps.pizzaRepository ?? new PizzaRepository();
  const cartRepository = deps.cartRepository ?? new CartRepository();
  const cartService = new CartService(pizzaRepository, cartRepository);
  const bookingRepository = deps.bookingRepository ?? new BookingRepository();
  const bookingService = new BookingService(bookingRepository, userRepository);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, pizzaRepository, cartService, bookingService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  pizzaRepository: PizzaRepository,
  cartService: CartService,
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

    const pizzaMatch = url.pathname.match(/^\/pizzas\/([^/]+)$/);
    if (method === "GET" && pizzaMatch) {
      const result = handleGetPizza(pizzaRepository, pizzaMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /cart") {
      const result = handleGetCart(cartService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /bookings/customer/history") {
      const result = handleGetCustomerBookingHistory(bookingService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /bookings/provider/history") {
      const result = handleGetProviderBookingHistory(bookingService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    const bookingMatch = url.pathname.match(/^\/bookings\/([^/]+)$/);
    if (method === "GET" && bookingMatch) {
      const result = handleGetBooking(bookingService, req.headers.authorization, bookingMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    if (method === "DELETE" && bookingMatch) {
      const result = handleDeleteBooking(bookingService, req.headers.authorization, bookingMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    if (
      route !== "POST /auth/login" &&
      route !== "POST /auth/refresh" &&
      route !== "POST /auth/logout" &&
      route !== "POST /cart/items"
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

    if (route === "POST /cart/items") {
      const result = handleAddToCart(cartService, req.headers.authorization, body);
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
