import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { SessionRepository } from "../src/sessions/sessionRepository.ts";
import { issueAccessToken } from "../src/auth/tokenService.ts";

async function login(baseUrl: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string; refresh_token: string };
}

test("AC2: refresh token expires exactly 7 days after session creation", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const { refresh_token: refreshToken } = await login(server.baseUrl);
    const session = sessionRepository.findByRefreshToken(refreshToken)!;
    assert.equal(session.expiresAt - session.createdAt, 7 * 24 * 60 * 60 * 1000);
  } finally {
    await server.close();
  }
});

test("AC3: an expired access token can be renewed transparently via a valid refresh token", async () => {
  const server = await startTestServer();
  try {
    const { refresh_token: refreshToken } = await login(server.baseUrl);

    const res = await fetch(`${server.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    assert.equal(typeof body.access_token, "string");
    assert.equal(body.expires_in, 15 * 60);
  } finally {
    await server.close();
  }
});

test("AC4: an expired refresh token is rejected so the client can redirect to login", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const expiredRefreshToken = "expired-refresh-token";
    sessionRepository.create("user-customer-1", expiredRefreshToken, 7 * 24 * 60 * 60 * 1000, eightDaysAgo);

    const res = await fetch(`${server.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: expiredRefreshToken }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Invalid or expired refresh token");
  } finally {
    await server.close();
  }
});

test("AC4: an unknown refresh token is rejected", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: "never-issued-token" }),
    });
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});

test("AC3: a valid access token authenticates a protected request", async () => {
  const server = await startTestServer();
  try {
    const { access_token: accessToken } = await login(server.baseUrl);

    const res = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user_id: string; role: string };
    assert.equal(body.user_id, "user-customer-1");
    assert.equal(body.role, "customer");
  } finally {
    await server.close();
  }
});

test("AC3: a missing or invalid access token is rejected on a protected request", async () => {
  const server = await startTestServer();
  try {
    const noAuthRes = await fetch(`${server.baseUrl}/auth/session`);
    assert.equal(noAuthRes.status, 401);

    const badAuthRes = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    assert.equal(badAuthRes.status, 401);
  } finally {
    await server.close();
  }
});

test("AC3: an expired access token is rejected on a protected request", async () => {
  const server = await startTestServer();
  try {
    const sixteenMinutesAgo = Date.now() - 16 * 60 * 1000;
    const expiredAccessToken = issueAccessToken({ userId: "user-customer-1", role: "customer" }, sixteenMinutesAgo);

    const res = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: `Bearer ${expiredAccessToken}` },
    });
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});

test("AC9: a long idle period does not invalidate a still-valid refresh token", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const { refresh_token: refreshToken } = await login(server.baseUrl);

    // Simulate 6 days of user inactivity, well within the 7-day refresh token lifetime.
    const sixDaysLater = Date.now() + 6 * 24 * 60 * 60 * 1000;
    const session = sessionRepository.findByRefreshToken(refreshToken)!;
    assert.equal(sessionRepository.isValid(session, sixDaysLater), true);

    const res = await fetch(`${server.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(res.status, 200);
  } finally {
    await server.close();
  }
});
