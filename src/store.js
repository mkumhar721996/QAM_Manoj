// In-memory persistence layer for users and refresh tokens.
// Swappable for a real database later; only the shape of these
// operations matters to the rest of the app.

export const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
});

export function createStore() {
  const usersById = new Map();
  const usersByEmail = new Map();
  let nextUserId = 1;

  // refreshTokensByHash: hash -> { userId, createdAt, revokedAt }
  const refreshTokensByHash = new Map();

  return {
    users: {
      create({ email, passwordHash, role = 'USER' }) {
        const id = String(nextUserId++);
        const user = {
          id,
          email,
          passwordHash,
          role,
          status: USER_STATUS.ACTIVE,
          tokenVersion: 0,
        };
        usersById.set(id, user);
        usersByEmail.set(email, user);
        return user;
      },
      findById(id) {
        return usersById.get(id) || null;
      },
      findByEmail(email) {
        return usersByEmail.get(email) || null;
      },
    },
    refreshTokens: {
      add(tokenHash, userId) {
        refreshTokensByHash.set(tokenHash, { userId, createdAt: Date.now(), revokedAt: null });
      },
      findValid(tokenHash) {
        const entry = refreshTokensByHash.get(tokenHash);
        if (!entry || entry.revokedAt) return null;
        return entry;
      },
      revokeAllForUser(userId) {
        for (const entry of refreshTokensByHash.values()) {
          if (entry.userId === userId && !entry.revokedAt) {
            entry.revokedAt = Date.now();
          }
        }
      },
      countActiveForUser(userId) {
        let count = 0;
        for (const entry of refreshTokensByHash.values()) {
          if (entry.userId === userId && !entry.revokedAt) count += 1;
        }
        return count;
      },
    },
  };
}
