import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { SessionRepository } from "../src/sessions/sessionRepository.ts";

async function login(baseUrl: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string; refresh_token: string };
}

async function refresh(baseUrl: string, refreshToken: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

async function logout(baseUrl: string, refreshToken: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

test("AC5 & AC6: logout invalidates only that session's refresh token", async () => {
  const server = await startTestServer();
  try {
    const { refresh_token: refreshToken } = await login(server.baseUrl);

    const logoutRes = await logout(server.baseUrl, refreshToken);
    assert.equal(logoutRes.status, 204);

    const refreshAfterLogout = await refresh(server.baseUrl, refreshToken);
    assert.equal(refreshAfterLogout.status, 401);
  } finally {
    await server.close();
  }
});

test("AC11: logging in twice for the same user creates two independent, concurrently valid sessions", async () => {
  const sessionRepository = new SessionRepository();
  const server = await startTestServer({ sessionRepository });
  try {
    const deviceA = await login(server.baseUrl);
    const deviceB = await login(server.baseUrl);

    assert.notEqual(deviceA.refresh_token, deviceB.refresh_token);
    assert.equal(sessionRepository.countByUserId("user-customer-1"), 2);

    const refreshA = await refresh(server.baseUrl, deviceA.refresh_token);
    const refreshB = await refresh(server.baseUrl, deviceB.refresh_token);
    assert.equal(refreshA.status, 200);
    assert.equal(refreshB.status, 200);
  } finally {
    await server.close();
  }
});

test("AC12: logging out of one device leaves other sessions for the same user valid", async () => {
  const server = await startTestServer();
  try {
    const deviceA = await login(server.baseUrl);
    const deviceB = await login(server.baseUrl);

    const logoutRes = await logout(server.baseUrl, deviceA.refresh_token);
    assert.equal(logoutRes.status, 204);

    const refreshA = await refresh(server.baseUrl, deviceA.refresh_token);
    assert.equal(refreshA.status, 401);

    const refreshB = await refresh(server.baseUrl, deviceB.refresh_token);
    assert.equal(refreshB.status, 200);
  } finally {
    await server.close();
  }
});
