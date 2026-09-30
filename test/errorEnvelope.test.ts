import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { WorkItemRepository } from "../src/workitems/workItemRepository.ts";
import type { WorkItem } from "../src/workitems/workItemModel.ts";

function assertEnvelopeShape(body: Record<string, unknown>, expectedCode: string): void {
  assert.deepEqual(Object.keys(body).sort(), ["details", "error_code", "message"]);
  assert.equal(body.error_code, expectedCode);
  assert.equal(typeof body.message, "string");
  assert.equal(typeof body.details, "object");
}

class FaultyWorkItemRepository extends WorkItemRepository {
  findById(): WorkItem | undefined {
    throw new Error("db connection reset by peer at 10.0.4.12:5432");
  }
}

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/auth/login`, {
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

function getWorkItem(baseUrl: string, accessToken: string | undefined, workItemId: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/work-items/${workItemId}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

function deleteWorkItem(baseUrl: string, accessToken: string, workItemId: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/work-items/${workItemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function postCartItem(baseUrl: string, accessToken: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/v1/cart/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

test("AC1: invalid work item payload returns 400 VALIDATION_ERROR envelope", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "VALIDATION_ERROR");
  } finally {
    await server.close();
  }
});

test("AC1: invalid cart customisation returns 400 VALIDATION_ERROR envelope", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await postCartItem(server.baseUrl, token, {
      pizza_id: "pizza-margherita",
      size: "size-xxl",
      crust: "crust-thin",
      toppings: ["topping-mushroom"],
      quantity: 1,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "VALIDATION_ERROR");
  } finally {
    await server.close();
  }
});

test("AC2: fetching a non-existent work item returns 404 NOT_FOUND envelope", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await getWorkItem(server.baseUrl, token, "APOLLO-TASK-999");
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "NOT_FOUND");
  } finally {
    await server.close();
  }
});

test("AC2: fetching a non-existent pizza returns 404 NOT_FOUND envelope", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await fetch(`${server.baseUrl}/v1/pizzas/does-not-exist`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "NOT_FOUND");
  } finally {
    await server.close();
  }
});

test("AC3: unauthenticated request returns 401 UNAUTHORIZED envelope", async () => {
  const server = await startTestServer();
  try {
    const res = await getWorkItem(server.baseUrl, undefined, "APOLLO-TASK-001");
    assert.equal(res.status, 401);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "UNAUTHORIZED");
  } finally {
    await server.close();
  }
});

test("AC3: unauthorised request returns 403 FORBIDDEN envelope", async () => {
  const server = await startTestServer();
  try {
    const memberToken = await loginAs(server.baseUrl, "customer1");
    const outsiderToken = await loginAs(server.baseUrl, "provider1");
    const created = (await (
      await createWorkItem(server.baseUrl, memberToken, "project-apollo", { kind: "TASK", title: "Members only" })
    ).json()) as { id: string };

    const res = await getWorkItem(server.baseUrl, outsiderToken, created.id);
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "FORBIDDEN");
  } finally {
    await server.close();
  }
});

test("AC4/AC5: a server-side fault returns 500 INTERNAL_ERROR with no internal detail leaked", async () => {
  const workItemRepository = new FaultyWorkItemRepository();
  const server = await startTestServer({ workItemRepository });
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await getWorkItem(server.baseUrl, token, "APOLLO-TASK-001");
    assert.equal(res.status, 500);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "INTERNAL_ERROR");
    assert.equal(body.message, "An unexpected error occurred");
    assert.ok(!JSON.stringify(body).includes("10.0.4.12"));
    assert.equal(Object.hasOwn(body, "stack"), false);
  } finally {
    await server.close();
  }
});

test("AC6: 400/404/401/409 error envelopes all share the identical field shape", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");

    const badPayload = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "" });
    const notFound = await getWorkItem(server.baseUrl, token, "APOLLO-TASK-999");
    const unauthenticated = await getWorkItem(server.baseUrl, undefined, "APOLLO-TASK-001");

    const parent = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "STORY", title: "Parent" })
    ).json()) as { id: string };
    await createWorkItem(server.baseUrl, token, "project-apollo", {
      kind: "TASK",
      title: "Child",
      parent_id: parent.id,
    });
    const conflict = await deleteWorkItem(server.baseUrl, token, parent.id);

    assert.equal(badPayload.status, 400);
    assert.equal(notFound.status, 404);
    assert.equal(unauthenticated.status, 401);
    assert.equal(conflict.status, 409);

    const bodies = await Promise.all([badPayload, notFound, unauthenticated, conflict].map((res) => res.json()));
    const keySets = bodies.map((b) => JSON.stringify(Object.keys(b as Record<string, unknown>).sort()));
    assert.ok(keySets.every((k) => k === keySets[0]));
    assert.deepEqual(JSON.parse(keySets[0]), ["details", "error_code", "message"]);
  } finally {
    await server.close();
  }
});

test("AC7: sequence capacity exceeded returns 409 CONFLICT envelope", async () => {
  const workItemRepository = new WorkItemRepository([], new Map([["APOLLO-TASK", 999]]));
  const server = await startTestServer({ workItemRepository });
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "One too many" });
    assert.equal(res.status, 409);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "CONFLICT");
  } finally {
    await server.close();
  }
});

test("AC7: deleting a work item with a blocking dependent returns 409 CONFLICT envelope", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const parent = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "STORY", title: "Parent" })
    ).json()) as { id: string };
    const child = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", {
        kind: "TASK",
        title: "Child",
        parent_id: parent.id,
      })
    ).json()) as { id: string };

    const res = await deleteWorkItem(server.baseUrl, token, parent.id);
    assert.equal(res.status, 409);
    const body = (await res.json()) as Record<string, unknown>;
    assertEnvelopeShape(body, "CONFLICT");
    assert.ok((body.details as { blocking_ids: string[] }).blocking_ids.includes(child.id));
  } finally {
    await server.close();
  }
});
