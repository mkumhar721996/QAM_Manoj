const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const userModel = require('../src/models/user');

test('AC4 & AC5: duplicate email registration is rejected and no duplicate account is created', async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const payload = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'test-password',
    role: 'customer',
  };

  const firstRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(firstRes.status, 201);
  assert.equal(userModel.countByEmail(payload.email), 1);

  const secondRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, name: 'Someone Else' }),
  });
  assert.equal(secondRes.status, 409);
  const secondBody = await secondRes.json();
  assert.equal(secondBody.error, 'email already registered');

  assert.equal(userModel.countByEmail(payload.email), 1);
});
