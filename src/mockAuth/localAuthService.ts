import { UserStore } from "./userStore.ts";
import { SessionStore } from "./sessionStore.ts";

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

  register(email: string, password: string, now: number = Date.now()): void {
    if (this.userStore.findByEmail(email)) {
      throw new DuplicateUserError(email);
    }
    this.userStore.save({ email, password, createdAt: now });
  }

  login(email: string, password: string): void {
    const user = this.userStore.findByEmail(email);
    if (!user || user.password !== password) {
      throw new InvalidCredentialsError();
    }
    this.sessionStore.setCurrentSession({ email });
  }

  logout(): void {
    this.sessionStore.clearCurrentSession();
  }

  resetPassword(email: string, newPassword: string): void {
    const user = this.userStore.findByEmail(email);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    this.userStore.save({ ...user, password: newPassword });
  }

  isAuthenticated(): boolean {
    return this.sessionStore.getCurrentSession() !== null;
  }

  getCurrentUserEmail(): string | null {
    return this.sessionStore.getCurrentSession()?.email ?? null;
  }
}
