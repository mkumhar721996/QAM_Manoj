import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";

async function login(baseUrl: string): Promise<{ access_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string };
}

function postCartItem(baseUrl: string, accessToken: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/cart/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

test("AC1: pizza customisation options expose sizes, crusts, and toppings", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/pizzas/pizza-margherita`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { sizes: unknown[]; crusts: unknown[]; toppings: unknown[] };
    assert.ok(Array.isArray(body.sizes) && body.sizes.length > 0);
    assert.ok(Array.isArray(body.crusts) && body.crusts.length > 0);
    assert.ok(Array.isArray(body.toppings) && body.toppings.length > 0);
  } finally {
    await server.close();
  }
});

test("AC1: adding to cart is rejected when size/crust is invalid or no toppings are selected", async () => {
  const server = await startTestServer();
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const base = { pizza_id: "pizza-margherita", crust: "crust-thin", toppings: ["topping-mushroom"], quantity: 1 };

    const badSize = await postCartItem(server.baseUrl, accessToken, { ...base, size: "size-xxl" });
    assert.equal(badSize.status, 400);

    const noToppings = await postCartItem(server.baseUrl, accessToken, { ...base, size: "size-medium", toppings: [] });
    assert.equal(noToppings.status, 400);

    const ok = await postCartItem(server.baseUrl, accessToken, { ...base, size: "size-medium" });
    assert.equal(ok.status, 201);
  } finally {
    await server.close();
  }
});

test("AC2: selected quantity is reflected in the cart item", async () => {
  const server = await startTestServer();
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const res = await postCartItem(server.baseUrl, accessToken, {
      pizza_id: "pizza-margherita",
      size: "size-medium",
      crust: "crust-thin",
      toppings: ["topping-mushroom"],
      quantity: 3,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { quantity: number };
    assert.equal(body.quantity, 3);
  } finally {
    await server.close();
  }
});

test("AC2: a non-positive or non-integer quantity is rejected", async () => {
  const server = await startTestServer();
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const res = await postCartItem(server.baseUrl, accessToken, {
      pizza_id: "pizza-margherita",
      size: "size-medium",
      crust: "crust-thin",
      toppings: ["topping-mushroom"],
      quantity: 0,
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC3: special instructions text is attached to the cart item", async () => {
  const server = await startTestServer();
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const res = await postCartItem(server.baseUrl, accessToken, {
      pizza_id: "pizza-margherita",
      size: "size-medium",
      crust: "crust-thin",
      toppings: ["topping-mushroom"],
      quantity: 1,
      special_instructions: "Extra crispy, no onions",
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { special_instructions: string };
    assert.equal(body.special_instructions, "Extra crispy, no onions");
  } finally {
    await server.close();
  }
});

test("AC4: the cart contains an entry reflecting exactly the chosen configuration", async () => {
  const server = await startTestServer();
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const config = {
      pizza_id: "pizza-margherita",
      size: "size-large",
      crust: "crust-stuffed",
      toppings: ["topping-olives", "topping-pepperoni"],
      quantity: 2,
      special_instructions: "Cut into squares",
    };
    const postRes = await postCartItem(server.baseUrl, accessToken, config);
    assert.equal(postRes.status, 201);

    const cartRes = await fetch(`${server.baseUrl}/cart`, { headers: { Authorization: `Bearer ${accessToken}` } });
    assert.equal(cartRes.status, 200);
    const cartBody = (await cartRes.json()) as { items: Array<Record<string, unknown>> };
    assert.equal(cartBody.items.length, 1);
    assert.deepEqual(cartBody.items[0], { id: cartBody.items[0].id, ...config });
  } finally {
    await server.close();
  }
});
