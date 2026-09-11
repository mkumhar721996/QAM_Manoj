import { verifyPassword } from './passwords.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './tokens.js';
import { USER_STATUS } from './store.js';

export class SuspendedAccountError extends Error {
  constructor() {
    super('Account suspended. Contact support.');
    this.name = 'SuspendedAccountError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password.');
    this.name = 'InvalidCredentialsError';
  }
}

export function login(store, { email, password }) {
  const user = store.users.findByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new InvalidCredentialsError();
  }

  // Suspension must block login even with correct credentials (AC3).
  if (user.status === USER_STATUS.SUSPENDED) {
    throw new SuspendedAccountError();
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });
  const refreshToken = generateRefreshToken();
  store.refreshTokens.add(hashRefreshToken(refreshToken), user.id);

  return { accessToken, refreshToken };
}
