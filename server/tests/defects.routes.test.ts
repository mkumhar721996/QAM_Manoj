import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/app.ts";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const validPayload = {
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High",
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging",
};

test("POST /api/defects rejects unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/defects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    assert.equal(response.status, 401);
  });
});

test("POST /api/defects with all mandatory fields missing returns 400 with an error per field and creates nothing", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/defects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "jane.doe" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    for (const field of [
      "title",
      "description",
      "severity",
      "reporter",
      "stepsToReproduce",
      "environment",
    ]) {
      assert.ok(body.errors[field], `expected an error for missing field "${field}"`);
    }
  });
});

test("POST /api/defects with a severity or environment outside the predefined list returns 400", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/defects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "jane.doe" },
      body: JSON.stringify({ ...validPayload, severity: "Extreme", environment: "Local" }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.errors.severity);
    assert.ok(body.errors.environment);
  });
});

test("POST /api/defects with all mandatory fields creates a defect with status Open and echoes submitted values", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/defects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "jane.doe" },
      body: JSON.stringify(validPayload),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.status, "Open");
    assert.ok(body.id);
    for (const [key, value] of Object.entries(validPayload)) {
      assert.equal(body[key], value);
    }
  });
});

test("GET /api/defects/options returns exactly the predefined severity and environment values", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/defects/options`, {
      headers: { "x-user-id": "jane.doe" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.severity, ["Low", "Medium", "High", "Critical"]);
    assert.deepEqual(body.environment, ["Staging", "Production", "QA", "Dev"]);
  });
});

test("GET /api/defects/:id lets any authenticated user view all submitted fields and the Open status", async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/defects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "jane.doe" },
      body: JSON.stringify(validPayload),
    });
    const created = await createResponse.json();

    const viewResponse = await fetch(`${baseUrl}/api/defects/${created.id}`, {
      headers: { "x-user-id": "someone.else" },
    });
    assert.equal(viewResponse.status, 200);
    const viewed = await viewResponse.json();
    assert.equal(viewed.status, "Open");
    for (const [key, value] of Object.entries(validPayload)) {
      assert.equal(viewed[key], value);
    }
  });
});

test("GET /api/defects/:id returns 404 for an unknown id", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/defects/does-not-exist`, {
      headers: { "x-user-id": "jane.doe" },
    });
    assert.equal(response.status, 404);
  });
});
