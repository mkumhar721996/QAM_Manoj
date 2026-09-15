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
import { DeliveryLogRepository } from "./notifications/deliveryLogRepository.ts";
import { ConsoleEmailSender } from "./notifications/emailSender.ts";
import type { EmailSender } from "./notifications/emailSender.ts";
import { NotificationService } from "./notifications/notificationService.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  pizzaRepository?: PizzaRepository;
  cartRepository?: CartRepository;
  deliveryLogRepository?: DeliveryLogRepository;
  emailSender?: EmailSender;
}

export interface App {
  requestListener: RequestListener;
  notificationService: NotificationService;
}

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const pizzaRepository = deps.pizzaRepository ?? new PizzaRepository();
  const cartRepository = deps.cartRepository ?? new CartRepository();
  const cartService = new CartService(pizzaRepository, cartRepository);
  const deliveryLogRepository = deps.deliveryLogRepository ?? new DeliveryLogRepository();
  const emailSender = deps.emailSender ?? new ConsoleEmailSender();
  const notificationService = new NotificationService(userRepository, deliveryLogRepository, emailSender);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, pizzaRepository, cartService);
  };

  return { requestListener, notificationService };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  pizzaRepository: PizzaRepository,
  cartService: CartService,
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
