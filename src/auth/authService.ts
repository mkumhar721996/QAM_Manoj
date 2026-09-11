import { UserRepository } from "../users/userRepository.ts";
import { SessionRepository } from "../sessions/sessionRepository.ts";
import { verifyPassword } from "./passwordHasher.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  issueAccessToken,
} from "./tokenService.ts";

export const INVALID_CREDENTIALS_MESSAGE = "Invalid username or password";
export const INVALID_REFRESH_TOKEN_MESSAGE = "Invalid or expired refresh token";

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

export class AuthService {
  private userRepository: UserRepository;
  private sessionRepository: SessionRepository;

  constructor(userRepository: UserRepository, sessionRepository: SessionRepository) {
    this.userRepository = userRepository;
    this.sessionRepository = sessionRepository;
  }

  login(username: string, password: string, now: number = Date.now()): LoginResult {
    const user = this.userRepository.findByUsername(username);
    const passwordMatches = user ? verifyPassword(password, user.passwordHash) : false;

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

  logout(refreshToken: string): void {
    this.sessionRepository.revokeByRefreshToken(refreshToken);
  }
}
