import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { stripV1Prefix } from "../src/routing.ts";

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

test("AC1: all task management endpoints respond successfully under their /v1 prefixed path", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");

    const createRes = await fetch(`${server.baseUrl}/v1/projects/project-apollo/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "TASK", title: "Versioned create" }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${server.baseUrl}/v1/work-items/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 200);

    const patchRes = await fetch(`${server.baseUrl}/v1/work-items/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: "Updated" }),
    });
    assert.equal(patchRes.status, 200);

    const deleteRes = await fetch(`${server.baseUrl}/v1/work-items/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deleteRes.status, 204);
  } finally {
    await server.close();
  }
});

test("AC2: omitting the /v1 prefix returns 404 for every task management endpoint", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");

    const createRes = await fetch(`${server.baseUrl}/projects/project-apollo/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "TASK", title: "Unversioned create" }),
    });
    assert.equal(createRes.status, 404);

    const getRes = await fetch(`${server.baseUrl}/work-items/APOLLO-TASK-001`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 404);

    const patchRes = await fetch(`${server.baseUrl}/work-items/APOLLO-TASK-001`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: "nope" }),
    });
    assert.equal(patchRes.status, 404);

    const deleteRes = await fetch(`${server.baseUrl}/work-items/APOLLO-TASK-001`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deleteRes.status, 404);
  } finally {
    await server.close();
  }
});

test("AC3: the v1 prefix gate is route-agnostic, so any future task management path is only reachable under /v1", () => {
  assert.equal(stripV1Prefix("/work-items/APOLLO-TASK-001"), null);
  assert.equal(stripV1Prefix("/projects/project-apollo/work-items"), null);
  assert.equal(stripV1Prefix("/v1/work-items/APOLLO-TASK-001"), "/work-items/APOLLO-TASK-001");
  assert.equal(stripV1Prefix("/v1/projects/project-apollo/work-items"), "/projects/project-apollo/work-items");

  // a hypothetical future sub-resource that doesn't exist yet - still gated identically
  assert.equal(stripV1Prefix("/work-items/APOLLO-TASK-001/comments"), null);
  assert.equal(stripV1Prefix("/v1/work-items/APOLLO-TASK-001/comments"), "/work-items/APOLLO-TASK-001/comments");
});
