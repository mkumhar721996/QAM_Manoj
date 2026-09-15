import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD, testUsers } from "../src/users/fixtures/testUsers.ts";
import { UserRepository } from "../src/users/userRepository.ts";
import { hashPassword } from "../src/auth/passwordHasher.ts";
import { RecordingEmailService } from "./testEmailService.ts";

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function postPaymentCapture(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/internal/payment-captures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postDisbursement(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/internal/disbursements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("AC1: a successful payment capture generates a customer invoice with the required fields", async () => {
  const server = await startTestServer();
  try {
    const res = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-1",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "1x Margherita (Large)", amount: 18 }],
      service_fee: 2,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.match(body.invoice_number as string, /^INV-\d{5}$/);
    assert.equal(typeof body.transaction_date, "number");
    assert.equal(body.customer_name, "customer1");
    assert.equal(body.provider_name, "provider1");
    assert.deepEqual(body.line_items, [{ description: "1x Margherita (Large)", amount: 18 }]);
    assert.equal(body.service_fee, 2);
    assert.equal(body.total, 20);
  } finally {
    await server.close();
  }
});

test("AC1 edge case: a payment capture with no line items is rejected", async () => {
  const server = await startTestServer();
  try {
    const res = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-1b",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [],
      service_fee: 2,
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC1 edge case: a payment capture with a non-positive line item amount is rejected", async () => {
  const server = await startTestServer();
  try {
    const res = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-1c",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "refund adjustment", amount: -5 }],
      service_fee: 2,
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC2: a successful disbursement generates a provider disbursement record", async () => {
  const server = await startTestServer();
  try {
    const res = await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-1",
      provider_id: "user-provider-1",
      gross_amount: 18,
      service_fee: 2,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.match(body.invoice_number as string, /^INV-\d{5}$/);
    assert.equal(typeof body.transaction_date, "number");
    assert.equal(body.gross_amount, 18);
    assert.equal(body.service_fee, 2);
    assert.equal(body.net_amount, 16);
  } finally {
    await server.close();
  }
});

test("AC2 edge case: a service fee exceeding the gross amount is rejected", async () => {
  const server = await startTestServer();
  try {
    const res = await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-1b",
      provider_id: "user-provider-1",
      gross_amount: 10,
      service_fee: 15,
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC3: no tax rate configured means the invoice has no tax line", async () => {
  const server = await startTestServer();
  try {
    const res = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-2",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "item", amount: 10 }],
      service_fee: 1,
    });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("tax_amount" in body, false);
    assert.equal("tax_rate_percent" in body, false);
  } finally {
    await server.close();
  }
});

test("AC3 edge case: clearing a previously-configured tax rate removes the tax line again", async () => {
  const server = await startTestServer();
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ rate_percent: 10 }),
    });
    await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ rate_percent: null }),
    });
    const res = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-2b",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "item", amount: 10 }],
      service_fee: 1,
    });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("tax_amount" in body, false);
  } finally {
    await server.close();
  }
});

test("AC4: a configured tax rate is applied to invoice and disbursement tax lines", async () => {
  const server = await startTestServer();
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    const settingsRes = await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ rate_percent: 10 }),
    });
    assert.equal(settingsRes.status, 204);

    const invoiceRes = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-3",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "item", amount: 10 }],
      service_fee: 2,
    });
    const invoiceBody = (await invoiceRes.json()) as Record<string, unknown>;
    assert.equal(invoiceBody.tax_rate_percent, 10);
    assert.equal(invoiceBody.tax_amount, 0.2);
    assert.equal(invoiceBody.total, 12.2);

    const disbursementRes = await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-2",
      provider_id: "user-provider-1",
      gross_amount: 10,
      service_fee: 2,
    });
    const disbursementBody = (await disbursementRes.json()) as Record<string, unknown>;
    assert.equal(disbursementBody.tax_rate_percent, 10);
    assert.equal(disbursementBody.tax_amount, 0.2);
    assert.equal(disbursementBody.net_amount, 7.8);
  } finally {
    await server.close();
  }
});

