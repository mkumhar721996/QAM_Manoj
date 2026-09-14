import crypto from "node:crypto";
import { testUsers } from "./fixtures/testUsers.ts";
import type { Role, User } from "./fixtures/testUsers.ts";

export class UserRepository {
  private usersByUsername: Map<string, User>;
  private usersById: Map<string, User>;

  constructor(users: User[] = testUsers) {
    this.usersByUsername = new Map(users.map((u) => [u.username, u]));
    this.usersById = new Map(users.map((u) => [u.id, u]));
  }

  findByUsername(username: string): User | undefined {
    return this.usersByUsername.get(username);
  }

  findById(userId: string): User | undefined {
    return this.usersById.get(userId);
  }

  create(input: { username: string; passwordHash: string; role: Role; name?: string }): User {
    const user: User = { id: crypto.randomUUID(), ...input };
    this.usersByUsername.set(user.username, user);
    this.usersById.set(user.id, user);
    return user;
  }
}
