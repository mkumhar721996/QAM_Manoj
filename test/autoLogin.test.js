const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('AC3: a successful registration auto-logs the user in via a usable session token', async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const registerRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'test-password',
      role: 'customer',
    }),
  });
  assert.equal(registerRes.status, 201);
  const { token } = await registerRes.json();
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 0);

  const meRes = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);
  const meBody = await meRes.json();
  assert.equal(meBody.user.email, 'ada@example.com');
  assert.equal(meBody.user.role, 'customer');
});
