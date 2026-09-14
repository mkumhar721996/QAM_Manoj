import crypto from "node:crypto";
import type { PizzaRepository } from "../pizzas/pizzaRepository.ts";
import type { CartRepository } from "./cartRepository.ts";
import type { CartItem, PizzaConfigurationInput } from "./cartModel.ts";

export class PizzaNotFoundError extends Error {}
export class InvalidCustomisationError extends Error {}

export class CartService {
  private pizzaRepository: PizzaRepository;
  private cartRepository: CartRepository;

  constructor(pizzaRepository: PizzaRepository, cartRepository: CartRepository) {
    this.pizzaRepository = pizzaRepository;
    this.cartRepository = cartRepository;
  }

  addPizzaToCart(customerId: string, input: PizzaConfigurationInput, now: number = Date.now()): CartItem {
    const pizza = this.pizzaRepository.findById(input.pizzaId);
    if (!pizza) {
      throw new PizzaNotFoundError(`No pizza found with id ${input.pizzaId}`);
    }
    if (!pizza.sizes.some((s) => s.id === input.size)) {
      throw new InvalidCustomisationError("size must be one of the pizza's available sizes");
    }
    if (!pizza.crusts.some((c) => c.id === input.crust)) {
      throw new InvalidCustomisationError("crust must be one of the pizza's available crusts");
    }
    if (input.toppings.length === 0) {
      throw new InvalidCustomisationError("at least one topping must be selected");
    }
    if (input.toppings.some((t) => !pizza.toppings.some((pt) => pt.id === t))) {
      throw new InvalidCustomisationError("toppings must be selected from the pizza's available toppings");
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      throw new InvalidCustomisationError("quantity must be a positive integer");
    }

    const item: CartItem = { ...input, id: crypto.randomUUID(), customerId, addedAt: now };
    this.cartRepository.addItem(item);
    return item;
  }

  getCart(customerId: string): CartItem[] {
    return this.cartRepository.getItemsByCustomerId(customerId);
  }
}
