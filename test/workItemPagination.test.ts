import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { DEFAULT_LIMIT, DEFAULT_OFFSET, MAX_LIMIT, buildPaginationEnvelope } from "../src/pagination.ts";

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function createWorkItem(
  baseUrl: string,
  accessToken: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

function listWorkItems(
  baseUrl: string,
  accessToken: string,
  projectId: string,
  query: Record<string, number | string>,
): Promise<Response> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  const qs = params.toString();
  return fetch(`${baseUrl}/v1/projects/${projectId}/work-items${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

test("AC1: listing work items with limit/offset returns the full pagination envelope", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "One" });
    await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Two" });

    const res = await listWorkItems(server.baseUrl, token, "project-apollo", { limit: 1, offset: 0 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { total: number; limit: number; offset: number; items: unknown[] };
    assert.deepEqual(Object.keys(body).sort(), ["items", "limit", "offset", "total"]);
    assert.equal(body.limit, 1);
    assert.equal(body.offset, 0);
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 1);
  } finally {
    await server.close();
  }
});

test("AC2: listing without limit/offset applies the default values", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Only one" });

    const res = await listWorkItems(server.baseUrl, token, "project-apollo", {});
    assert.equal(res.status, 200);
    const body = (await res.json()) as { limit: number; offset: number };
    assert.equal(body.limit, DEFAULT_LIMIT);
    assert.equal(body.offset, DEFAULT_OFFSET);
  } finally {
    await server.close();
  }
});

test("AC3: a limit above the maximum is rejected with VALIDATION_ERROR", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await listWorkItems(server.baseUrl, token, "project-apollo", { limit: MAX_LIMIT + 1 });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error_code: string; message: string };
    assert.equal(body.error_code, "VALIDATION_ERROR");
    assert.match(body.message, new RegExp(String(MAX_LIMIT)));
  } finally {
    await server.close();
  }
});

test("AC4: buildPaginationEnvelope always produces the same four-key shape", () => {
  const envelope = buildPaginationEnvelope(["x"], 5, 10, 0);
  assert.deepEqual(Object.keys(envelope).sort(), ["items", "limit", "offset", "total"]);
});

test("AC4: the work-items collection endpoint response has exactly the canonical envelope keys", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await listWorkItems(server.baseUrl, token, "project-apollo", {});
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["items", "limit", "offset", "total"]);
  } finally {
    await server.close();
  }
});

test("AC5: a limit exactly at the maximum is accepted", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await listWorkItems(server.baseUrl, token, "project-apollo", { limit: MAX_LIMIT });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { limit: number };
    assert.equal(body.limit, MAX_LIMIT);
  } finally {
    await server.close();
  }
});

test("AC6: an offset past the end returns an empty items array and the real total", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Only one" });

    const res = await listWorkItems(server.baseUrl, token, "project-apollo", { offset: 50 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { total: number; items: unknown[] };
    assert.equal(body.total, 1);
    assert.deepEqual(body.items, []);
  } finally {
    await server.close();
  }
});
