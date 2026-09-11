"use strict";

const crypto = require("node:crypto");

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

function verifyPassword(password, passwordHash) {
  const [saltHex, keyHex] = passwordHash.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const storedKey = Buffer.from(keyHex, "hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return storedKey.length === derivedKey.length && crypto.timingSafeEqual(storedKey, derivedKey);
}

class AuthService {
  /**
   * @param {{ userRepository: import('../repositories/InMemoryUserRepository').InMemoryUserRepository, tokenService: import('./TokenService').TokenService }} deps
   */
  constructor({ userRepository, tokenService }) {
    this.userRepository = userRepository;
    this.tokenService = tokenService;
  }

  register({ email, password, displayName, phone }) {
    const passwordHash = hashPassword(password);
    return this.userRepository.create({ email, displayName, phone, passwordHash });
  }

  /** Returns { accessToken, refreshToken } on success, or null if login should be rejected. */
  login({ email, password }) {
    const user = this.userRepository.findByEmail(email);
    if (!user || user.status !== "active") return null;
    if (!verifyPassword(password, user.passwordHash)) return null;

    return {
      accessToken: this.tokenService.issueAccessToken(user),
      refreshToken: this.tokenService.issueRefreshToken(user),
    };
  }

  refresh({ refreshToken }) {
    const user = this.tokenService.useRefreshToken(refreshToken);
    if (!user) return null;

    return { accessToken: this.tokenService.issueAccessToken(user) };
  }
}

module.exports = { AuthService, hashPassword, verifyPassword };