test("AC4 edge case: setting an invalid tax rate is rejected", async () => {
  const server = await startTestServer();
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    const negative = await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ rate_percent: -5 }),
    });
    assert.equal(negative.status, 400);
  } finally {
    await server.close();
  }
});

test("AC4 edge case: a non-admin cannot set the tax rate", async () => {
  const server = await startTestServer();
  try {
    const customerToken = await loginAs(server.baseUrl, "customer1");
    const res = await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ rate_percent: 10 }),
    });
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test("AC5: invoice numbers are unique and strictly sequential", async () => {
  const server = await startTestServer();
  try {
    const first = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-4",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    const second = await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-3",
      provider_id: "user-provider-1",
      gross_amount: 5,
      service_fee: 1,
    });
    const third = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-5",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    const numbers = await Promise.all(
      [first, second, third].map(async (r) => ((await r.json()) as { invoice_number: string }).invoice_number),
    );
    const sequenceNumbers = numbers.map((n) => Number(n.replace("INV-", "")));
    assert.deepEqual(sequenceNumbers, [sequenceNumbers[0], sequenceNumbers[0] + 1, sequenceNumbers[0] + 2]);
    assert.equal(new Set(numbers).size, 3);
  } finally {
    await server.close();
  }
});

test("AC5 edge case: a rejected event does not create a gap in the sequence", async () => {
  const server = await startTestServer();
  try {
    const okRes = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-5a",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    const okNumber = Number(((await okRes.json()) as { invoice_number: string }).invoice_number.replace("INV-", ""));

    const rejected = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-5b",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [],
      service_fee: 1,
    });
    assert.equal(rejected.status, 400);

    const nextRes = await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-5c",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    const nextNumber = Number(
      ((await nextRes.json()) as { invoice_number: string }).invoice_number.replace("INV-", ""),
    );
    assert.equal(nextNumber, okNumber + 1);
  } finally {
    await server.close();
  }
});

test("AC6: a generated invoice is retrievable by its originating payment capture id", async () => {
  const server = await startTestServer();
  try {
    const customerToken = await loginAs(server.baseUrl, "customer1");
    await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-6",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    const listRes = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${customerToken}` } });
    const listBody = (await listRes.json()) as { invoices: Array<Record<string, unknown>> };
    assert.ok(listBody.invoices.some((inv) => inv.payment_capture_id === "pc-6"));
  } finally {
    await server.close();
  }
});

test("AC6: a generated disbursement record is retrievable by its originating disbursement id", async () => {
  const server = await startTestServer();
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-6",
      provider_id: "user-provider-1",
      gross_amount: 5,
      service_fee: 1,
    });
    const listRes = await fetch(`${server.baseUrl}/disbursements`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const listBody = (await listRes.json()) as { disbursements: Array<Record<string, unknown>> };
    assert.ok(listBody.disbursements.some((d) => d.disbursement_id === "ds-6"));
  } finally {
    await server.close();
  }
});

