const db = require('../db');

const ROLES = ['customer', 'provider'];

function create({ name, email, passwordHash, role }) {
  if (!ROLES.includes(role)) {
    throw new Error(`invalid role: ${role}`);
  }
  return db.insertUser({ name, email, passwordHash, role });
}

function findByEmail(email) {
  return db.findUserByEmail(email);
}

function findById(id) {
  return db.findUserById(id);
}

function countByEmail(email) {
  return db.countUsersByEmail(email);
}

function countAll() {
  return db.countUsers();
}

// Role is permanently assigned at registration. Intentionally, there is no
// updateRole (or generic update) function here: this is the only place a
// user's role can ever be set, so it can never change after account creation.

module.exports = { ROLES, create, findByEmail, findById, countByEmail, countAll };
