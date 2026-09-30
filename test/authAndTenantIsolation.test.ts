import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { issueAccessToken } from "../src/auth/tokenService.ts";

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

function getWorkItem(baseUrl: string, accessToken: string, workItemId: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/work-items/${workItemId}`, {
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

test("AC1: missing Authorization header returns 401 UNAUTHORIZED on any /v1/ endpoint", async () => {
  const server = await startTestServer();
  try {
    for (const path of ["/v1/auth/session", "/v1/pizzas/pizza-margherita"]) {
      const res = await fetch(`${server.baseUrl}${path}`);
      assert.equal(res.status, 401);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, "UNAUTHORIZED");
      assert.ok(body.error.message.length > 0);
    }
  } finally {
    await server.close();
  }
});

test("AC2: malformed or expired bearer token returns 401 UNAUTHORIZED", async () => {
  const server = await startTestServer();
  try {
    const malformedRes = await fetch(`${server.baseUrl}/v1/auth/session`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    assert.equal(malformedRes.status, 401);
    assert.equal(((await malformedRes.json()) as { error: { code: string } }).error.code, "UNAUTHORIZED");

    const expiredToken = issueAccessToken(
      { userId: "user-customer-1", role: "customer", tenantId: "tenant-1" },
      Date.now() - 16 * 60 * 1000,
    );
    const expiredRes = await fetch(`${server.baseUrl}/v1/auth/session`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredRes.status, 401);
    assert.equal(((await expiredRes.json()) as { error: { code: string } }).error.code, "UNAUTHORIZED");
  } finally {
    await server.close();
  }
});

test("AC3: tenant A token requesting a tenant B work item gets a 4xx response", async () => {
  const server = await startTestServer();
  try {
    const tenantBToken = await loginAs(server.baseUrl, "provider1");
    const created = (await (
      await createWorkItem(server.baseUrl, tenantBToken, "project-zephyr", { kind: "TASK", title: "Zephyr Secret Plan" })
    ).json()) as { id: string };

    const tenantAToken = await loginAs(server.baseUrl, "customer1");
    const res = await getWorkItem(server.baseUrl, tenantAToken, created.id);
    assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
  } finally {
    await server.close();
  }
});

test("AC4: the 4xx response body never contains tenant B's resource data", async () => {
  const server = await startTestServer();
  try {
    const tenantBToken = await loginAs(server.baseUrl, "provider1");
    const created = (await (
      await createWorkItem(server.baseUrl, tenantBToken, "project-zephyr", { kind: "TASK", title: "Zephyr Secret Plan" })
    ).json()) as { id: string };

    const tenantAToken = await loginAs(server.baseUrl, "customer1");
    const res = await getWorkItem(server.baseUrl, tenantAToken, created.id);
    const bodyText = await res.text();
    assert.ok(!bodyText.includes("Zephyr Secret Plan"));
    assert.ok(!bodyText.includes(created.id));
  } finally {
    await server.close();
  }
});

test("AC5: GET /v1/cart for tenant A never returns tenant B's cart items", async () => {
  const server = await startTestServer();
  try {
    const tenantBToken = await loginAs(server.baseUrl, "provider1");
    await postCartItem(server.baseUrl, tenantBToken, {
      pizza_id: "pizza-margherita",
      size: "size-medium",
      crust: "crust-thin",
      toppings: ["topping-mushroom"],
      quantity: 1,
    });

    const tenantAToken = await loginAs(server.baseUrl, "customer1");
    await postCartItem(server.baseUrl, tenantAToken, {
      pizza_id: "pizza-margherita",
      size: "size-large",
      crust: "crust-thick",
      toppings: ["topping-olives"],
      quantity: 2,
    });

    const cartRes = await fetch(`${server.baseUrl}/v1/cart`, { headers: { Authorization: `Bearer ${tenantAToken}` } });
    const cartBody = (await cartRes.json()) as { items: Array<{ size: string }> };
    assert.equal(cartBody.items.length, 1);
    assert.equal(cartBody.items[0].size, "size-large");
  } finally {
    await server.close();
  }
});

test("AC6: a role without permission for an operation gets 403 FORBIDDEN", async () => {
  const server = await startTestServer();
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    const res = await postCartItem(server.baseUrl, adminToken, {
      pizza_id: "pizza-margherita",
      size: "size-medium",
      crust: "crust-thin",
      toppings: ["topping-mushroom"],
      quantity: 1,
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "FORBIDDEN");
    assert.ok(body.error.message.length > 0);
  } finally {
    await server.close();
  }
});
