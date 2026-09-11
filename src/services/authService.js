const { randomUUID } = require('crypto');
const { verifyPassword } = require('../utils/password');

function createAuthService(store, sessions = new Map()) {
  return {
    login(email, password) {
      const user = store.findByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return null;
      }
      const token = randomUUID();
      sessions.set(token, { userId: user.id, email: user.email, role: user.role });
      return token;
    },
    verifyToken(token) {
      return sessions.get(token) || null;
    },
  };
}

module.exports = { createAuthService };
