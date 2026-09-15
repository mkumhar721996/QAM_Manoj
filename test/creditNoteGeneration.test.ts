import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";

function postRefund(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postDisbursement(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/cancellations/disbursements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("AC1: a processed refund generates a credit note referencing the original invoice, refund amount, and transaction date", async () => {
  const server = await startTestServer();
  try {
    const res = await postRefund(server.baseUrl, {
      invoice_number: "INV-1001",
      transaction_id: "txn-500",
      refund_amount: 45.0,
      transaction_date: "2026-09-10T12:00:00.000Z",
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.invoice_number, "INV-1001");
    assert.equal(body.refund_amount, 45.0);
    assert.equal(body.transaction_date, "2026-09-10T12:00:00.000Z");
    assert.ok(typeof body.id === "string" && body.id.length > 0);
  } finally {
    await server.close();
  }
});

test("AC1: a full refund (refund_amount equal to the invoice amount) is accepted just like a partial refund", async () => {
  const server = await startTestServer();
  try {
    const res = await postRefund(server.baseUrl, {
      invoice_number: "INV-1001",
      transaction_id: "txn-full-1",
      refund_amount: 120.0,
      transaction_date: "2026-09-10T12:00:00.000Z",
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.refund_amount, 120.0);
  } finally {
    await server.close();
  }
});

test("AC1: a refund referencing a non-existent invoice is rejected", async () => {
  const server = await startTestServer();
  try {
    const res = await postRefund(server.baseUrl, {
      invoice_number: "INV-DOES-NOT-EXIST",
      transaction_id: "txn-501",
      refund_amount: 10,
      transaction_date: "2026-09-10T12:00:00.000Z",
    });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("AC2: a partial-cancellation disbursement generates a disbursement record referencing the cancellation event", async () => {
  const server = await startTestServer();
  try {
    const res = await postDisbursement(server.baseUrl, {
      cancellation_event_id: "cancel-77",
      invoice_number: "INV-1002",
      provider_id: "provider-2",
      amount: 20.5,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.cancellation_event_id, "cancel-77");
    assert.equal(body.provider_id, "provider-2");
    assert.equal(body.amount, 20.5);
    assert.ok(typeof body.id === "string" && body.id.length > 0);
  } finally {
    await server.close();
  }
});

test("AC2: a disbursement referencing a non-existent invoice is rejected", async () => {
  const server = await startTestServer();
  try {
    const res = await postDisbursement(server.baseUrl, {
      cancellation_event_id: "cancel-78",
      invoice_number: "INV-DOES-NOT-EXIST",
      provider_id: "provider-2",
      amount: 5,
    });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("AC3: a generated credit note is stored and retrievable by id", async () => {
  const server = await startTestServer();
  try {
    const createRes = await postRefund(server.baseUrl, {
      invoice_number: "INV-1001",
      transaction_id: "txn-502",
      refund_amount: 15,
      transaction_date: "2026-09-11T09:00:00.000Z",
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${server.baseUrl}/credit-notes/${created.id}`);
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.deepEqual(fetched, created);
  } finally {
    await server.close();
  }
});

test("AC3: retrieving a credit note that doesn't exist returns 404", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/credit-notes/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("AC4: the stored credit note is associated with the originating transaction and original invoice", async () => {
  const server = await startTestServer();
  try {
    const createRes = await postRefund(server.baseUrl, {
      invoice_number: "INV-1002",
      transaction_id: "txn-503",
      refund_amount: 30,
      transaction_date: "2026-09-12T08:00:00.000Z",
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${server.baseUrl}/credit-notes/${created.id}`);
    const fetched = (await getRes.json()) as { invoice_number: string; transaction_id: string };
    assert.equal(fetched.invoice_number, "INV-1002");
    assert.equal(fetched.transaction_id, "txn-503");
  } finally {
    await server.close();
  }
});

test("AC5: a refund request missing invoice_number is rejected with 400", async () => {
  const server = await startTestServer();
  try {
    const res = await postRefund(server.baseUrl, {
      transaction_id: "txn-600",
      refund_amount: 10,
      transaction_date: "2026-09-10T12:00:00.000Z",
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC5: a refund request with a non-positive refund_amount is rejected with 400", async () => {
  const server = await startTestServer();
  try {
    const res = await postRefund(server.baseUrl, {
      invoice_number: "INV-1001",
      transaction_id: "txn-601",
      refund_amount: 0,
      transaction_date: "2026-09-10T12:00:00.000Z",
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC6: a disbursement request missing provider_id is rejected with 400", async () => {
  const server = await startTestServer();
  try {
    const res = await postDisbursement(server.baseUrl, {
      cancellation_event_id: "cancel-79",
      invoice_number: "INV-1002",
      amount: 5,
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC6: a disbursement request with a non-positive amount is rejected with 400", async () => {
  const server = await startTestServer();
  try {
    const res = await postDisbursement(server.baseUrl, {
      cancellation_event_id: "cancel-80",
      invoice_number: "INV-1002",
      provider_id: "provider-2",
      amount: -5,
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("AC7: a generated disbursement record is stored and retrievable by id", async () => {
  const server = await startTestServer();
  try {
    const createRes = await postDisbursement(server.baseUrl, {
      cancellation_event_id: "cancel-81",
      invoice_number: "INV-1002",
      provider_id: "provider-2",
      amount: 12.25,
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${server.baseUrl}/disbursement-records/${created.id}`);
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.deepEqual(fetched, created);
  } finally {
    await server.close();
  }
});

test("AC7: retrieving a disbursement record that doesn't exist returns 404", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/disbursement-records/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("AC8: the stored disbursement record is associated with the originating cancellation event and original invoice", async () => {
  const server = await startTestServer();
  try {
    const createRes = await postDisbursement(server.baseUrl, {
      cancellation_event_id: "cancel-82",
      invoice_number: "INV-1001",
      provider_id: "provider-1",
      amount: 8,
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${server.baseUrl}/disbursement-records/${created.id}`);
    const fetched = (await getRes.json()) as { invoice_number: string; cancellation_event_id: string };
    assert.equal(fetched.invoice_number, "INV-1001");
    assert.equal(fetched.cancellation_event_id, "cancel-82");
  } finally {
    await server.close();
  }
});

test("AC9: two refunds against different invoices produce two distinct, independently retrievable credit notes", async () => {
  const server = await startTestServer();
  try {
    const first = (await (
      await postRefund(server.baseUrl, {
        invoice_number: "INV-1001",
        transaction_id: "txn-700",
        refund_amount: 5,
        transaction_date: "2026-09-13T00:00:00.000Z",
      })
    ).json()) as { id: string };
    const second = (await (
      await postRefund(server.baseUrl, {
        invoice_number: "INV-1002",
        transaction_id: "txn-701",
        refund_amount: 6,
        transaction_date: "2026-09-13T01:00:00.000Z",
      })
    ).json()) as { id: string };

    assert.notEqual(first.id, second.id);

    const firstFetched = (await (await fetch(`${server.baseUrl}/credit-notes/${first.id}`)).json()) as {
      invoice_number: string;
    };
    const secondFetched = (await (await fetch(`${server.baseUrl}/credit-notes/${second.id}`)).json()) as {
      invoice_number: string;
    };
    assert.equal(firstFetched.invoice_number, "INV-1001");
    assert.equal(secondFetched.invoice_number, "INV-1002");
  } finally {
    await server.close();
  }
});

test("AC10: posting a non-object JSON body to /refunds is rejected with 400, not a server error", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/refunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"]),
    });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});
