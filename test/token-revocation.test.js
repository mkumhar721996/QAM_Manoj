import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, seedUser, login } from './helpers.js';

test('AC2: a still-valid access token is rejected immediately after the account is suspended', async () => {
  const { store, baseUrl, close } = await startTestServer();
  try {
    const admin = seedUser(store, { email: 'admin@example.com', password: 'test-password', role: 'ADMIN' });
    const user = seedUser(store, { email: 'user@example.com', password: 'test-password' });
    const adminLogin = await login(baseUrl, admin.email, 'test-password');
    const userLogin = await login(baseUrl, user.email, 'test-password');
    assert.equal(userLogin.status, 200);

    const before = await fetch(`${baseUrl}/protected/ping`, {
      headers: { Authorization: `Bearer ${userLogin.body.accessToken}` },
    });
    assert.equal(before.status, 200);

    await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });

    const after = await fetch(`${baseUrl}/protected/ping`, {
      headers: { Authorization: `Bearer ${userLogin.body.accessToken}` },
    });
    assert.notEqual(after.status, 200);
    assert.ok(after.status === 401 || after.status === 403);
  } finally {
    await close();
  }
});
