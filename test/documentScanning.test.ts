import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { DocumentRepository } from "../src/documents/documentRepository.ts";
import type { MalwareScanner } from "../src/documents/malwareScanner.ts";

async function login(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function uploadPdf(baseUrl: string, providerToken: string): Promise<string> {
  const res = await fetch(`${baseUrl}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/pdf",
      "X-File-Name": "license.pdf",
    },
    body: Buffer.alloc(1024, 1),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

function controlledScanner(): { scanner: MalwareScanner; resolve: (result: "clean" | "threat") => void } {
  let resolve!: (result: "clean" | "threat") => void;
  const scanPromise = new Promise<"clean" | "threat">((r) => {
    resolve = r;
  });
  return { scanner: { scan: () => scanPromise }, resolve };
}

test("AC5: a clean scan result flips status to ready", async () => {
  const documentRepository = new DocumentRepository();
  const { scanner, resolve } = controlledScanner();
  const server = await startTestServer({ documentRepository, malwareScanner: scanner });
  try {
    const providerToken = await login(server.baseUrl, "provider1");
    const id = await uploadPdf(server.baseUrl, providerToken);

    resolve("clean");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(documentRepository.findById(id)?.status, "ready");
  } finally {
    await server.close();
  }
});

test("AC6: once ready, the document appears in the admin review queue", async () => {
  const documentRepository = new DocumentRepository();
  const { scanner, resolve } = controlledScanner();
  const server = await startTestServer({ documentRepository, malwareScanner: scanner });
  try {
    const providerToken = await login(server.baseUrl, "provider1");
    const adminToken = await login(server.baseUrl, "admin1");
    const id = await uploadPdf(server.baseUrl, providerToken);

    resolve("clean");
    await Promise.resolve();
    await Promise.resolve();

    const queueRes = await fetch(`${server.baseUrl}/admin/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { documents } = (await queueRes.json()) as { documents: Array<{ id: string }> };
    assert.equal(
      documents.some((d) => d.id === id),
      true,
    );
  } finally {
    await server.close();
  }
});

test("AC7: a detected threat sets the exact failed-status message", async () => {
  const documentRepository = new DocumentRepository();
  const { scanner, resolve } = controlledScanner();
  const server = await startTestServer({ documentRepository, malwareScanner: scanner });
  try {
    const providerToken = await login(server.baseUrl, "provider1");
    await uploadPdf(server.baseUrl, providerToken);

    resolve("threat");
    await Promise.resolve();
    await Promise.resolve();

    const listRes = await fetch(`${server.baseUrl}/documents`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const { documents } = (await listRes.json()) as { documents: Array<{ status: string }> };
    assert.equal(documents[0].status, "failed — file could not be verified");
  } finally {
    await server.close();
  }
});

test("AC8: a failed document never appears in the review queue and is never downloadable by an admin", async () => {
  const documentRepository = new DocumentRepository();
  const { scanner, resolve } = controlledScanner();
  const server = await startTestServer({ documentRepository, malwareScanner: scanner });
  try {
    const providerToken = await login(server.baseUrl, "provider1");
    const adminToken = await login(server.baseUrl, "admin1");
    const id = await uploadPdf(server.baseUrl, providerToken);

    resolve("threat");
    await Promise.resolve();
    await Promise.resolve();

    const queueRes = await fetch(`${server.baseUrl}/admin/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { documents } = (await queueRes.json()) as { documents: Array<{ id: string }> };
    assert.equal(
      documents.some((d) => d.id === id),
      false,
    );

    const downloadRes = await fetch(`${server.baseUrl}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(downloadRes.status, 404);
  } finally {
    await server.close();
  }
});
