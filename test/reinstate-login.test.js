import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, seedUser, login } from './helpers.js';

test('AC4: a reinstated user can log in again and use freshly issued tokens', async () => {
  const { store, baseUrl, close } = await startTestServer();
  try {
    const admin = seedUser(store, { email: 'admin@example.com', password: 'test-password', role: 'ADMIN' });
    const user = seedUser(store, { email: 'user@example.com', password: 'test-password' });
    const adminLogin = await login(baseUrl, admin.email, 'test-password');

    await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });

    const reinstateRes = await fetch(`${baseUrl}/admin/users/${user.id}/reinstate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    const reinstateBody = await reinstateRes.json();
    assert.equal(reinstateRes.status, 200);
    assert.equal(reinstateBody.status, 'ACTIVE');

    const newLogin = await login(baseUrl, user.email, 'test-password');
    assert.equal(newLogin.status, 200);
    assert.ok(newLogin.body.accessToken);
    assert.ok(newLogin.body.refreshToken);

    const protectedRes = await fetch(`${baseUrl}/protected/ping`, {
      headers: { Authorization: `Bearer ${newLogin.body.accessToken}` },
    });
    assert.equal(protectedRes.status, 200);
  } finally {
    await close();
  }
});
