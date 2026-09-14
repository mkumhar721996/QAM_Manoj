import { testPizzas } from "./fixtures/pizzaCatalog.ts";
import type { Pizza } from "./fixtures/pizzaCatalog.ts";

export class PizzaRepository {
  private pizzasById: Map<string, Pizza>;

  constructor(pizzas: Pizza[] = testPizzas) {
    this.pizzasById = new Map(pizzas.map((p) => [p.id, p]));
  }

  findById(pizzaId: string): Pizza | undefined {
    return this.pizzasById.get(pizzaId);
  }
}
