import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { PayloadTooLargeError, readJsonBody, readRawBody, sendJson } from "./httpUtils.ts";
import { PizzaRepository } from "./pizzas/pizzaRepository.ts";
import { CartRepository } from "./cart/cartRepository.ts";
import { CartService } from "./cart/cartService.ts";
import { handleAddToCart, handleGetCart, handleGetPizza } from "./cart/cartController.ts";
import { TransactionRepository } from "./payments/transactionRepository.ts";
import { PayoutRepository } from "./payments/payoutRepository.ts";
import { ReversalRepository } from "./payments/reversalRepository.ts";
import { AuditLogRepository } from "./payments/auditLogRepository.ts";
import { NotificationRepository } from "./payments/notificationRepository.ts";
import { NotificationService } from "./payments/notificationService.ts";
import { ChargebackService } from "./payments/chargebackService.ts";
import { handleChargebackWebhook } from "./payments/chargebackController.ts";
import { getStripeWebhookSecret, StripeWebhookSecretMissingError } from "./payments/stripeWebhookSecret.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  pizzaRepository?: PizzaRepository;
  cartRepository?: CartRepository;
  transactionRepository?: TransactionRepository;
  payoutRepository?: PayoutRepository;
  reversalRepository?: ReversalRepository;
  auditLogRepository?: AuditLogRepository;
  notificationRepository?: NotificationRepository;
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
  const transactionRepository = deps.transactionRepository ?? new TransactionRepository();
  const payoutRepository = deps.payoutRepository ?? new PayoutRepository();
  const reversalRepository = deps.reversalRepository ?? new ReversalRepository();
  const auditLogRepository = deps.auditLogRepository ?? new AuditLogRepository();
  const notificationRepository = deps.notificationRepository ?? new NotificationRepository();
  const notificationService = new NotificationService(notificationRepository);
  const chargebackService = new ChargebackService(
    transactionRepository,
    payoutRepository,
    reversalRepository,
    auditLogRepository,
    notificationService,
  );

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, pizzaRepository, cartService, chargebackService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  pizzaRepository: PizzaRepository,
  cartService: CartService,
  chargebackService: ChargebackService,
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
      route !== "POST /webhooks/stripe/chargebacks"
    ) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    if (route === "POST /webhooks/stripe/chargebacks") {
      console.log({ level: "info", event: "stripe_webhook_received", route, timestamp: Date.now() });

      let webhookSecret: string;
      try {
        webhookSecret = getStripeWebhookSecret();
      } catch (err) {
        if (err instanceof StripeWebhookSecretMissingError) {
          console.error({
            level: "error",
            event: "stripe_webhook_secret_missing",
            error: err.message,
            timestamp: Date.now(),
          });
          sendJson(res, 500, { error: "stripe webhook is not configured" });
          return;
        }
        throw err;
      }

      const rawBody = await readRawBody(req);
      const signatureHeader = req.headers["stripe-signature"];
      const result = handleChargebackWebhook(
        chargebackService,
        rawBody,
        Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
        webhookSecret,
      );

      const responseLog: Record<string, unknown> = {
        level: result.status === 200 ? "info" : "warn",
        event: "stripe_webhook_processed",
        status: result.status,
        timestamp: Date.now(),
      };
      if (result.status === 200) {
        Object.assign(responseLog, result.body);
      }
      console.log(responseLog);

      sendJson(res, result.status, result.body);
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
