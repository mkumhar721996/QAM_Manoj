const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('AC1: registering with valid details creates an account with the selected role', async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const customerRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'test-password',
      role: 'customer',
    }),
  });
  assert.equal(customerRes.status, 201);
  const customerBody = await customerRes.json();
  assert.equal(customerBody.user.role, 'customer');
  assert.equal(customerBody.user.email, 'ada@example.com');
  assert.equal(customerBody.user.name, 'Ada Lovelace');
  assert.equal(customerBody.user.password, undefined);
  assert.equal(customerBody.user.passwordHash, undefined);

  const providerRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'test-password',
      role: 'provider',
    }),
  });
  assert.equal(providerRes.status, 201);
  const providerBody = await providerRes.json();
  assert.equal(providerBody.user.role, 'provider');
});
