// In-memory data store standing in for the users table.
let usersById;
let usersByEmail;
let nextId;

function reset() {
  usersById = new Map();
  usersByEmail = new Map();
  nextId = 1;
}

reset();

function insertUser({ name, email, passwordHash, role }) {
  const normalizedEmail = email.toLowerCase();
  if (usersByEmail.has(normalizedEmail)) {
    const err = new Error('email already registered');
    err.code = 'DUPLICATE_EMAIL';
    throw err;
  }
  const user = {
    id: nextId++,
    name,
    email,
    normalizedEmail,
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
  };
  usersById.set(user.id, user);
  usersByEmail.set(normalizedEmail, user);
  return user;
}

function findUserByEmail(email) {
  return usersByEmail.get(email.toLowerCase()) || null;
}

function findUserById(id) {
  return usersById.get(id) || null;
}

function countUsersByEmail(email) {
  return findUserByEmail(email) ? 1 : 0;
}

function countUsers() {
  return usersById.size;
}

module.exports = {
  reset,
  insertUser,
  findUserByEmail,
  findUserById,
  countUsersByEmail,
  countUsers,
};
