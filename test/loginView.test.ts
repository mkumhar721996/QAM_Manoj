import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { SessionRepository } from "../src/sessions/sessionRepository.ts";

test("AC1: a valid login keeps the user authenticated after a simulated reload", async () => {
  const server = await startTestServer();
  try {
    const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
    });
    assert.equal(loginRes.status, 200);
    const { refresh_token: refreshToken } = (await loginRes.json()) as { refresh_token: string };

    // Simulate a page reload: only the persisted refresh token is available, no credentials.
    const reloadRes = await fetch(`${server.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(reloadRes.status, 200);
    const { access_token: accessToken } = (await reloadRes.json()) as { access_token: string };

    const sessionRes = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(sessionRes.status, 200);
  } finally {
    await server.close();
  }
});

test("AC2: a successful login response contains what a client needs to route to Home", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(typeof body.access_token, "string");
    assert.equal(typeof body.refresh_token, "string");
  } finally {
    await server.close();
  }
});

test("AC3: an unrecognised username or wrong password returns an error message", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: "wrong-password" }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Invalid username or password");
  } finally {
    await server.close();
  }
});

test("AC4: a failed login issues no tokens and creates no session", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: "wrong-password" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.access_token, undefined);
    assert.equal(body.refresh_token, undefined);
    assert.equal(sessionRepository.countByUserId("user-customer-1"), 0);
  } finally {
    await server.close();
  }
});

test("AC5: submitting with empty username or password is blocked, not authenticated", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "", password: "" }),
    });
    assert.equal(res.status, 400);
    assert.equal(sessionRepository.countByUserId("user-customer-1"), 0);
  } finally {
    await server.close();
  }
});

test("AC6: the validation error identifies exactly which fields are empty", async () => {
  const server = await startTestServer();
  try {
    const bothEmpty = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "", password: "" }),
    });
    const bothBody = (await bothEmpty.json()) as { errors: Record<string, string> };
    assert.equal(typeof bothBody.errors.username, "string");
    assert.equal(typeof bothBody.errors.password, "string");

    const onlyPasswordEmpty = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: "" }),
    });
    const partialBody = (await onlyPasswordEmpty.json()) as { errors: Record<string, string> };
    assert.equal("username" in partialBody.errors, false);
    assert.equal(typeof partialBody.errors.password, "string");
  } finally {
    await server.close();
  }
});
