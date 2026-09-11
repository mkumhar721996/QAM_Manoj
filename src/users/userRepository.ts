import { testUsers } from "./fixtures/testUsers.ts";
import type { User } from "./fixtures/testUsers.ts";

export class UserRepository {
  private usersByUsername: Map<string, User>;

  constructor(users: User[] = testUsers) {
    this.usersByUsername = new Map(users.map((u) => [u.username, u]));
  }

  findByUsername(username: string): User | undefined {
    return this.usersByUsername.get(username);
  }

  findById(userId: string): User | undefined {
    for (const user of this.usersByUsername.values()) {
      if (user.id === userId) {
        return user;
      }
    }
    return undefined;
  }
}
