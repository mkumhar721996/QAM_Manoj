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

async function uploadPdf(baseUrl: string, providerToken: string): Promise<Response> {
  return fetch(`${baseUrl}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/pdf",
      "X-File-Name": "license.pdf",
    },
    body: Buffer.alloc(1024, 1),
  });
}

test("AC9: a provider's document list shows file name, upload date, and current status", async () => {
  const server = await startTestServer();
  try {
    const providerToken = await login(server.baseUrl, "provider1");
    await uploadPdf(server.baseUrl, providerToken);

    const listRes = await fetch(`${server.baseUrl}/documents`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const { documents } = (await listRes.json()) as {
      documents: Array<{ file_name: string; uploaded_at: number; status: string }>;
    };
    assert.equal(documents[0].file_name, "license.pdf");
    assert.equal(typeof documents[0].uploaded_at, "number");
    assert.equal(typeof documents[0].status, "string");
  } finally {
    await server.close();
  }
});

test("a filename containing special characters does not corrupt the Content-Disposition header", async () => {
  const server = await startTestServer();
  try {
    const providerToken = await login(server.baseUrl, "provider1");
    const uploadRes = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerToken}`,
        "Content-Type": "application/pdf",
        "X-File-Name": 'weird" file.pdf',
      },
      body: Buffer.alloc(1024, 1),
    });
    const { id } = (await uploadRes.json()) as { id: string };

    const downloadRes = await fetch(`${server.baseUrl}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(downloadRes.status, 200);
    const contentDisposition = downloadRes.headers.get("content-disposition") ?? "";
    assert.equal(contentDisposition.includes('"'), false);
    assert.equal(contentDisposition.includes(encodeURIComponent('weird" file.pdf')), true);
  } finally {
    await server.close();
  }
});

test("AC10: a provider cannot view or download a different provider's document", async () => {
  const server = await startTestServer();
  try {
    const uploaderToken = await login(server.baseUrl, "provider1");
    const otherProviderToken = await login(server.baseUrl, "provider2");
    const uploadRes = await uploadPdf(server.baseUrl, uploaderToken);
    const { id } = (await uploadRes.json()) as { id: string };

    const res = await fetch(`${server.baseUrl}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${otherProviderToken}` },
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("content" in body, false);
  } finally {
    await server.close();
  }
});
