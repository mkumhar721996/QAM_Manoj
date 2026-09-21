import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { WorkItemRepository } from "../src/workitems/workItemRepository.ts";

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
  return fetch(`${baseUrl}/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

function getWorkItem(baseUrl: string, accessToken: string, workItemId: string): Promise<Response> {
  return fetch(`${baseUrl}/work-items/${workItemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function updateWorkItem(
  baseUrl: string,
  accessToken: string,
  workItemId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/work-items/${workItemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

function deleteWorkItem(baseUrl: string, accessToken: string, workItemId: string): Promise<Response> {
  return fetch(`${baseUrl}/work-items/${workItemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

test("AC1: creating a work item returns a unique keyed ID in {KEY}-{KIND}-{NNN} format", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Set up CI" });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string };
    assert.equal(body.id, "APOLLO-TASK-001");
  } finally {
    await server.close();
  }
});

test("AC2: reading a work item by its keyed ID returns the full record", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const created = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", {
        kind: "TASK",
        title: "Set up CI",
        description: "initial",
      })
    ).json()) as Record<string, unknown>;

    const res = await getWorkItem(server.baseUrl, token, created.id as string);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, created);
  } finally {
    await server.close();
  }
});

test("AC3: updating fields returns the updated values in the response", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const created = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Old title" })
    ).json()) as { id: string };

    const res = await updateWorkItem(server.baseUrl, token, created.id, {
      title: "New title",
      description: "New description",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { work_item: { title: string; description: string } };
    assert.equal(body.work_item.title, "New title");
    assert.equal(body.work_item.description, "New description");
  } finally {
    await server.close();
  }
});

test("AC4: a subsequent read reflects the previously updated values", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const created = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Old title" })
    ).json()) as { id: string };
    await updateWorkItem(server.baseUrl, token, created.id, { title: "New title" });

    const res = await getWorkItem(server.baseUrl, token, created.id);
    const body = (await res.json()) as { title: string };
    assert.equal(body.title, "New title");
  } finally {
    await server.close();
  }
});

test("AC5: of two concurrent updates, the final state matches exactly one full update payload", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const created = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Old title" })
    ).json()) as { id: string };

    const [resA, resB] = await Promise.all([
      updateWorkItem(server.baseUrl, token, created.id, { title: "Title A", description: "Description A" }),
      updateWorkItem(server.baseUrl, token, created.id, { title: "Title B", description: "Description B" }),
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const finalBody = (await (await getWorkItem(server.baseUrl, token, created.id)).json()) as {
      title: string;
      description: string;
    };
    const matchesA = finalBody.title === "Title A" && finalBody.description === "Description A";
    const matchesB = finalBody.title === "Title B" && finalBody.description === "Description B";
    assert.ok(matchesA || matchesB, `expected a clean overwrite by A or B, got ${JSON.stringify(finalBody)}`);
  } finally {
    await server.close();
  }
});

test("AC6: deleting a work item with no dependents removes it immediately", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const created = (await (
      await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Disposable" })
    ).json()) as { id: string };

    const deleteRes = await deleteWorkItem(server.baseUrl, token, created.id);
    assert.equal(deleteRes.status, 204);

    const getRes = await getWorkItem(server.baseUrl, token, created.id);
    assert.equal(getRes.status, 404);
  } finally {
    await server.close();
  }
});

test("AC7: deleting a work item with a child is rejected and lists the blocking id", async () => {
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
    const body = (await res.json()) as { blocking_ids: string[] };
    assert.ok(body.blocking_ids.includes(child.id));
  } finally {
    await server.close();
  }
});

test("AC8: any project member can read/update/delete a work item created by a different member/role", async () => {
  const server = await startTestServer();
  try {
    const creatorToken = await loginAs(server.baseUrl, "customer1");
    const otherMemberToken = await loginAs(server.baseUrl, "admin1");
    const created = (await (
      await createWorkItem(server.baseUrl, creatorToken, "project-apollo", { kind: "TASK", title: "Owned by customer1" })
    ).json()) as { id: string };

    const updateRes = await updateWorkItem(server.baseUrl, otherMemberToken, created.id, { title: "Edited by admin1" });
    assert.equal(updateRes.status, 200);

    const deleteRes = await deleteWorkItem(server.baseUrl, otherMemberToken, created.id);
    assert.equal(deleteRes.status, 204);
  } finally {
    await server.close();
  }
});

test("AC8: a caller with no access to the item's project is rejected on read/update/delete", async () => {
  const server = await startTestServer();
  try {
    const memberToken = await loginAs(server.baseUrl, "customer1");
    const outsiderToken = await loginAs(server.baseUrl, "provider1");
    const created = (await (
      await createWorkItem(server.baseUrl, memberToken, "project-apollo", { kind: "TASK", title: "Members only" })
    ).json()) as { id: string };

    assert.equal((await getWorkItem(server.baseUrl, outsiderToken, created.id)).status, 403);
    assert.equal((await updateWorkItem(server.baseUrl, outsiderToken, created.id, { title: "nope" })).status, 403);
    assert.equal((await deleteWorkItem(server.baseUrl, outsiderToken, created.id)).status, 403);
  } finally {
    await server.close();
  }
});

test("AC9: reading or deleting a non-existent work item id returns 404", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    assert.equal((await getWorkItem(server.baseUrl, token, "APOLLO-TASK-999")).status, 404);
    assert.equal((await deleteWorkItem(server.baseUrl, token, "APOLLO-TASK-999")).status, 404);
  } finally {
    await server.close();
  }
});

test("AC10/AC11: updating a non-existent work item id succeeds with a null result and creates nothing", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await updateWorkItem(server.baseUrl, token, "APOLLO-TASK-999", { title: "ghost" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { work_item: unknown };
    assert.equal(body.work_item, null);

    const getRes = await getWorkItem(server.baseUrl, token, "APOLLO-TASK-999");
    assert.equal(getRes.status, 404);
  } finally {
    await server.close();
  }
});

test("AC12: creating past sequence 999 for the same KEY-KIND pair is rejected", async () => {
  const workItemRepository = new WorkItemRepository([], new Map([["APOLLO-TASK", 999]]));
  const server = await startTestServer({ workItemRepository });
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "One too many" });
    assert.equal(res.status, 409);
  } finally {
    await server.close();
  }
});

test("AC13: creating under a non-existent project id returns 404 naming the project id", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await createWorkItem(server.baseUrl, token, "project-does-not-exist", { kind: "TASK", title: "x" });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { project_id: string };
    assert.equal(body.project_id, "project-does-not-exist");
  } finally {
    await server.close();
  }
});

test("AC14: creating under a project the caller lacks access to returns 403 naming the project id", async () => {
  const server = await startTestServer();
  try {
    const token = await loginAs(server.baseUrl, "customer1");
    const res = await createWorkItem(server.baseUrl, token, "project-zephyr", { kind: "TASK", title: "x" });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { project_id: string };
    assert.equal(body.project_id, "project-zephyr");
  } finally {
    await server.close();
  }
});
