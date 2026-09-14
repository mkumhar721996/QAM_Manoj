import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";

async function login(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

test("AC1: an approved provider can view their own profile", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const res = await fetch(`${server.baseUrl}/providers/user-provider-1/profile`, {
      headers: authHeader(token),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.business_name, "Provider One Services");
    assert.equal(body.contact_email, "contact@providerone.example");
  } finally {
    await server.close();
  }
});

test("AC2: a valid profile save is persisted", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    const putRes = await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "Provider One Home Services",
        description: "Updated description.",
        contact_email: "contact@providerone.example",
        contact_phone: "+15551234567",
      }),
    });
    assert.equal(putRes.status, 200);

    const getRes = await fetch(manageUrl, { headers: authHeader(token) });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    assert.equal(getBody.business_name, "Provider One Home Services");
  } finally {
    await server.close();
  }
});

test("AC3: a valid save is reflected on the public profile", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    const putRes = await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "Freshly Updated Name",
        description: "Updated description.",
        contact_email: "contact@providerone.example",
        contact_phone: "+15551234567",
      }),
    });
    assert.equal(putRes.status, 200);

    const publicRes = await fetch(`${server.baseUrl}/providers/user-provider-1/public-profile`);
    const publicBody = (await publicRes.json()) as Record<string, unknown>;
    assert.equal(publicBody.business_name, "Freshly Updated Name");
  } finally {
    await server.close();
  }
});

test("AC4: an empty required field returns an inline validation error", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    const res = await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "",
        description: "Updated description.",
        contact_email: "contact@providerone.example",
        contact_phone: "+15551234567",
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: Record<string, string> };
    assert.equal(body.errors.business_name, "Business name is required.");
  } finally {
    await server.close();
  }
});

test("AC5: an invalid save is not persisted", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "",
        description: "Updated description.",
        contact_email: "contact@providerone.example",
        contact_phone: "+15551234567",
      }),
    });

    const getRes = await fetch(manageUrl, { headers: authHeader(token) });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    assert.equal(getBody.business_name, "Provider One Services");
  } finally {
    await server.close();
  }
});

test("AC9: a pending provider is denied access with an explicit message", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider3");
    const res = await fetch(`${server.baseUrl}/providers/user-provider-3/profile`, {
      headers: authHeader(token),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.equal(
      body.error,
      "Your provider application must be approved before you can access profile management.",
    );
  } finally {
    await server.close();
  }
});

test("AC9: a rejected provider is denied access with an explicit message", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider4");
    const res = await fetch(`${server.baseUrl}/providers/user-provider-4/profile`, {
      headers: authHeader(token),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.equal(
      body.error,
      "Your provider application must be approved before you can access profile management.",
    );
  } finally {
    await server.close();
  }
});

test("AC10: a provider cannot view or edit another provider's profile, and no data is disclosed", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");

    const getRes = await fetch(`${server.baseUrl}/providers/user-provider-2/profile`, {
      headers: authHeader(token),
    });
    assert.equal(getRes.status, 403);
    assert.deepEqual(await getRes.json(), { error: "Forbidden" });

    const putRes = await fetch(`${server.baseUrl}/providers/user-provider-2/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "Hijacked",
        description: "Hijacked description.",
        contact_email: "hijack@example.com",
        contact_phone: "+15550000000",
      }),
    });
    assert.equal(putRes.status, 403);
    assert.deepEqual(await putRes.json(), { error: "Forbidden" });
  } finally {
    await server.close();
  }
});

test("AC11: an invalid email or phone format returns inline validation errors", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    const res = await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "Provider One Services",
        description: "Updated description.",
        contact_email: "not-an-email",
        contact_phone: "abc123",
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: Record<string, string> };
    assert.equal(body.errors.contact_email, "Enter a valid email address.");
    assert.equal(body.errors.contact_phone, "Enter a valid phone number, e.g. +15551234567.");
  } finally {
    await server.close();
  }
});

test("AC12: an invalid contact format is not saved", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "Provider One Services",
        description: "Updated description.",
        contact_email: "not-an-email",
        contact_phone: "abc123",
      }),
    });

    const getRes = await fetch(manageUrl, { headers: authHeader(token) });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    assert.equal(getBody.contact_email, "contact@providerone.example");
  } finally {
    await server.close();
  }
});

test("AC13: a valid save is publicly visible immediately with no moderation step", async () => {
  const server = await startTestServer();
  try {
    const token = await login(server.baseUrl, "provider1");
    const manageUrl = `${server.baseUrl}/providers/user-provider-1/profile`;

    const putRes = await fetch(manageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({
        business_name: "Freshly Updated Name",
        description: "Updated description.",
        contact_email: "contact@providerone.example",
        contact_phone: "+15551234567",
      }),
    });
    assert.equal(putRes.status, 200);

    const publicRes = await fetch(`${server.baseUrl}/providers/user-provider-1/public-profile`);
    const publicBody = (await publicRes.json()) as Record<string, unknown>;
    assert.equal(publicBody.business_name, "Freshly Updated Name");
    assert.equal("status" in publicBody, false);
  } finally {
    await server.close();
  }
});
