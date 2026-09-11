import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD, testUsers } from "../src/users/fixtures/testUsers.ts";
import { SessionRepository } from "../src/sessions/sessionRepository.ts";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

test("AC1: valid login issues an access token expiring in exactly 15 minutes", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { access_token: string };

    const payload = decodeJwtPayload(body.access_token);
    assert.equal((payload.exp as number) - (payload.iat as number), 15 * 60);
  } finally {
    await server.close();
  }
});

test("AC7: incorrect password is rejected with a clear generic error message", async () => {
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

test("AC7: unknown username is rejected with the same generic error message", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "no-such-user", password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Invalid username or password");
  } finally {
    await server.close();
  }
});

test("AC8: no session is created after a failed login", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: "wrong-password" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.refresh_token, undefined);

    const customer = testUsers.find((u) => u.username === "customer1")!;
    assert.equal(sessionRepository.countByUserId(customer.id), 0);
  } finally {
    await server.close();
  }
});

test("AC10: login response and request contract expose no remember-me option", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD, rememberMe: true }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("rememberMe" in body, false);
    assert.equal("remember_me" in body, false);

    // A rememberMe flag submitted by a client must not extend the refresh token lifetime.
    const refreshToken = body.refresh_token as string;
    const session = sessionRepository.findByRefreshToken(refreshToken)!;
    assert.equal(session.expiresAt - session.createdAt, 7 * 24 * 60 * 60 * 1000);
  } finally {
    await server.close();
  }
});

test("AC13: login behaves identically for every role", async () => {
  const server = await startTestServer();
  try {
    for (const user of testUsers) {
      const res = await fetch(`${server.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, password: TEST_PASSWORD }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
      assert.equal(body.expires_in, 15 * 60);
      assert.equal(typeof body.refresh_token, "string");
      const payload = decodeJwtPayload(body.access_token);
      assert.equal(payload.exp as number, (payload.iat as number) + 15 * 60);

      const failRes = await fetch(`${server.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, password: "wrong-password" }),
      });
      assert.equal(failRes.status, 401);
      const failBody = (await failRes.json()) as { error: string };
      assert.equal(failBody.error, "Invalid username or password");
    }
  } finally {
    await server.close();
  }
});
