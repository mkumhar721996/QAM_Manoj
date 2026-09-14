export interface PizzaConfigurationInput {
  pizzaId: string;
  size: string;
  crust: string;
  toppings: string[];
  quantity: number;
  specialInstructions?: string;
}

export interface CartItem extends PizzaConfigurationInput {
  id: string;
  customerId: string;
  addedAt: number;
}
