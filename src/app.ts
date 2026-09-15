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
import { InvoiceRepository } from "./invoicing/invoiceRepository.ts";
import { DisbursementRepository } from "./invoicing/disbursementRepository.ts";
import { PlatformSettingsRepository } from "./invoicing/platformSettingsRepository.ts";
import { InvoiceNumberSequence } from "./invoicing/invoiceNumberSequence.ts";
import { InvoiceService } from "./invoicing/invoiceService.ts";
import { ConsoleEmailService } from "./notifications/emailService.ts";
import type { EmailService } from "./notifications/emailService.ts";
import {
  handleListDisbursements,
  handleListInvoices,
  handleRecordDisbursement,
  handleRecordPaymentCapture,
  handleSetTaxRate,
} from "./invoicing/invoiceController.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  pizzaRepository?: PizzaRepository;
  cartRepository?: CartRepository;
  invoiceRepository?: InvoiceRepository;
  disbursementRepository?: DisbursementRepository;
  platformSettingsRepository?: PlatformSettingsRepository;
  invoiceNumberSequence?: InvoiceNumberSequence;
  emailService?: EmailService;
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
  const invoiceRepository = deps.invoiceRepository ?? new InvoiceRepository();
  const disbursementRepository = deps.disbursementRepository ?? new DisbursementRepository();
  const platformSettingsRepository = deps.platformSettingsRepository ?? new PlatformSettingsRepository();
  const invoiceNumberSequence = deps.invoiceNumberSequence ?? new InvoiceNumberSequence();
  const emailService = deps.emailService ?? new ConsoleEmailService();
  const invoiceService = new InvoiceService(
    invoiceRepository,
    disbursementRepository,
    platformSettingsRepository,
    userRepository,
    emailService,
    invoiceNumberSequence,
  );

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(
      req,
      res,
      authService,
      pizzaRepository,
      cartService,
      invoiceService,
      invoiceRepository,
      disbursementRepository,
      platformSettingsRepository,
      userRepository,
    );
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  pizzaRepository: PizzaRepository,
  cartService: CartService,
  invoiceService: InvoiceService,
  invoiceRepository: InvoiceRepository,
  disbursementRepository: DisbursementRepository,
  platformSettingsRepository: PlatformSettingsRepository,
  userRepository: UserRepository,
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

    if (route === "GET /invoices") {
      const result = handleListInvoices(invoiceRepository, userRepository, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /disbursements") {
      const result = handleListDisbursements(disbursementRepository, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (
      route !== "POST /auth/login" &&
      route !== "POST /auth/refresh" &&
      route !== "POST /auth/logout" &&
      route !== "POST /cart/items" &&
      route !== "POST /internal/payment-captures" &&
      route !== "POST /internal/disbursements" &&
      route !== "PUT /platform-settings/tax-rate"
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

    if (route === "POST /internal/payment-captures") {
      const result = handleRecordPaymentCapture(invoiceService, userRepository, body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /internal/disbursements") {
      const result = handleRecordDisbursement(invoiceService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "PUT /platform-settings/tax-rate") {
      const result = handleSetTaxRate(platformSettingsRepository, req.headers.authorization, body);
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
