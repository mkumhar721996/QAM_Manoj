import crypto from "node:crypto";
import type { Session } from "./sessionModel.ts";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class SessionRepository {
  private sessionsById: Map<string, Session> = new Map();
  private sessionsByRefreshTokenHash: Map<string, Session> = new Map();

  create(userId: string, refreshToken: string, ttlMs: number, now: number = Date.now()): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      userId,
      refreshTokenHash: hashToken(refreshToken),
      createdAt: now,
      expiresAt: now + ttlMs,
      revoked: false,
    };
    this.sessionsById.set(session.id, session);
    this.sessionsByRefreshTokenHash.set(session.refreshTokenHash, session);
    return session;
  }

  findByRefreshToken(refreshToken: string): Session | undefined {
    return this.sessionsByRefreshTokenHash.get(hashToken(refreshToken));
  }

  revokeByRefreshToken(refreshToken: string): boolean {
    const session = this.findByRefreshToken(refreshToken);
    if (!session) {
      return false;
    }
    session.revoked = true;
    return true;
  }

  countByUserId(userId: string): number {
    let count = 0;
    for (const session of this.sessionsById.values()) {
      if (session.userId === userId) {
        count += 1;
      }
    }
    return count;
  }

  isValid(session: Session, now: number = Date.now()): boolean {
    return !session.revoked && session.expiresAt > now;
  }
}
