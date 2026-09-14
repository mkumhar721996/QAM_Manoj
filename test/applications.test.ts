import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD, testUsers } from "../src/users/fixtures/testUsers.ts";
import { ApplicationRepository } from "../src/applications/applicationRepository.ts";
import { CredentialDocumentRepository } from "../src/applications/credentialDocumentRepository.ts";
import type { Application, ApplicationState } from "../src/applications/applicationModel.ts";
import type { EmailSender, AdminAlertSender, AdminAlert } from "../src/applications/notificationService.ts";

const provider = testUsers.find((u) => u.username === "provider1")!;
const otherProvider = { id: "user-provider-2", username: "provider2" };

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function seedApplication(
  applicationRepository: ApplicationRepository,
  overrides: Partial<Application> & { id: string; providerId: string; state: ApplicationState },
): Application {
  const now = Date.now();
  return applicationRepository.add({
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

test("AC1: submitting with at least one credential document moves the application to submitted", async () => {
  const applicationRepository = new ApplicationRepository();
  const credentialDocumentRepository = new CredentialDocumentRepository();
  const server = await startTestServer({ applicationRepository, credentialDocumentRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "draft" });
    credentialDocumentRepository.add("app-1");

    const res = await fetch(`${server.baseUrl}/applications/app-1/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string };
    assert.equal(body.state, "submitted");
  } finally {
    await server.close();
  }
});

test("AC2: viewing the status page right after submitting shows a submission confirmation", async () => {
  const applicationRepository = new ApplicationRepository();
  const credentialDocumentRepository = new CredentialDocumentRepository();
  const server = await startTestServer({ applicationRepository, credentialDocumentRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "draft" });
    credentialDocumentRepository.add("app-1");

    await fetch(`${server.baseUrl}/applications/app-1/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const res = await fetch(`${server.baseUrl}/applications/app-1/status`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const body = (await res.json()) as { state: string; message: string };
    assert.equal(body.state, "submitted");
    assert.equal(body.message, "Your application has been submitted successfully.");
  } finally {
    await server.close();
  }
});

test("AC3: every application state is displayed clearly on the status page", async () => {
  const applicationRepository = new ApplicationRepository();
  const server = await startTestServer({ applicationRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");

    for (const state of ["submitted", "under_review", "approved", "rejected"] as const) {
      seedApplication(applicationRepository, {
        id: `app-${state}`,
        providerId: provider.id,
        state,
        rejectionReason: state === "rejected" ? "missing license" : undefined,
      });
      const res = await fetch(`${server.baseUrl}/applications/app-${state}/status`, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });
      const body = (await res.json()) as { state: string };
      assert.equal(body.state, state);
    }
  } finally {
    await server.close();
  }
});

test("AC4: a rejected application's status page shows the full rejection reason", async () => {
  const applicationRepository = new ApplicationRepository();
  const server = await startTestServer({ applicationRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    const reason =
      "Your nursing license (#12345) could not be verified against the state registry. Please re-upload a clearer scan.";
    seedApplication(applicationRepository, {
      id: "app-rejected",
      providerId: provider.id,
      state: "rejected",
      rejectionReason: reason,
    });

    const res = await fetch(`${server.baseUrl}/applications/app-rejected/status`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const body = (await res.json()) as { rejectionReason: string };
    assert.equal(body.rejectionReason, reason);
  } finally {
    await server.close();
  }
});

test("AC5: submitted->under_review, under_review->approved and under_review->rejected each send the provider an email", async () => {
  const applicationRepository = new ApplicationRepository();
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
  const emailSender: EmailSender = {
    send: async (to, subject, body) => {
      sentEmails.push({ to, subject, body });
    },
  };
  const server = await startTestServer({ applicationRepository, emailSender });
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "submitted" });

    await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "under_review" }),
    });
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].subject, /under_review/);
    assert.equal(sentEmails[0].to, provider.email);
    assert.equal(applicationRepository.findById("app-1")?.state, "under_review");

    await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "approved" }),
    });
    assert.equal(sentEmails.length, 2);
    assert.match(sentEmails[1].subject, /approved/);
    assert.equal(applicationRepository.findById("app-1")?.state, "approved");
  } finally {
    await server.close();
  }
});

