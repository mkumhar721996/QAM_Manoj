import type { StorageLike } from "./storage.ts";
import { resolveDefaultStorage } from "./storage.ts";

const STORAGE_KEY = "mockAuth:session";

export interface StoredSession {
  email: string;
}

export class SessionStore {
  private storage: StorageLike;

  constructor(storage: StorageLike = resolveDefaultStorage()) {
    this.storage = storage;
  }

  getCurrentSession(): StoredSession | null {
    const raw = this.storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }

  setCurrentSession(session: StoredSession): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  clearCurrentSession(): void {
    this.storage.removeItem(STORAGE_KEY);
  }
}
