import { testUsers } from "./fixtures/testUsers.ts";
import type { User } from "./fixtures/testUsers.ts";

export class UserRepository {
  private usersByUsername: Map<string, User>;
  private usersById: Map<string, User>;
  private usersByFacebookId: Map<string, User>;

  constructor(users: User[] = testUsers) {
    this.usersByUsername = new Map(
      users.filter((u): u is User & { username: string } => u.username !== undefined).map((u) => [u.username, u]),
    );
    this.usersById = new Map(users.map((u) => [u.id, u]));
    this.usersByFacebookId = new Map(
      users.filter((u): u is User & { facebookId: string } => u.facebookId !== undefined).map((u) => [u.facebookId, u]),
    );
  }

  findByUsername(username: string): User | undefined {
    return this.usersByUsername.get(username);
  }

  findById(userId: string): User | undefined {
    return this.usersById.get(userId);
  }

  findByFacebookId(facebookId: string): User | undefined {
    return this.usersByFacebookId.get(facebookId);
  }

  create(user: User): void {
    this.usersById.set(user.id, user);
    if (user.username) {
      this.usersByUsername.set(user.username, user);
    }
    if (user.facebookId) {
      this.usersByFacebookId.set(user.facebookId, user);
    }
  }
}
