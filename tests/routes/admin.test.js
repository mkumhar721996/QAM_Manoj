const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/testServer');
const { createUser } = require('../../src/services/userService');
const { ROLES } = require('../../src/db/roles');

test('AC3: an authenticated super-admin creates a new admin account', async () => {
  const { baseUrl, store, authService, close } = await startTestServer();
  try {
    createUser(store, { email: 'super@example.com', password: 'test-password', role: ROLES.SUPER_ADMIN });
    const token = authService.login('super@example.com', 'test-password');

    const res = await fetch(`${baseUrl}/admin/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: 'newadmin@example.com', password: 'test-password-2' }),
    });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.role, ROLES.ADMIN);
    assert.equal(store.countByRole(ROLES.ADMIN), 1);
  } finally {
    await close();
  }
});

test('AC5 & AC6: a non-super admin cannot create an admin account and none is created', async () => {
  const { baseUrl, store, authService, close } = await startTestServer();
  try {
    createUser(store, { email: 'admin@example.com', password: 'test-password', role: ROLES.ADMIN });
    const token = authService.login('admin@example.com', 'test-password');
    const usersBefore = store.all().length;

    const res = await fetch(`${baseUrl}/admin/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: 'another-admin@example.com', password: 'test-password-2' }),
    });

    assert.equal(res.status, 403);
    assert.equal(store.all().length, usersBefore);
  } finally {
    await close();
  }
});

test('AC7: a non-admin is denied and an unauthenticated request is denied', async () => {
  const { baseUrl, store, authService, close } = await startTestServer();
  try {
    createUser(store, { email: 'customer@example.com', password: 'test-password', role: ROLES.CUSTOMER });
    const token = authService.login('customer@example.com', 'test-password');

    const resCustomer = await fetch(`${baseUrl}/admin/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: 'x@example.com', password: 'test-password-2' }),
    });
    assert.equal(resCustomer.status, 403);

    const resUnauthenticated = await fetch(`${baseUrl}/admin/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'y@example.com', password: 'test-password-2' }),
    });
    assert.equal(resUnauthenticated.status, 401);
  } finally {
    await close();
  }
});
