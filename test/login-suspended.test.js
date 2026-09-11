import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, seedUser, login } from './helpers.js';

test('AC3: a suspended user is rejected on login with a clear message and no tokens issued', async () => {
  const { store, baseUrl, close } = await startTestServer();
  try {
    const admin = seedUser(store, { email: 'admin@example.com', password: 'test-password', role: 'ADMIN' });
    const user = seedUser(store, { email: 'user@example.com', password: 'test-password' });
    const adminLogin = await login(baseUrl, admin.email, 'test-password');

    await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });

    const attempt = await login(baseUrl, user.email, 'test-password');

    assert.equal(attempt.status, 403);
    assert.match(attempt.body.message.toLowerCase(), /suspend/);
    assert.equal(attempt.body.accessToken, undefined);
    assert.equal(attempt.body.refreshToken, undefined);
  } finally {
    await close();
  }
});
