import { UserStore } from "./userStore.ts";
import { SessionStore } from "./sessionStore.ts";
import { hashPassword, verifyPassword } from "./passwordHasher.ts";

export class DuplicateUserError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} is already registered`);
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
  }
}

export class LocalAuthService {
  private userStore: UserStore;
  private sessionStore: SessionStore;

  constructor(userStore: UserStore = new UserStore(), sessionStore: SessionStore = new SessionStore()) {
    this.userStore = userStore;
    this.sessionStore = sessionStore;
  }

  async register(email: string, password: string, now: number = Date.now()): Promise<void> {
    if (this.userStore.findByEmail(email)) {
      throw new DuplicateUserError(email);
    }
    const passwordHash = await hashPassword(password);
    this.userStore.save({ email, passwordHash, createdAt: now });
  }

  async login(email: string, password: string): Promise<void> {
    const user = this.userStore.findByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    this.sessionStore.setCurrentSession({ email });
  }

  logout(): void {
    this.sessionStore.clearCurrentSession();
  }

  async resetPassword(email: string, newPassword: string): Promise<void> {
    const user = this.userStore.findByEmail(email);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    const passwordHash = await hashPassword(newPassword);
    this.userStore.save({ ...user, passwordHash });
  }

  isAuthenticated(): boolean {
    return this.sessionStore.getCurrentSession() !== null;
  }

  getCurrentUserEmail(): string | null {
    return this.sessionStore.getCurrentSession()?.email ?? null;
  }
}
