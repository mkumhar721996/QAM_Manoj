const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/testServer');
const { createUser } = require('../../src/services/userService');
const { ROLES } = require('../../src/db/roles');

test('AC4: a newly created admin can log in immediately with no separate activation step', async () => {
  const { baseUrl, store, authService, close } = await startTestServer();
  try {
    createUser(store, { email: 'super@example.com', password: 'test-password', role: ROLES.SUPER_ADMIN });
    const superToken = authService.login('super@example.com', 'test-password');

    const createRes = await fetch(`${baseUrl}/admin/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({ email: 'newadmin@example.com', password: 'new-admin-password' }),
    });
    assert.equal(createRes.status, 201);

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newadmin@example.com', password: 'new-admin-password' }),
    });
    const body = await loginRes.json();

    assert.equal(loginRes.status, 200);
    assert.ok(typeof body.token === 'string' && body.token.length > 0);
  } finally {
    await close();
  }
});
