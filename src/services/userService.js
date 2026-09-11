const { randomUUID } = require('crypto');
const { hashPassword } = require('../utils/password');

function createUser(store, { email, password, role }) {
  const user = {
    id: randomUUID(),
    email,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  };
  return store.insertUser(user);
}

function hasSuperAdmin(store) {
  return Boolean(store.findSuperAdmin());
}

module.exports = { createUser, hasSuperAdmin };
