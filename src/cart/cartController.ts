import type { ControllerResponse } from "../auth/authController.ts";
import { extractBearerPayload } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { PizzaRepository } from "../pizzas/pizzaRepository.ts";
import { CartService, InvalidCustomisationError, PizzaNotFoundError } from "./cartService.ts";

export function handleGetPizza(pizzaRepository: PizzaRepository, pizzaId: string): ControllerResponse {
  const pizza = pizzaRepository.findById(pizzaId);
  if (!pizza) {
    return { status: 404, body: { error: "pizza not found" } };
  }
  return {
    status: 200,
    body: { id: pizza.id, name: pizza.name, sizes: pizza.sizes, crusts: pizza.crusts, toppings: pizza.toppings },
  };
}

export function handleAddToCart(
  cartService: CartService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const {
    pizza_id: pizzaId,
    size,
    crust,
    toppings,
    quantity,
    special_instructions: specialInstructions,
  } = asRecord(requestBody);

  if (
    typeof pizzaId !== "string" ||
    typeof size !== "string" ||
    typeof crust !== "string" ||
    !Array.isArray(toppings) ||
    !toppings.every((t) => typeof t === "string") ||
    typeof quantity !== "number" ||
    (specialInstructions !== undefined && typeof specialInstructions !== "string")
  ) {
    return { status: 400, body: { error: "invalid pizza configuration" } };
  }

  try {
    const item = cartService.addPizzaToCart(payload.userId, {
      pizzaId,
      size,
      crust,
      toppings,
      quantity,
      specialInstructions,
    });
    return {
      status: 201,
      body: {
        id: item.id,
        pizza_id: item.pizzaId,
        size: item.size,
        crust: item.crust,
        toppings: item.toppings,
        quantity: item.quantity,
        special_instructions: item.specialInstructions,
      },
    };
  } catch (err) {
    if (err instanceof PizzaNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    if (err instanceof InvalidCustomisationError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleGetCart(cartService: CartService, authorizationHeader: string | undefined): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const items = cartService.getCart(payload.userId).map((item) => ({
    id: item.id,
    pizza_id: item.pizzaId,
    size: item.size,
    crust: item.crust,
    toppings: item.toppings,
    quantity: item.quantity,
    special_instructions: item.specialInstructions,
  }));
  return { status: 200, body: { items } };
}
