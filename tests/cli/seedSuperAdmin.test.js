const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../../src/db/store');
const { seedSuperAdmin } = require('../../src/cli/seedSuperAdmin');
const { verifyPassword } = require('../../src/utils/password');

function tempDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qam-test-')), 'db.json');
}

test('AC1: running the seed tool on an empty DB creates exactly one super-admin with operator-supplied credentials', () => {
  const store = createStore(tempDbFile());

  const result = seedSuperAdmin(store, { email: 'owner@example.com', password: 'test-password' });

  assert.equal(result.created, true);
  const superAdmins = store.all().filter((u) => u.role === 'super_admin');
  assert.equal(superAdmins.length, 1);
  assert.equal(superAdmins[0].email, 'owner@example.com');
  assert.ok(verifyPassword('test-password', superAdmins[0].passwordHash));
});

test('AC2: running the seed tool again after a super-admin exists creates no duplicate', () => {
  const store = createStore(tempDbFile());
  seedSuperAdmin(store, { email: 'owner@example.com', password: 'test-password' });

  const second = seedSuperAdmin(store, { email: 'someone-else@example.com', password: 'another-test-password' });

  assert.equal(second.created, false);
  const superAdmins = store.all().filter((u) => u.role === 'super_admin');
  assert.equal(superAdmins.length, 1);
  assert.equal(superAdmins[0].email, 'owner@example.com');
});