test("AC6: the rejection email includes the rejection reason", async () => {
  const applicationRepository = new ApplicationRepository();
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
  const emailSender: EmailSender = {
    send: async (to, subject, body) => {
      sentEmails.push({ to, subject, body });
    },
  };
  const server = await startTestServer({ applicationRepository, emailSender });
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "under_review" });

    const res = await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "rejected", rejectionReason: "Missing background check" }),
    });
    assert.equal(res.status, 200);
    assert.match(sentEmails.at(-1)!.body, /Missing background check/);
    const updatedApplication = applicationRepository.findById("app-1");
    assert.equal(updatedApplication?.state, "rejected");
    assert.equal(updatedApplication?.rejectionReason, "Missing background check");
  } finally {
    await server.close();
  }
});

test("AC7: a rejected application's status page shows a call-to-action to correct and resubmit", async () => {
  const applicationRepository = new ApplicationRepository();
  const server = await startTestServer({ applicationRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, {
      id: "app-rejected",
      providerId: provider.id,
      state: "rejected",
      rejectionReason: "missing license",
    });

    const res = await fetch(`${server.baseUrl}/applications/app-rejected/status`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const body = (await res.json()) as { cta: string };
    assert.equal(body.cta, "Please correct the issues noted above and resubmit your application.");
  } finally {
    await server.close();
  }
});

test("AC8: submitting without any uploaded credential document is rejected with a clear error", async () => {
  const applicationRepository = new ApplicationRepository();
  const server = await startTestServer({ applicationRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, { id: "app-nodocs", providerId: provider.id, state: "draft" });

    const res = await fetch(`${server.baseUrl}/applications/app-nodocs/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "At least one credential document is required before you can submit your application.");
  } finally {
    await server.close();
  }
});

test("AC9: an open status stream reflects a state change without a manual refresh", async () => {
  const applicationRepository = new ApplicationRepository();
  const server = await startTestServer({ applicationRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "submitted" });

    const streamRes = await fetch(`${server.baseUrl}/applications/app-1/status/stream`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const reader = streamRes.body!.getReader();

    await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "under_review" }),
    });

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    assert.match(chunk, /data: .*"state":"under_review"/);
    await reader.cancel();
  } finally {
    await server.close();
  }
});

test("AC10: a provider can only see their own application's status", async () => {
  const applicationRepository = new ApplicationRepository();
  const server = await startTestServer({ applicationRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, { id: "app-other", providerId: otherProvider.id, state: "submitted" });

    const res = await fetch(`${server.baseUrl}/applications/app-other/status`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("state" in body, false);
  } finally {
    await server.close();
  }
});

test("AC12: a notification that fails then succeeds within the retry limit does not raise an admin alert", async () => {
  const applicationRepository = new ApplicationRepository();
  let attempts = 0;
  const emailSender: EmailSender = {
    send: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("smtp timeout");
      }
    },
  };
  const raised: AdminAlert[] = [];
  const adminAlertSender: AdminAlertSender = {
    raise: async (alert) => {
      raised.push(alert);
    },
  };
  const server = await startTestServer({ applicationRepository, emailSender, adminAlertSender });
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "submitted" });

    const res = await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "under_review" }),
    });
    assert.equal(res.status, 200);
    assert.equal(attempts, 3);
    assert.equal(raised.length, 0);
  } finally {
    await server.close();
  }
});

test("AC13: a notification that fails on every retry attempt raises an admin alert", async () => {
  const applicationRepository = new ApplicationRepository();
  const emailSender: EmailSender = {
    send: async () => {
      throw new Error("smtp down");
    },
  };
  const alerts: AdminAlert[] = [];
  const adminAlertSender: AdminAlertSender = {
    raise: async (alert) => {
      alerts.push(alert);
    },
  };
  const server = await startTestServer({ applicationRepository, emailSender, adminAlertSender });
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "submitted" });

    const res = await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "under_review" }),
    });
    assert.equal(res.status, 200);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].applicationId, "app-1");
  } finally {
    await server.close();
  }
});

test("AC13: a notified transition for a provider with no known email raises an admin alert instead of silently skipping notification", async () => {
  const applicationRepository = new ApplicationRepository();
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
  const emailSender: EmailSender = {
    send: async (to, subject, body) => {
      sentEmails.push({ to, subject, body });
    },
  };
  const alerts: AdminAlert[] = [];
  const adminAlertSender: AdminAlertSender = {
    raise: async (alert) => {
      alerts.push(alert);
    },
  };
  const server = await startTestServer({ applicationRepository, emailSender, adminAlertSender });
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, {
      id: "app-1",
      providerId: "user-does-not-exist",
      state: "submitted",
    });

    const res = await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "under_review" }),
    });
    assert.equal(res.status, 200);
    assert.equal(sentEmails.length, 0);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].applicationId, "app-1");
    assert.equal(alerts[0].providerId, "user-does-not-exist");
  } finally {
    await server.close();
  }
});

test("AC14: a corrected, resubmitted rejected application moves back to submitted", async () => {
  const applicationRepository = new ApplicationRepository();
  const credentialDocumentRepository = new CredentialDocumentRepository();
  const server = await startTestServer({ applicationRepository, credentialDocumentRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, {
      id: "app-resubmit",
      providerId: provider.id,
      state: "rejected",
      rejectionReason: "old reason",
    });
    credentialDocumentRepository.add("app-resubmit");

    const res = await fetch(`${server.baseUrl}/applications/app-resubmit/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string };
    assert.equal(body.state, "submitted");
  } finally {
    await server.close();
  }
});

test("AC15: after a resubmission, the prior rejection reason is no longer shown", async () => {
  const applicationRepository = new ApplicationRepository();
  const credentialDocumentRepository = new CredentialDocumentRepository();
  const server = await startTestServer({ applicationRepository, credentialDocumentRepository });
  try {
    const providerToken = await loginAs(server.baseUrl, "provider1");
    seedApplication(applicationRepository, {
      id: "app-resubmit",
      providerId: provider.id,
      state: "rejected",
      rejectionReason: "old reason",
    });
    credentialDocumentRepository.add("app-resubmit");

    await fetch(`${server.baseUrl}/applications/app-resubmit/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const res = await fetch(`${server.baseUrl}/applications/app-resubmit/status`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("rejectionReason" in body, false);
  } finally {
    await server.close();
  }
});

test("security: CRLF in a rejection reason cannot inject extra email headers", async () => {
  const applicationRepository = new ApplicationRepository();
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
  const emailSender: EmailSender = {
    send: async (to, subject, body) => {
      sentEmails.push({ to, subject, body });
    },
  };
  const server = await startTestServer({ applicationRepository, emailSender });
  try {
    const adminToken = await loginAs(server.baseUrl, "admin1");
    seedApplication(applicationRepository, { id: "app-1", providerId: provider.id, state: "under_review" });

    const maliciousReason = "bad\r\nBcc: attacker@example.com";
    const res = await fetch(`${server.baseUrl}/applications/app-1/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: "rejected", rejectionReason: maliciousReason }),
    });
    assert.equal(res.status, 200);
    const responseBody = (await res.json()) as { rejectionReason: string };
    assert.equal(responseBody.rejectionReason.includes("\r"), false);
    assert.equal(responseBody.rejectionReason.includes("\n"), false);
    assert.equal(sentEmails.at(-1)!.body.includes("\r\n"), false);
  } finally {
    await server.close();
  }
});
