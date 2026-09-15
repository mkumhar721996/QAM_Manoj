import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { PayloadTooLargeError, headerValue, parseJsonBody, readRawBody, sendJson } from "./httpUtils.ts";
import { PizzaRepository } from "./pizzas/pizzaRepository.ts";
import { CartRepository } from "./cart/cartRepository.ts";
import { CartService } from "./cart/cartService.ts";
import { handleAddToCart, handleGetCart, handleGetPizza } from "./cart/cartController.ts";
import { DisbursementRepository } from "./disbursements/disbursementRepository.ts";
import { ConfigRepository } from "./disbursements/configRepository.ts";
import { NotificationRepository } from "./disbursements/notificationRepository.ts";
import { InMemoryPaymentGateway } from "./disbursements/paymentGateway.ts";
import type { PaymentGateway } from "./disbursements/paymentGateway.ts";
import { DisbursementService } from "./disbursements/disbursementService.ts";
import {
  handleServiceCompletedWebhook,
  handleStripeDisputeWebhook,
  handleUpdateServiceFeeRate,
} from "./disbursements/disbursementController.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  pizzaRepository?: PizzaRepository;
  cartRepository?: CartRepository;
  disbursementRepository?: DisbursementRepository;
  configRepository?: ConfigRepository;
  notificationRepository?: NotificationRepository;
  paymentGateway?: PaymentGateway;
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
  const disbursementRepository = deps.disbursementRepository ?? new DisbursementRepository();
  const configRepository = deps.configRepository ?? new ConfigRepository();
  const notificationRepository = deps.notificationRepository ?? new NotificationRepository();
  const paymentGateway = deps.paymentGateway ?? new InMemoryPaymentGateway();
  const disbursementService = new DisbursementService(
    disbursementRepository,
    configRepository,
    paymentGateway,
    notificationRepository,
  );

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, pizzaRepository, cartService, disbursementService, configRepository);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  pizzaRepository: PizzaRepository,
  cartService: CartService,
  disbursementService: DisbursementService,
  configRepository: ConfigRepository,
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
      route !== "POST /cart/items" &&
      route !== "POST /webhooks/booking-service-completed" &&
      route !== "POST /webhooks/stripe/dispute" &&
      route !== "PUT /config/service-fee-rate"
    ) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const rawBody = await readRawBody(req);
    const body = parseJsonBody(rawBody);

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

    if (route === "POST /webhooks/booking-service-completed") {
      const result = handleServiceCompletedWebhook(
        disbursementService,
        headerValue(req.headers["x-webhook-signature"]),
        rawBody,
        body,
      );
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /webhooks/stripe/dispute") {
      const result = handleStripeDisputeWebhook(
        disbursementService,
        headerValue(req.headers["stripe-signature"]),
        rawBody,
        body,
      );
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "PUT /config/service-fee-rate") {
      const result = handleUpdateServiceFeeRate(configRepository, req.headers.authorization, body);
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
