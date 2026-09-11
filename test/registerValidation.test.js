const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const userModel = require('../src/models/user');

const validPayload = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'test-password',
  role: 'customer',
};

const invalidCases = [
  { label: 'missing name', overrides: { name: '' }, field: 'name' },
  { label: 'missing email', overrides: { email: '' }, field: 'email' },
  { label: 'invalid email format', overrides: { email: 'not-an-email' }, field: 'email' },
  { label: 'missing password', overrides: { password: '' }, field: 'password' },
  { label: 'short password', overrides: { password: 'short' }, field: 'password' },
  { label: 'missing role', overrides: { role: '' }, field: 'role' },
  { label: 'invalid role', overrides: { role: 'admin' }, field: 'role' },
];

test('AC8 & AC9: invalid registration payloads are rejected with inline errors and create no account', async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  for (const { label, overrides, field } of invalidCases) {
    await t.test(label, async () => {
      const before = userModel.countAll();
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validPayload, email: `${label.replace(/\s+/g, '-')}@example.com`, ...overrides }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.ok(body.errors[field], `expected an inline error for field "${field}"`);
      assert.equal(userModel.countAll(), before);
    });
  }
});
