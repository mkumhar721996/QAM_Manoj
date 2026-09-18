import { UserRepository } from "../users/userRepository.ts";
import type { User } from "../users/fixtures/testUsers.ts";
import { SessionRepository } from "../sessions/sessionRepository.ts";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./passwordHasher.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  issueAccessToken,
} from "./tokenService.ts";

export const INVALID_CREDENTIALS_MESSAGE = "Invalid username or password";
export const INVALID_REFRESH_TOKEN_MESSAGE = "Invalid or expired refresh token";
export const EMAIL_ALREADY_REGISTERED_MESSAGE = "An account with this email already exists";

export interface LoginResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super(INVALID_CREDENTIALS_MESSAGE);
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super(INVALID_REFRESH_TOKEN_MESSAGE);
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super(EMAIL_ALREADY_REGISTERED_MESSAGE);
  }
}

export class AuthService {
  private userRepository: UserRepository;
  private sessionRepository: SessionRepository;

  constructor(userRepository: UserRepository, sessionRepository: SessionRepository) {
    this.userRepository = userRepository;
    this.sessionRepository = sessionRepository;
  }

  async login(username: string, password: string, now: number = Date.now()): Promise<LoginResult> {
    const user = this.userRepository.findByUsername(username);
    // Always run scrypt, even for unknown usernames, so response timing doesn't
    // reveal whether the account exists.
    const passwordMatches = await verifyPassword(password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);

    if (!user || !passwordMatches) {
      throw new InvalidCredentialsError();
    }

    const refreshToken = generateRefreshToken();
    this.sessionRepository.create(user.id, refreshToken, REFRESH_TOKEN_TTL_MS, now);

    const accessToken = issueAccessToken({ userId: user.id, role: user.role }, now);

    return {
      accessToken,
      accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }

  refresh(refreshToken: string, now: number = Date.now()): RefreshResult {
    const session = this.sessionRepository.findByRefreshToken(refreshToken);

    if (!session || !this.sessionRepository.isValid(session, now)) {
      throw new InvalidRefreshTokenError();
    }

    const user = this.userRepository.findById(session.userId);
    if (!user) {
      throw new InvalidRefreshTokenError();
    }

    const accessToken = issueAccessToken({ userId: user.id, role: user.role }, now);

    return {
      accessToken,
      accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async register(name: string, email: string, password: string, now: number = Date.now()): Promise<LoginResult> {
    if (this.userRepository.findByUsername(email)) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await hashPassword(password);
    const user: User = { id: crypto.randomUUID(), username: email, name, passwordHash, role: "customer" };
    this.userRepository.create(user);

    const refreshToken = generateRefreshToken();
    this.sessionRepository.create(user.id, refreshToken, REFRESH_TOKEN_TTL_MS, now);

    const accessToken = issueAccessToken({ userId: user.id, role: user.role }, now);

    return {
      accessToken,
      accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }

  logout(refreshToken: string): boolean {
    const revoked = this.sessionRepository.revokeByRefreshToken(refreshToken);
    if (!revoked) {
      console.warn("logout: refresh token not found or already revoked");
    }
    return revoked;
  }
}
