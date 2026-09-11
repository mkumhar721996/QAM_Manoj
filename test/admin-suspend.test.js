import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, seedUser, login } from './helpers.js';

test('AC1: admin suspending an active user marks it suspended and revokes all existing tokens', async () => {
  const { store, baseUrl, close } = await startTestServer();
  try {
    const admin = seedUser(store, { email: 'admin@example.com', password: 'test-password', role: 'ADMIN' });
    const user = seedUser(store, { email: 'user@example.com', password: 'test-password' });

    const adminLogin = await login(baseUrl, admin.email, 'test-password');
    const userLogin = await login(baseUrl, user.email, 'test-password');
    assert.equal(userLogin.status, 200);
    assert.equal(store.refreshTokens.countActiveForUser(user.id), 1);

    const res = await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'SUSPENDED');
    assert.equal(store.users.findById(user.id).status, 'SUSPENDED');
    assert.equal(store.refreshTokens.countActiveForUser(user.id), 0);
  } finally {
    await close();
  }
});

test('AC1: a non-admin caller cannot suspend an account', async () => {
  const { store, baseUrl, close } = await startTestServer();
  try {
    const user = seedUser(store, { email: 'user@example.com', password: 'test-password' });
    const other = seedUser(store, { email: 'other@example.com', password: 'test-password' });
    const otherLogin = await login(baseUrl, other.email, 'test-password');

    const res = await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherLogin.body.accessToken}` },
    });

    assert.equal(res.status, 403);
    assert.equal(store.users.findById(user.id).status, 'ACTIVE');
  } finally {
    await close();
  }
});

test('AC5: suspending an already-suspended account succeeds idempotently', async () => {
  const { store, baseUrl, close } = await startTestServer();
  try {
    const admin = seedUser(store, { email: 'admin@example.com', password: 'test-password', role: 'ADMIN' });
    const user = seedUser(store, { email: 'user@example.com', password: 'test-password' });
    const adminLogin = await login(baseUrl, admin.email, 'test-password');

    const first = await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    const second = await fetch(`${baseUrl}/admin/users/${user.id}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.accessToken}` },
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(store.users.findById(user.id).status, 'SUSPENDED');
  } finally {
    await close();
  }
});
