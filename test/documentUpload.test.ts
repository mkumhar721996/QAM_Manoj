import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { DocumentRepository } from "../src/documents/documentRepository.ts";
import type { MalwareScanner } from "../src/documents/malwareScanner.ts";

function pendingScanner(): MalwareScanner {
  return { scan: () => new Promise(() => {}) };
}

async function login(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

test("AC1: a PDF under 10 MB is accepted and queued for scanning", async () => {
  const documentRepository = new DocumentRepository();
  const server = await startTestServer({ documentRepository, malwareScanner: pendingScanner() });
  try {
    const providerToken = await login(server.baseUrl, "provider1");

    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerToken}`,
        "Content-Type": "application/pdf",
        "X-File-Name": "license.pdf",
      },
      body: Buffer.alloc(1024, 1),
    });
    assert.equal(res.status, 202);
    const body = (await res.json()) as { id: string };
    assert.equal(documentRepository.findById(body.id)?.status, "pending_scan");
  } finally {
    await server.close();
  }
});

test("AC2: the uploaded document shows status 'pending scan' via the documents list", async () => {
  const server = await startTestServer({ malwareScanner: pendingScanner() });
  try {
    const providerToken = await login(server.baseUrl, "provider1");

    await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerToken}`,
        "Content-Type": "application/pdf",
        "X-File-Name": "license.pdf",
      },
      body: Buffer.alloc(1024, 1),
    });

    const listRes = await fetch(`${server.baseUrl}/documents`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const { documents } = (await listRes.json()) as { documents: Array<{ status: string }> };
    assert.equal(documents[0].status, "pending scan");
  } finally {
    await server.close();
  }
});

test("AC3: a non-PDF/JPG/PNG upload is rejected with the accepted-formats message", async () => {
  const server = await startTestServer();
  try {
    const providerToken = await login(server.baseUrl, "provider1");

    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerToken}`,
        "Content-Type": "application/msword",
        "X-File-Name": "resume.docx",
      },
      body: Buffer.from("not a real document"),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Only PDF, JPG, and PNG files are accepted");
  } finally {
    await server.close();
  }
});

test("AC4: a file over 10 MB is rejected with the size-limit message", async () => {
  const server = await startTestServer();
  try {
    const providerToken = await login(server.baseUrl, "provider1");

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerToken}`,
        "Content-Type": "application/pdf",
        "X-File-Name": "license.pdf",
      },
      body: oversized,
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /10 MB/);
  } finally {
    await server.close();
  }
});
