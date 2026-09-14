export interface PizzaOption {
  id: string;
  name: string;
}

export interface Pizza {
  id: string;
  name: string;
  sizes: PizzaOption[];
  crusts: PizzaOption[];
  toppings: PizzaOption[];
}

export const testPizzas: Pizza[] = [
  {
    id: "pizza-margherita",
    name: "Margherita",
    sizes: [
      { id: "size-small", name: "Small" },
      { id: "size-medium", name: "Medium" },
      { id: "size-large", name: "Large" },
    ],
    crusts: [
      { id: "crust-thin", name: "Thin" },
      { id: "crust-thick", name: "Thick" },
      { id: "crust-stuffed", name: "Stuffed" },
    ],
    toppings: [
      { id: "topping-mushroom", name: "Mushroom" },
      { id: "topping-olives", name: "Olives" },
      { id: "topping-pepperoni", name: "Pepperoni" },
    ],
  },
];
