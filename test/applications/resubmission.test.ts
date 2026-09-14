import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../testServer.ts";
import { issueAccessToken } from "../../src/auth/tokenService.ts";
import { ApplicationRepository } from "../../src/applications/applicationRepository.ts";
import { rejectedApplicationFixture } from "../../src/applications/fixtures/testApplications.ts";
import { NullDocumentScanner, FakeDocumentScanner } from "../../src/applications/documentScanner.ts";
import { InMemoryEmailService } from "../../src/notifications/emailService.ts";

function cloneFixture() {
  return structuredClone(rejectedApplicationFixture);
}

function providerToken(): string {
  return issueAccessToken({ userId: rejectedApplicationFixture.providerId, role: "provider" });
}

test("AC1: resubmitting a rejected application updates the existing record, not a new one", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const server = await startTestServer({
    applicationRepository,
    emailService: new InMemoryEmailService(),
    documentScanner: new NullDocumentScanner(),
  });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { bio: "corrected bio" } }),
    });
    assert.equal(res.status, 200);
    assert.equal(applicationRepository.count(), 1);
    assert.equal(applicationRepository.findById(rejectedApplicationFixture.id)?.profile.bio, "corrected bio");
  } finally {
    await server.close();
  }
});

test("AC2: a successful resubmission sets status back to submitted", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const server = await startTestServer({
    applicationRepository,
    emailService: new InMemoryEmailService(),
    documentScanner: new NullDocumentScanner(),
  });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { bio: "corrected bio" } }),
    });
    assert.equal(res.status, 200);
    const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
    assert.equal(application.status, "submitted");
  } finally {
    await server.close();
  }
});

test("AC3: after resubmission the pending-review queue includes the application", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const server = await startTestServer({
    applicationRepository,
    emailService: new InMemoryEmailService(),
    documentScanner: new NullDocumentScanner(),
  });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { bio: "corrected bio" } }),
    });
    assert.equal(res.status, 200);
    const pending = applicationRepository.findPendingReview();
    assert.ok(pending.some((a) => a.id === rejectedApplicationFixture.id));
  } finally {
    await server.close();
  }
});

test("AC4: application detail retains full history after resubmission", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const server = await startTestServer({
    applicationRepository,
    emailService: new InMemoryEmailService(),
    documentScanner: new NullDocumentScanner(),
  });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { bio: "corrected bio" } }),
    });
    assert.equal(res.status, 200);
    const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
    assert.equal(application.history.length, 2);
    assert.equal(application.history[0].status, "rejected");
    assert.equal(application.history[0].rejectionReason, "Missing malpractice insurance certificate");
    assert.equal(application.history[1].status, "submitted");
  } finally {
    await server.close();
  }
});

test("AC5: a confirmed resubmission sends the provider a confirmation email", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const emailService = new InMemoryEmailService();
  const server = await startTestServer({ applicationRepository, emailService, documentScanner: new NullDocumentScanner() });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { bio: "corrected bio" } }),
    });
    assert.equal(res.status, 200);
    assert.equal(emailService.sentMessages.length, 1);
    assert.equal(emailService.sentMessages[0].to, rejectedApplicationFixture.providerEmail);
    assert.match(emailService.sentMessages[0].subject, /under review/i);
  } finally {
    await server.close();
  }
});

test("AC6: an infected replacement document is blocked and never saved to the record", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const documentScanner = new FakeDocumentScanner({ "infected.pdf": "infected" });
  const server = await startTestServer({ applicationRepository, documentScanner, emailService: new InMemoryEmailService() });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [{ fileName: "infected.pdf", contentBase64: "eA==" }] }),
    });
    assert.equal(res.status, 422);
    const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
    assert.equal(application.documents.some((d) => d.fileName === "infected.pdf"), false);
    assert.equal(application.status, "rejected");
  } finally {
    await server.close();
  }
});

test("AC6: a clean replacement document passes the scan and becomes part of the record", async () => {
  const applicationRepository = new ApplicationRepository([cloneFixture()]);
  const documentScanner = new FakeDocumentScanner({ "license.pdf": "clean" });
  const server = await startTestServer({ applicationRepository, documentScanner, emailService: new InMemoryEmailService() });
  try {
    const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [{ fileName: "license.pdf", contentBase64: "eA==" }] }),
    });
    assert.equal(res.status, 200);
    const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
    assert.equal(application.documents.find((d) => d.fileName === "license.pdf")?.scanStatus, "clean");
  } finally {
    await server.close();
  }
});
