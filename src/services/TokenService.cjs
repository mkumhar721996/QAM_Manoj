"use strict";

const crypto = require("node:crypto");

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

class TokenService {
  /**
   * @param {{ secret: string, userRepository: import('../repositories/InMemoryUserRepository').InMemoryUserRepository }} deps
   */
  constructor({ secret, userRepository }) {
    this.secret = secret;
    this.userRepository = userRepository;
    /** @type {Map<string, string>} refreshToken -> userId */
    this.refreshTokensByToken = new Map();
    /** @type {Map<string, Set<string>>} userId -> refreshTokens */
    this.refreshTokensByUser = new Map();
  }

  sign(payload) {
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64url(JSON.stringify(payload));
    const signature = crypto
      .createHmac("sha256", this.secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  /** Verifies signature and expiry only; does not check tokenVersion or user status. */
  decodeAndVerifySignature(token) {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSignature = crypto
      .createHmac("sha256", this.secret)
      .update(`${header}.${body}`)
      .digest("base64url");

    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return null;
    }

    let payload;
    try {
      payload = JSON.parse(fromBase64url(body));
    } catch {
      return null;
    }

    if (typeof payload.exp !== "number" || Date.now() / 1000 >= payload.exp) {
      return null;
    }

    return payload;
  }

  issueAccessToken(user) {
    const now = Math.floor(Date.now() / 1000);
    return this.sign({
      sub: user.id,
      tokenVersion: user.tokenVersion,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  issueRefreshToken(user) {
    const token = crypto.randomBytes(32).toString("base64url");
    this.refreshTokensByToken.set(token, user.id);
    if (!this.refreshTokensByUser.has(user.id)) {
      this.refreshTokensByUser.set(user.id, new Set());
    }
    this.refreshTokensByUser.get(user.id).add(token);
    return token;
  }

  /**
   * Verifies an access token end-to-end: signature, expiry, the subject user
   * still exists and is active, and the embedded tokenVersion still matches
   * the user's current tokenVersion (so a bump immediately invalidates it).
   */
  verifyAccessToken(token) {
    const payload = this.decodeAndVerifySignature(token);
    if (!payload) return null;

    const user = this.userRepository.findById(payload.sub);
    if (!user || user.status !== "active") return null;
    if (user.tokenVersion !== payload.tokenVersion) return null;

    return user;
  }

  /** Returns the user for a still-valid, non-revoked refresh token, or null. */
  useRefreshToken(refreshToken) {
    const userId = this.refreshTokensByToken.get(refreshToken);
    if (!userId) return null;

    const user = this.userRepository.findById(userId);
    if (!user || user.status !== "active") return null;

    return user;
  }

  /** Revokes all refresh tokens issued to a given user (used on account deletion). */
  revokeAllForUser(userId) {
    const tokens = this.refreshTokensByUser.get(userId);
    if (tokens) {
      for (const token of tokens) {
        this.refreshTokensByToken.delete(token);
      }
      this.refreshTokensByUser.delete(userId);
    }
  }
}

module.exports = { TokenService };
