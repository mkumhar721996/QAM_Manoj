import type { StorageLike } from "./storage.ts";
import { resolveDefaultStorage } from "./storage.ts";

const STORAGE_KEY = "mockAuth:users";

export interface StoredUser {
  email: string;
  password: string;
  createdAt: number;
}

export class UserStore {
  private storage: StorageLike;

  constructor(storage: StorageLike = resolveDefaultStorage()) {
    this.storage = storage;
  }

  findByEmail(email: string): StoredUser | undefined {
    return this.readAll()[email];
  }

  save(user: StoredUser): void {
    const users = this.readAll();
    users[user.email] = user;
    this.writeAll(users);
  }

  listAll(): StoredUser[] {
    return Object.values(this.readAll());
  }

  private readAll(): Record<string, StoredUser> {
    const raw = this.storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredUser>) : {};
  }

  private writeAll(users: Record<string, StoredUser>): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(users));
  }
}
