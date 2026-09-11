"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

const PASSWORD = "test-password";

async function startApp() {
  const app = createApp({ tokenSecret: "test-secret" });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address();
  app.baseUrl = `http://127.0.0.1:${port}`;
  return app;
}

function stopApp(app) {
  return new Promise((resolve) => app.server.close(resolve));
}

function registerUser(app, overrides = {}) {
  return app.authService.register({
    email: overrides.email || `user-${Math.random().toString(36).slice(2)}@example.com`,
    password: overrides.password || PASSWORD,
    displayName: overrides.displayName || "Original Name",
    phone: overrides.phone || "+1-555-0100",
  });
}

async function login(app, email, password = PASSWORD) {
  const res = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

function deleteUser(app, targetId, accessToken) {
  const headers = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  return fetch(`${app.baseUrl}/api/users/${targetId}`, { method: "DELETE", headers });
}

test("AC1: invalidates active access and refresh tokens immediately on deletion", async () => {
  const app = await startApp();
  try {
    const user = registerUser(app);
    const { status: loginStatus, body: tokens } = await login(app, user.email);
    assert.equal(loginStatus, 200);

    const deleteRes = await deleteUser(app, user.id, tokens.accessToken);
    assert.equal(deleteRes.status, 204);

    const meRes = await fetch(`${app.baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(meRes.status, 401, "old access token must be rejected after deletion");

    const refreshRes = await fetch(`${app.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    assert.equal(refreshRes.status, 401, "old refresh token must be rejected after deletion");
  } finally {
    await stopApp(app);
  }
});

test("AC2: rejects login for a deleted account", async () => {
  const app = await startApp();
  try {
    const user = registerUser(app);
    const originalEmail = user.email;
    const { body: tokens } = await login(app, originalEmail);
    await deleteUser(app, user.id, tokens.accessToken);

    const { status } = await login(app, originalEmail);
    assert.equal(status, 401);
  } finally {
    await stopApp(app);
  }
});

test("AC3: anonymises PII on deletion", async () => {
  const app = await startApp();
  try {
    const user = registerUser(app, { phone: "+1-555-0100" });
    const originalCreatedAt = user.createdAt;
    const { body: tokens } = await login(app, user.email);

    const deleteRes = await deleteUser(app, user.id, tokens.accessToken);
    assert.equal(deleteRes.status, 204);

    const stored = app.userRepository.findById(user.id);
    assert.equal(stored.id, user.id);
    assert.equal(stored.createdAt, originalCreatedAt);
    assert.equal(stored.status, "deleted");
    assert.equal(stored.email, `deleted-${user.id}@deleted.invalid`);
    assert.equal(stored.displayName, "Deleted User");
    assert.equal(stored.phone, null);
    assert.ok(stored.deletedAt);
  } finally {
    await stopApp(app);
  }
});

test("AC4: rejects deletion of another user's account", async () => {
  const app = await startApp();
  try {
    const userA = registerUser(app);
    const userB = registerUser(app);
    const { body: tokensA } = await login(app, userA.email);

    const res = await deleteUser(app, userB.id, tokensA.accessToken);
    assert.equal(res.status, 403);

    const storedB = app.userRepository.findById(userB.id);
    assert.equal(storedB.status, "active");
    assert.equal(storedB.email, userB.email);
    assert.equal(storedB.displayName, userB.displayName);
  } finally {
    await stopApp(app);
  }
});

test("AC5: rejects deletion requests with no or invalid authentication", async () => {
  const app = await startApp();
  try {
    const user = registerUser(app);

    const noAuthRes = await deleteUser(app, user.id);
    assert.equal(noAuthRes.status, 401);

    const invalidAuthRes = await deleteUser(app, user.id, "not-a-real-token");
    assert.equal(invalidAuthRes.status, 401);

    const stored = app.userRepository.findById(user.id);
    assert.equal(stored.status, "active");
    assert.equal(stored.email, user.email);
  } finally {
    await stopApp(app);
  }
});
