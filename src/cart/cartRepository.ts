import type { CartItem } from "./cartModel.ts";

export class CartRepository {
  private itemsByCustomerId: Map<string, CartItem[]> = new Map();

  addItem(item: CartItem): void {
    const items = this.itemsByCustomerId.get(item.customerId) ?? [];
    items.push(item);
    this.itemsByCustomerId.set(item.customerId, items);
  }

  getItemsByCustomerId(customerId: string): CartItem[] {
    return this.itemsByCustomerId.get(customerId) ?? [];
  }
}