test("AC7: reprocessing the same payment capture event does not create a duplicate invoice or email", async () => {
  const emailService = new RecordingEmailService();
  const server = await startTestServer({ emailService });
  try {
    const customerToken = await loginAs(server.baseUrl, "customer1");
    const event = {
      payment_capture_id: "pc-7",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    };
    const first = await postPaymentCapture(server.baseUrl, event);
    const second = await postPaymentCapture(server.baseUrl, event);
    assert.equal(
      ((await first.json()) as { invoice_number: string }).invoice_number,
      ((await second.json()) as { invoice_number: string }).invoice_number,
    );

    const listRes = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${customerToken}` } });
    const listBody = (await listRes.json()) as { invoices: Array<Record<string, unknown>> };
    assert.equal(listBody.invoices.filter((inv) => inv.payment_capture_id === "pc-7").length, 1);
    assert.equal(emailService.sentMessages.length, 1);
  } finally {
    await server.close();
  }
});

test("AC7 edge case: two different disbursement events for the same provider are both recorded", async () => {
  const server = await startTestServer();
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-7a",
      provider_id: "user-provider-1",
      gross_amount: 5,
      service_fee: 1,
    });
    await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-7b",
      provider_id: "user-provider-1",
      gross_amount: 5,
      service_fee: 1,
    });
    const listRes = await fetch(`${server.baseUrl}/disbursements`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const listBody = (await listRes.json()) as { disbursements: Array<Record<string, unknown>> };
    assert.equal(
      listBody.disbursements.filter((d) => d.disbursement_id === "ds-7a" || d.disbursement_id === "ds-7b").length,
      2,
    );
  } finally {
    await server.close();
  }
});

test("AC8: generating an invoice sends an email notification to the customer", async () => {
  const emailService = new RecordingEmailService();
  const server = await startTestServer({ emailService });
  try {
    await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-8",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    assert.equal(emailService.sentMessages.length, 1);
    assert.equal(emailService.sentMessages[0].to, "customer1");
    assert.match(emailService.sentMessages[0].body, /INV-\d{5}/);
  } finally {
    await server.close();
  }
});

test("AC8: generating a disbursement record sends an email notification to the provider", async () => {
  const emailService = new RecordingEmailService();
  const server = await startTestServer({ emailService });
  try {
    await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-8",
      provider_id: "user-provider-1",
      gross_amount: 5,
      service_fee: 1,
    });
    assert.equal(emailService.sentMessages.length, 1);
    assert.equal(emailService.sentMessages[0].to, "provider1");
    assert.match(emailService.sentMessages[0].body, /INV-\d{5}/);
  } finally {
    await server.close();
  }
});

test("AC9: a provider can retrieve their disbursement records from the portal", async () => {
  const server = await startTestServer();
  try {
    await postDisbursement(server.baseUrl, {
      disbursement_id: "ds-9",
      provider_id: "user-provider-1",
      gross_amount: 5,
      service_fee: 1,
    });
    const providerToken = await loginAs(server.baseUrl, "provider1");
    const res = await fetch(`${server.baseUrl}/disbursements`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { disbursements: Array<Record<string, unknown>> };
    assert.ok(body.disbursements.some((d) => d.disbursement_id === "ds-9"));
  } finally {
    await server.close();
  }
});

test("AC9 edge case: unauthenticated and wrong-role requests to the portal are rejected", async () => {
  const server = await startTestServer();
  try {
    const unauthenticated = await fetch(`${server.baseUrl}/invoices`);
    assert.equal(unauthenticated.status, 401);

    const providerToken = await loginAs(server.baseUrl, "provider1");
    const wrongRole = await fetch(`${server.baseUrl}/invoices`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(wrongRole.status, 403);
  } finally {
    await server.close();
  }
});

test("AC9 edge case: a customer cannot see another customer's invoices", async () => {
  const secondCustomer = {
    id: "user-customer-2",
    username: "customer2",
    role: "customer" as const,
    passwordHash: await hashPassword(TEST_PASSWORD),
  };
  const userRepository = new UserRepository([...testUsers, secondCustomer]);
  const server = await startTestServer({ userRepository });
  try {
    await postPaymentCapture(server.baseUrl, {
      payment_capture_id: "pc-9",
      customer_id: "user-customer-1",
      provider_id: "user-provider-1",
      line_items: [{ description: "i", amount: 5 }],
      service_fee: 1,
    });
    const otherCustomerToken = await loginAs(server.baseUrl, "customer2");
    const res = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${otherCustomerToken}` } });
    const body = (await res.json()) as { invoices: Array<Record<string, unknown>> };
    assert.equal(body.invoices.length, 0);
  } finally {
    await server.close();
  }
});
