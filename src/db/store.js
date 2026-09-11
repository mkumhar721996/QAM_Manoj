const fs = require('fs');
const path = require('path');
const { ROLES } = require('./roles');

function readAll(filePath) {
  if (!fs.existsSync(filePath)) return { users: [] };
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return { users: [] };
  return JSON.parse(raw);
}

function writeAll(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// File-backed store standing in for a real database in this environment.
// insertUser enforces the "at most one super_admin" and unique-email
// invariants the same way a DB-level constraint would.
function createStore(filePath) {
  return {
    findByEmail(email) {
      return readAll(filePath).users.find((u) => u.email === email) || null;
    },
    findSuperAdmin() {
      return readAll(filePath).users.find((u) => u.role === ROLES.SUPER_ADMIN) || null;
    },
    insertUser(user) {
      const data = readAll(filePath);
      if (user.role === ROLES.SUPER_ADMIN && data.users.some((u) => u.role === ROLES.SUPER_ADMIN)) {
        throw new Error('A super_admin account already exists');
      }
      if (data.users.some((u) => u.email === user.email)) {
        throw new Error('A user with this email already exists');
      }
      data.users.push(user);
      writeAll(filePath, data);
      return user;
    },
    countByRole(role) {
      return readAll(filePath).users.filter((u) => u.role === role).length;
    },
    all() {
      return readAll(filePath).users;
    },
  };
}

module.exports = { createStore };
