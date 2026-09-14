import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";

async function login(baseUrl: string, username: string): Promise<{ access_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string };
}

test("AC1: admin configures a financial outcome and it is applied to a subsequent no-show detection", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    const putRes = await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 25, currency: "USD" }),
    });
    assert.equal(putRes.status, 200);

    const resolveRes = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
    const body = (await resolveRes.json()) as { outcome: string; feeAmount: number; currency: string };
    assert.equal(body.outcome, "charge_fee");
    assert.equal(body.feeAmount, 25);
    assert.equal(body.currency, "USD");
  } finally {
    await server.close();
  }
});

test("AC2: an updated policy governs the next no-show detection", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };

    await fetch(`${server.baseUrl}/no-show-policy`, { method: "PUT", headers, body: JSON.stringify({ outcome: "no_charge" }) });
    await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 40, currency: "EUR" }),
    });

    const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
    const body = (await res.json()) as { outcome: string; feeAmount: number; currency: string };
    assert.equal(body.outcome, "charge_fee");
    assert.equal(body.feeAmount, 40);
    assert.equal(body.currency, "EUR");
  } finally {
    await server.close();
  }
});

test("AC3: with no policy configured, a detected no-show defaults to no charge", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { outcome: string; configured: boolean };
    assert.equal(body.outcome, "no_charge");
    assert.equal(body.configured, false);
  } finally {
    await server.close();
  }
});

test("AC4: absence of a configured policy is surfaced to administrators", async () => {
  const server = await startTestServer();
  const warnSpy = mock.method(console, "warn");
  try {
    const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { outcome: string; configured: boolean };
    assert.equal(body.outcome, "no_charge");
    assert.equal(body.configured, false);

    const warned = warnSpy.mock.calls.some((call) => /no configured no-show policy/.test(String(call.arguments[0])));
    assert.equal(warned, true);
  } finally {
    warnSpy.mock.restore();
    await server.close();
  }
});

test("AC4: GET /no-show-policy also reports the absence of a configured policy to administrators", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    const res = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { configured: boolean; outcome: string };
    assert.equal(body.configured, false);
    assert.equal(body.outcome, "no_charge");
  } finally {
    await server.close();
  }
});

test("AC5: a saved policy update governs the next detection without a restart", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 10, currency: "GBP" }),
    });

    const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
    const body = (await res.json()) as { outcome: string; feeAmount: number; currency: string };
    assert.equal(body.outcome, "charge_fee");
    assert.equal(body.feeAmount, 10);
    assert.equal(body.currency, "GBP");
  } finally {
    await server.close();
  }
});

test("AC6: a valid fee amount and supported currency are saved", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    const putRes = await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 15.5, currency: "EUR" }),
    });
    assert.equal(putRes.status, 200);

    const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = (await getRes.json()) as { feeAmount: number; currency: string };
    assert.equal(body.feeAmount, 15.5);
    assert.equal(body.currency, "EUR");
  } finally {
    await server.close();
  }
});

test("AC7: a non-positive fee amount or unsupported currency is rejected without saving", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };
    await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 20, currency: "USD" }),
    });

    const zeroFeeRes = await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 0, currency: "USD" }),
    });
    assert.equal(zeroFeeRes.status, 400);

    const badCurrencyRes = await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 20, currency: "ZZZ" }),
    });
    assert.equal(badCurrencyRes.status, 400);

    const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = (await getRes.json()) as { feeAmount: number; currency: string };
    assert.equal(body.feeAmount, 20);
    assert.equal(body.currency, "USD");
  } finally {
    await server.close();
  }
});

test("AC8: a non-administrator is denied access to the no-show policy settings", async () => {
  const server = await startTestServer();
  try {
    const { access_token: customerToken } = await login(server.baseUrl, "customer1");

    const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${customerToken}` } });
    assert.equal(getRes.status, 403);

    const putRes = await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 5, currency: "USD" }),
    });
    assert.equal(putRes.status, 403);
  } finally {
    await server.close();
  }
});

test("AC9: a denied modification attempt leaves the current policy unchanged", async () => {
  const server = await startTestServer();
  try {
    const { access_token: adminToken } = await login(server.baseUrl, "admin1");
    await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ outcome: "no_charge" }),
    });

    const { access_token: providerToken } = await login(server.baseUrl, "provider1");
    await fetch(`${server.baseUrl}/no-show-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ outcome: "charge_fee", feeAmount: 99, currency: "USD" }),
    });

    const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = (await getRes.json()) as { outcome: string };
    assert.equal(body.outcome, "no_charge");
  } finally {
    await server.close();
  }
});
