const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const userModel = require('../src/models/user');

test('AC2: role is permanently assigned at registration and cannot be changed later', () => {
  db.reset();
  const user = userModel.create({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    passwordHash: 'irrelevant-hash',
    role: 'customer',
  });

  assert.equal(typeof userModel.update, 'undefined');

  const persisted = userModel.findById(user.id);
  assert.equal(persisted.role, 'customer');
});
