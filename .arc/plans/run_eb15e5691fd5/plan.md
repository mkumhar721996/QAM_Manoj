summary: |
  This is the first work item in the codebase to touch the "provider application" domain at all —
  today the repo only has auth/session code (users, sessions, JWTs); there is no application model,
  admin review queue, email service, or document/malware-scanning infrastructure yet. This plan adds
  the minimal in-memory scaffolding needed to implement and test resubmission-after-rejection: a
  ProviderApplication model that tracks status and a full history of review iterations, an in-memory
  ApplicationRepository (mirroring the existing SessionRepository/UserRepository pattern), a
  DocumentScanner gate and EmailService, and an ApplicationService.resubmit orchestration wired to a
  new authenticated HTTP endpoint. The goal is to satisfy AC1–AC6 exactly — updating the existing
  record in place, flipping status back to "submitted", preserving prior rejection history, gating
  new documents through malware scanning before they're admin-visible, and sending a confirmation
  email — without building the (separate, not-yet-existing) admin queue/detail UI or a general file
  upload/AV integration, which are out of scope for this story.

scope:
  - description: |
      Add the provider-application domain model and a seeded test fixture representing an
      already-rejected application (the precondition every AC starts from).

      ```ts
      // src/applications/applicationModel.ts
      export type ApplicationStatus = "submitted" | "rejected" | "approved";
      export type ScanStatus = "pending" | "clean" | "infected";

      export interface ApplicationDocument {
        id: string;
        fileName: string;
        scanStatus: ScanStatus;
        uploadedAt: number;
      }

      export interface ReviewIteration {
        iterationNumber: number;
        submittedAt: number;
        profileSnapshot: Record<string, unknown>;
        documentIds: string[];
        status: ApplicationStatus;
        rejectionReason?: string;
        reviewedBy?: string;
        reviewedAt?: number;
      }

      export interface ProviderApplication {
        id: string;
        providerId: string;
        providerEmail: string;
        status: ApplicationStatus;
        profile: Record<string, unknown>;
        documents: ApplicationDocument[];
        history: ReviewIteration[];
        createdAt: number;
        updatedAt: number;
      }
      ```
    files:
      - src/applications/applicationModel.ts
      - src/applications/fixtures/testApplications.ts
    rationale: |
      No application/onboarding domain exists in the repo at all (confirmed by grep — only the
      "provider" role string exists, in testUsers.ts). Every AC presupposes a rejected application
      already exists, so a seeded fixture (mirroring src/users/fixtures/testUsers.ts) is needed to
      drive the resubmission tests without also having to build the initial-submission/admin-rejection
      flows, which belong to sibling stories in the same epic.

  - description: |
      Add an in-memory ApplicationRepository mirroring SessionRepository's constructor-seeded,
      Map-based style, since the project has no database layer anywhere.

      ```ts
      // src/applications/applicationRepository.ts
      export class ApplicationRepository {
        private applicationsById: Map<string, ProviderApplication>;
        constructor(seed: ProviderApplication[] = []) {
          this.applicationsById = new Map(seed.map((a) => [a.id, a]));
        }
        findById(id: string): ProviderApplication | undefined {
          return this.applicationsById.get(id);
        }
        findPendingReview(): ProviderApplication[] {
          return [...this.applicationsById.values()].filter((a) => a.status === "submitted");
        }
        save(application: ProviderApplication): void {
          this.applicationsById.set(application.id, application);
        }
        count(): number {
          return this.applicationsById.size;
        }
      }
      ```
    files:
      - src/applications/applicationRepository.ts
    rationale: |
      Matches the existing SessionRepository/UserRepository convention exactly (constructor-injected
      seed array, Map-backed lookups, injectable via AppDependencies for tests). `findPendingReview`
      and `count` are the concrete data this story's AC3 (queue shows it pending again) and AC1 (no
      duplicate record) tests assert against, without building a separate admin queue endpoint that
      doesn't exist yet.

  - description: |
      Add a DocumentScanner gate (interface + deterministic fake for tests + inert default) that
      every newly uploaded document must pass through before it's stored as admin-visible.

      ```ts
      // src/applications/documentScanner.ts
      export type ScanResult = "clean" | "infected";

      export interface DocumentScanner {
        scan(fileName: string, contentBase64: string): Promise<ScanResult>;
      }

      // Placeholder until a real AV integration exists; always reports clean.
      export class NullDocumentScanner implements DocumentScanner {
        async scan(): Promise<ScanResult> {
          return "clean";
        }
      }

      // Deterministic test double: results keyed by file name.
      export class FakeDocumentScanner implements DocumentScanner {
        constructor(private results: Record<string, ScanResult>) {}
        async scan(fileName: string): Promise<ScanResult> {
          return this.results[fileName] ?? "clean";
        }
      }
      ```
    files:
      - src/applications/documentScanner.ts
    rationale: |
      AC6 requires replacement documents to go through "the same malware scanning gate" — but no
      scanning/AV integration exists anywhere in the codebase today. This defines the seam
      (DocumentScanner) the service calls, with a deterministic fake for tests and an inert default
      (NullDocumentScanner) for createApp, matching the project's existing habit of keeping infra
      integrations minimal/stubbed (e.g. in-memory sessions instead of a real store).

  - description: |
      Add an EmailService (interface + in-memory recording test double + console-logging default)
      used to confirm resubmission back to the provider.

      ```ts
      // src/notifications/emailService.ts
      export interface EmailService {
        send(to: string, subject: string, body: string): Promise<void>;
      }

      export interface SentMessage { to: string; subject: string; body: string }

      export class InMemoryEmailService implements EmailService {
        sentMessages: SentMessage[] = [];
        async send(to: string, subject: string, body: string): Promise<void> {
          this.sentMessages.push({ to, subject, body });
        }
      }

      export class ConsoleEmailService implements EmailService {
        async send(to: string, subject: string): Promise<void> {
          console.log(`email to=${to} subject=${subject}`);
        }
      }
      ```
    files:
      - src/notifications/emailService.ts
    rationale: |
      No email/notification infra exists in the repo. AC5 needs a confirmation email sent on
      resubmission; InMemoryEmailService lets tests assert on what was sent without a real SMTP
      integration, and ConsoleEmailService is the wired default for createApp, consistent with the
      project's minimal-infra style.

  - description: |
      Add ApplicationService.resubmit, the orchestration that enforces AC1/AC2/AC4/AC6 atomically
      (scan first; only mutate/save/email if every new document is clean) and returns the updated
      record.

      ```ts
      // src/applications/applicationService.ts
      export class ApplicationNotFoundError extends Error {}
      export class ApplicationNotResubmittableError extends Error {}
      export class DocumentInfectedError extends Error {
        constructor(fileName: string) {
          super(`Document "${fileName}" failed malware scanning`);
        }
      }

      export class ApplicationService {
        constructor(
          private applicationRepository: ApplicationRepository,
          private documentScanner: DocumentScanner,
          private emailService: EmailService,
        ) {}

        async resubmit(
          applicationId: string,
          providerId: string,
          updates: { profile?: Record<string, unknown>; newDocuments?: Array<{ fileName: string; contentBase64: string }> },
          now: number = Date.now(),
        ): Promise<ProviderApplication> {
          const application = this.applicationRepository.findById(applicationId);
          if (!application || application.providerId !== providerId) {
            throw new ApplicationNotFoundError();
          }
          if (application.status !== "rejected") {
            throw new ApplicationNotResubmittableError();
          }

          const scannedDocs: ApplicationDocument[] = [];
          for (const doc of updates.newDocuments ?? []) {
            const result = await this.documentScanner.scan(doc.fileName, doc.contentBase64);
            if (result === "infected") {
              throw new DocumentInfectedError(doc.fileName);
            }
            scannedDocs.push({ id: crypto.randomUUID(), fileName: doc.fileName, scanStatus: "clean", uploadedAt: now });
          }

          application.profile = { ...application.profile, ...updates.profile };
          application.documents = [...application.documents, ...scannedDocs];
          application.status = "submitted";
          application.updatedAt = now;
          application.history.push({
            iterationNumber: application.history.length + 1,
            submittedAt: now,
            profileSnapshot: application.profile,
            documentIds: application.documents.map((d) => d.id),
            status: "submitted",
          });

          this.applicationRepository.save(application);
          await this.emailService.send(
            application.providerEmail,
            "Your application is back under review",
            "We've received your corrected application and it is now under review.",
          );
          return application;
        }
      }
      ```
    files:
      - src/applications/applicationService.ts
    rationale: |
      Scanning happens before any mutation/save/email, so an infected document never becomes part of
      the saved record (AC6's "before becoming accessible to admins"), and the whole resubmission is
      atomic — either everything updates together (AC1/AC2/AC4) or nothing does.

  - description: |
      Add the HTTP controller and wire a new authenticated route into app.ts's router, reusing the
      existing tokenService for auth instead of inventing a new auth mechanism.

      ```ts
      // src/applications/applicationController.ts
      export async function handleResubmitApplication(
        applicationService: ApplicationService,
        applicationId: string,
        providerId: string,
        requestBody: unknown,
      ): Promise<ControllerResponse> {
        const { profile, documents } = asRecord(requestBody);
        try {
          const application = await applicationService.resubmit(applicationId, providerId, {
            profile: profile as Record<string, unknown> | undefined,
            newDocuments: documents as Array<{ fileName: string; contentBase64: string }> | undefined,
          });
          return { status: 200, body: { id: application.id, status: application.status } };
        } catch (err) {
          if (err instanceof ApplicationNotFoundError) return { status: 404, body: { error: "application not found" } };
          if (err instanceof ApplicationNotResubmittableError) return { status: 409, body: { error: "application is not rejected" } };
          if (err instanceof DocumentInfectedError) return { status: 422, body: { error: err.message } };
          throw err;
        }
      }
      ```

      In app.ts, add a regex-based match alongside the existing exact-string route table (the router
      today only does `${method} ${url.pathname}` equality, which can't express a path param):

      ```ts
      const resubmitMatch = method === "POST" ? url.pathname.match(/^\/applications\/([^/]+)\/resubmit$/) : null;
      if (resubmitMatch) {
        const payload = verifyAccessToken(bearerTokenFrom(req.headers.authorization) ?? "");
        if (!payload) { sendJson(res, 401, { error: "missing or invalid access token" }); return; }
        if (payload.role !== "provider") { sendJson(res, 403, { error: "only providers may resubmit applications" }); return; }
        const body = await readJsonBody(req);
        const result = await handleResubmitApplication(applicationService, resubmitMatch[1], payload.userId, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - src/applications/applicationController.ts
      - src/app.ts
    rationale: |
      Mirrors authController.ts's ControllerResponse pattern exactly. Reuses verifyAccessToken (from
      STORY-007) rather than building new auth, and adds a role + ownership check (403) so one
      provider can't resubmit another's application — not stated verbatim in the ACs but necessary to
      avoid an obvious authorization hole, called out under assumptions.

  - description: |
      Failing tests first, one file, following the existing test/*.test.ts + startTestServer style.
    files:
      - test/applications/resubmission.test.ts
    rationale: |
      Matches login.test.ts/refresh.test.ts/logout.test.ts conventions: node:test + node:assert/strict,
      startTestServer with injected repositories/fakes, real fetch() calls against the running server.

tests:
  - |
    AC1 — resubmitting updates the existing record instead of creating a new one:
    ```ts
    test("AC1: resubmitting a rejected application updates the existing record, not a new one", async () => {
      const applicationRepository = new ApplicationRepository([rejectedApplicationFixture]);
      const server = await startTestServer({ applicationRepository, emailService: new InMemoryEmailService(), documentScanner: new NullDocumentScanner() });
      const token = issueAccessToken({ userId: rejectedApplicationFixture.providerId, role: "provider" });
      const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { bio: "corrected bio" } }),
      });
      assert.equal(res.status, 200);
      assert.equal(applicationRepository.count(), 1);
      assert.equal(applicationRepository.findById(rejectedApplicationFixture.id)?.profile.bio, "corrected bio");
    });
    ```
  - |
    AC2 — application status returns to 'submitted':
    ```ts
    test("AC2: a successful resubmission sets status back to submitted", async () => {
      // ...same setup as AC1...
      const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
      assert.equal(application.status, "submitted");
    });
    ```
  - |
    AC3 — the (repository-backed) admin review queue includes it as pending again:
    ```ts
    test("AC3: after resubmission the pending-review queue includes the application", async () => {
      // ...same setup/resubmit call as AC1...
      const pending = applicationRepository.findPendingReview();
      assert.ok(pending.some((a) => a.id === rejectedApplicationFixture.id));
    });
    ```
  - |
    AC4 — full history of prior review iterations (rejection reason included) stays visible:
    ```ts
    test("AC4: application detail retains full history after resubmission", async () => {
      // ...same setup/resubmit call as AC1...
      const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
      assert.equal(application.history.length, 2);
      assert.equal(application.history[0].status, "rejected");
      assert.equal(application.history[0].rejectionReason, "Missing malpractice insurance certificate");
      assert.equal(application.history[1].status, "submitted");
    });
    ```
  - |
    AC5 — provider receives an email confirming the application is back under review:
    ```ts
    test("AC5: a confirmed resubmission sends the provider a confirmation email", async () => {
      const emailService = new InMemoryEmailService();
      // ...startTestServer with this emailService, same resubmit call as AC1...
      assert.equal(emailService.sentMessages.length, 1);
      assert.equal(emailService.sentMessages[0].to, rejectedApplicationFixture.providerEmail);
      assert.match(emailService.sentMessages[0].subject, /under review/i);
    });
    ```
  - |
    AC6 — a replacement document goes through the same malware scanning gate before admins can see it
    (both the blocking and passing paths):
    ```ts
    test("AC6: an infected replacement document is blocked and never saved to the record", async () => {
      const documentScanner = new FakeDocumentScanner({ "infected.pdf": "infected" });
      const applicationRepository = new ApplicationRepository([rejectedApplicationFixture]);
      const server = await startTestServer({ applicationRepository, documentScanner, emailService: new InMemoryEmailService() });
      const token = issueAccessToken({ userId: rejectedApplicationFixture.providerId, role: "provider" });
      const res = await fetch(`${server.baseUrl}/applications/${rejectedApplicationFixture.id}/resubmit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ documents: [{ fileName: "infected.pdf", contentBase64: "eA==" }] }),
      });
      assert.equal(res.status, 422);
      const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
      assert.equal(application.documents.some((d) => d.fileName === "infected.pdf"), false);
      assert.equal(application.status, "rejected");
    });

    test("AC6: a clean replacement document passes the scan and becomes part of the record", async () => {
      const documentScanner = new FakeDocumentScanner({ "license.pdf": "clean" });
      // ...same setup, body: { documents: [{ fileName: "license.pdf", contentBase64: "eA==" }] }...
      assert.equal(res.status, 200);
      const application = applicationRepository.findById(rejectedApplicationFixture.id)!;
      assert.equal(application.documents.find((d) => d.fileName === "license.pdf")?.scanStatus, "clean");
    });
    ```

assumptions_or_open_questions:
  - |
    No provider-application domain, database, admin routes, email provider, or malware-scanning
    integration exists anywhere in the repo today (verified by grepping src/ and test/ for
    application|malware|scan|email|notif|document|credential|reject — only the "provider" role
    string in testUsers.ts matched). This plan therefore builds new in-memory scaffolding mirroring
    the existing SessionRepository/UserRepository style rather than assuming any pre-existing
    persistence or infra layer.
  - |
    The initial submission and admin-rejection flows that produce the "rejected" starting state are
    assumed to be delivered by other stories in the same epic; here they're represented only as a
    seeded test fixture (rejectedApplicationFixture), not as new production code.
  - |
    File uploads are accepted as a `contentBase64` JSON field rather than multipart/form-data, since
    httpUtils.ts has no multipart parser and adding a general-purpose upload layer is out of scope for
    this story.
  - |
    Only the owning provider (JWT `userId` === `application.providerId`) may resubmit; a mismatch or
    wrong role returns 403/404. This isn't stated verbatim in the ACs but is necessary to avoid one
    provider resubmitting another's application.
  - |
    AC3 ("admin review queue shows...pending") and AC4 ("admin opens the application detail...history
    visible") are interpreted as requirements on the underlying data (ApplicationRepository.status and
    .history), not as new admin-facing HTTP endpoints/UI — no admin routes exist yet in this codebase,
    and building a full admin queue/detail feature is not implied by this story's ACs.
  - |
    The default DocumentScanner (NullDocumentScanner, always "clean") and EmailService
    (ConsoleEmailService, logs only) wired into createApp are inert placeholders until real
    antivirus/SMTP integrations exist; tests inject the fakes/recorders instead.

package_dependencies: []

notes: |
  This mirrors the existing auth/session slice's structure exactly: an in-memory, constructor-seeded
  repository (ApplicationRepository ~ SessionRepository), a service class holding orchestration logic
  (ApplicationService ~ AuthService), a controller returning `{ status, body }` (ApplicationController
  ~ authController.ts), and tests hitting a real HTTP server via `startTestServer` with injected fakes
  (mirrors login/refresh/logout.test.ts). Auth reuses `verifyAccessToken`/`issueAccessToken` from
  STORY-007 rather than inventing anything new. The one structural change to existing code is
  `app.ts`'s router, which today only does exact `${method} ${url.pathname}` string matching and needs
  a regex branch to extract the `:id` path param for `POST /applications/:id/resubmit`.

  ```mermaid
  flowchart TD
    Router["app.ts request router"] --> Controller["applicationController.handleResubmitApplication"]
    TokenSvc["tokenService.verifyAccessToken (existing, reused)"] --> Router
    Controller --> Service["applicationService.resubmit"]
    Service --> Repo["applicationRepository"]
    Service --> Scanner["documentScanner (Null/Fake)"]
    Service --> Email["emailService (Console/InMemory)"]

    classDef touched fill:#f96,color:#000
    class Router,Controller,Service,Repo,Scanner,Email touched
  ```
