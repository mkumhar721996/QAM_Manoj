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

test("AC2: a successful login navigates the user to the Home view", async () => {
  const server = await startTestServer();
  try {
    const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
    });
    assert.equal(loginRes.status, 200);
    const { access_token: accessToken } = (await loginRes.json()) as { access_token: string };

    const homeRes = await fetch(`${server.baseUrl}/home`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(homeRes.status, 200);
    const homeBody = (await homeRes.json()) as { view: string };
    assert.equal(homeBody.view, "home");
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

test("AC4: a failed login issues no tokens, creates no session, and cannot reach the Home view", async () => {
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

    const homeRes = await fetch(`${server.baseUrl}/home`);
    assert.equal(homeRes.status, 401);
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

test("AC7: clicking the Register link from the Login view shows the Register view", async () => {
  const server = await startTestServer();
  try {
    const loginViewRes = await fetch(`${server.baseUrl}/login`);
    assert.equal(loginViewRes.status, 200);
    const loginViewBody = (await loginViewRes.json()) as { links: { register: string } };
    assert.equal(typeof loginViewBody.links.register, "string");

    const registerRes = await fetch(`${server.baseUrl}${loginViewBody.links.register}`);
    assert.equal(registerRes.status, 200);
    const registerBody = (await registerRes.json()) as { view: string };
    assert.equal(registerBody.view, "register");
  } finally {
    await server.close();
  }
});

test("AC8: clicking 'Forgot password' from the Login view shows the Forgot Password view", async () => {
  const server = await startTestServer();
  try {
    const loginViewRes = await fetch(`${server.baseUrl}/login`);
    assert.equal(loginViewRes.status, 200);
    const loginViewBody = (await loginViewRes.json()) as { links: { forgot_password: string } };
    assert.equal(typeof loginViewBody.links.forgot_password, "string");

    const forgotPasswordRes = await fetch(`${server.baseUrl}${loginViewBody.links.forgot_password}`);
    assert.equal(forgotPasswordRes.status, 200);
    const forgotPasswordBody = (await forgotPasswordRes.json()) as { view: string };
    assert.equal(forgotPasswordBody.view, "forgot-password");
  } finally {
    await server.close();
  }
});
