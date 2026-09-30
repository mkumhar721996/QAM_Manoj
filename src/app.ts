import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
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

    const v1Path = stripV1Prefix(url.pathname);

    const workItemMatch = v1Path !== null ? v1Path.match(/^\/work-items\/([^/]+)$/) : null;
    if (method === "GET" && workItemMatch) {
      const result = handleGetWorkItem(workItemService, req.headers.authorization, workItemMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }
    if (method === "DELETE" && workItemMatch) {
      const result = handleDeleteWorkItem(workItemService, req.headers.authorization, workItemMatch[1]);
      sendJson(res, result.status, result.body);
      return;
    }

    const createWorkItemMatch = v1Path !== null ? v1Path.match(/^\/projects\/([^/]+)\/work-items$/) : null;
    const isCreateWorkItem = method === "POST" && createWorkItemMatch !== null;
    const isUpdateWorkItem = method === "PATCH" && workItemMatch !== null;

    if (
      route !== "POST /auth/login" &&
      route !== "POST /auth/refresh" &&
      route !== "POST /auth/logout" &&
      route !== "POST /cart/items" &&
      !isCreateWorkItem &&
      !isUpdateWorkItem
    ) {
      sendJson(res, 404, errorEnvelope(ERROR_CODES.NOT_FOUND, "not found"));
      return;
    }

    const body = await readJsonBody(req);

    if (isCreateWorkItem) {
      const result = handleCreateWorkItem(workItemService, req.headers.authorization, createWorkItemMatch![1], body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (isUpdateWorkItem) {
      const result = handleUpdateWorkItem(workItemService, req.headers.authorization, workItemMatch![1], body);
      sendJson(res, result.status, result.body);
      return;
    }

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
