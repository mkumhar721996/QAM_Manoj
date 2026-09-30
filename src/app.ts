import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { resolveAuthContext } from "./auth/requestAuth.ts";
import type { AuthContext } from "./auth/requestAuth.ts";
import { InvalidJsonBodyError, PayloadTooLargeError, readJsonBody, sendJson } from "./httpUtils.ts";
import { ERROR_CODES, errorEnvelope } from "./errors/errorEnvelope.ts";
import { PizzaRepository } from "./pizzas/pizzaRepository.ts";
import { CartRepository } from "./cart/cartRepository.ts";
import { CartService } from "./cart/cartService.ts";
import { handleAddToCart, handleGetCart, handleGetPizza } from "./cart/cartController.ts";
import { ProjectRepository } from "./projects/projectRepository.ts";
import { WorkItemRepository } from "./workitems/workItemRepository.ts";
import { WorkItemService } from "./workitems/workItemService.ts";
import {
  handleCreateWorkItem,
  handleDeleteWorkItem,
  handleGetWorkItem,
  handleUpdateWorkItem,
} from "./workitems/workItemController.ts";
import { stripV1Prefix } from "./routing.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  pizzaRepository?: PizzaRepository;
  cartRepository?: CartRepository;
  projectRepository?: ProjectRepository;
  workItemRepository?: WorkItemRepository;
}

export interface App {
  requestListener: RequestListener;
}

const PUBLIC_ROUTES = new Set(["POST /v1/auth/login", "POST /v1/auth/refresh", "POST /v1/auth/logout"]);

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const authService = new AuthService(userRepository, sessionRepository);
  const pizzaRepository = deps.pizzaRepository ?? new PizzaRepository();
  const cartRepository = deps.cartRepository ?? new CartRepository();
  const cartService = new CartService(pizzaRepository, cartRepository);
  const projectRepository = deps.projectRepository ?? new ProjectRepository();
  const workItemRepository = deps.workItemRepository ?? new WorkItemRepository();
  const workItemService = new WorkItemService(projectRepository, workItemRepository);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, pizzaRepository, cartService, workItemService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  pizzaRepository: PizzaRepository,
  cartService: CartService,
  workItemService: WorkItemService,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${method} ${url.pathname}`;

  try {
    let authContext: AuthContext | undefined;
    if (url.pathname.startsWith("/v1/") && !PUBLIC_ROUTES.has(route)) {
      const context = resolveAuthContext(req.headers.authorization);
      if (!context) {
        sendJson(res, 401, errorEnvelope(ERROR_CODES.UNAUTHORIZED, "missing, malformed, or expired bearer token"));
        return;
      }
      authContext = context;
    }

    if (route === "GET /v1/auth/session") {
      const result = handleGetSession(authContext!);
      sendJson(res, result.status, result.body);
      return;
    }

    const pizzaMatch = url.pathname.match(/^\/v1\/pizzas\/([^/]+)$/);
    if (method === "GET" && pizzaMatch) {
      const result = handleGetPizza(pizzaRepository, pizzaMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /v1/cart") {
      const result = handleGetCart(cartService, authContext!);
      sendJson(res, result.status, result.body);
      return;
    }

    const v1Path = stripV1Prefix(url.pathname);

    const workItemMatch = v1Path !== null ? v1Path.match(/^\/work-items\/([^/]+)$/) : null;
    if (method === "GET" && workItemMatch) {
      const result = handleGetWorkItem(workItemService, authContext!, workItemMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }
    if (method === "DELETE" && workItemMatch) {
      const result = handleDeleteWorkItem(workItemService, authContext!, workItemMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    const createWorkItemMatch = v1Path !== null ? v1Path.match(/^\/projects\/([^/]+)\/work-items$/) : null;
    const isCreateWorkItem = method === "POST" && createWorkItemMatch !== null;
    const isUpdateWorkItem = method === "PATCH" && workItemMatch !== null;

    if (
      route !== "POST /v1/auth/login" &&
      route !== "POST /v1/auth/refresh" &&
      route !== "POST /v1/auth/logout" &&
      route !== "POST /v1/cart/items" &&
      !isCreateWorkItem &&
      !isUpdateWorkItem
    ) {
      sendJson(res, 404, errorEnvelope(ERROR_CODES.NOT_FOUND, "not found"));
      return;
    }

    const body = await readJsonBody(req);

    if (isCreateWorkItem) {
      const result = handleCreateWorkItem(workItemService, authContext!, createWorkItemMatch![1], body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (isUpdateWorkItem) {
      const result = handleUpdateWorkItem(workItemService, authContext!, workItemMatch![1], body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /v1/auth/login") {
      const result = await handleLogin(authService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /v1/auth/refresh") {
      const result = handleRefresh(authService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /v1/cart/items") {
      const result = handleAddToCart(cartService, authContext!, body);
      sendJson(res, result.status, result.body);
      return;
    }

    const result = handleLogout(authService, body);
    sendJson(res, result.status, result.body);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, errorEnvelope(ERROR_CODES.PAYLOAD_TOO_LARGE, err.message));
      return;
    }
    if (err instanceof InvalidJsonBodyError) {
      sendJson(res, 400, errorEnvelope(ERROR_CODES.VALIDATION_ERROR, err.message));
      return;
    }
    console.error(`unhandled error for ${route}:`, err);
    sendJson(res, 500, errorEnvelope(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred"));
  }
}
