summary: |
  This adds provider-facing application submission and a real-time status page to the existing
  plain-Node.js (no framework) auth/session service. It introduces a new `src/applications/`
  domain: an in-memory `Application` model/repository with a state machine
  (draft -> submitted -> under_review -> approved | rejected, with rejected -> submitted for
  resubmission), a minimal `CredentialDocumentRepository` seam so submission can enforce "at
  least one credential document uploaded" (document upload itself is a separate, not-yet-built
  story), a `NotificationService` that emails the provider on the three transitions the ACs
  specify (submitted->under_review, under_review->approved, under_review->rejected) with
  retry-then-admin-alert semantics, and an `ApplicationEventBus` (Node `EventEmitter`) feeding a
  Server-Sent-Events endpoint so an open status page updates without a manual refresh. New HTTP
  routes are added to the existing hand-rolled router in `src/app.ts`, following the same
  controller/service/repository layering and dependency-injection style already used by
  auth/session. Everything is built from Node built-ins (`node:http`, `node:events`,
  `node:crypto`) with no new third-party dependencies, consistent with the current
  zero-runtime-dependency codebase.

scope:
  - description: |
      Define the `Application` domain types and the state machine used everywhere else:
      `ApplicationState`, `Application`, and the `VALID_TRANSITIONS` map. This is the single
      source of truth for which transitions are legal, so the service and its tests share one
      definition instead of re-deriving it.
      ```ts
      export type ApplicationState = "draft" | "submitted" | "under_review" | "approved" | "rejected";

      export interface Application {
        id: string;
        providerId: string;
        state: ApplicationState;
        rejectionReason?: string;
        createdAt: number;
        updatedAt: number;
        submittedAt?: number;
      }

      export const VALID_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
        draft: ["submitted"],
        submitted: ["under_review"],
        under_review: ["approved", "rejected"],
        approved: [],
        rejected: ["submitted"],
      };

      export const NOTIFIED_TRANSITIONS = new Set<string>([
        "submitted->under_review",
        "under_review->approved",
        "under_review->rejected",
      ]);
      ```
    files:
      - src/applications/applicationModel.ts
    rationale: |
      Centralising the state machine avoids duplicating transition rules between submit(),
      transitionState(), and tests, and makes the "which transitions notify" rule (AC5) explicit
      and reviewable in one place.

  - description: |
      In-memory `ApplicationRepository`, mirroring the existing `UserRepository` /
      `SessionRepository` style (`Map`-backed, `add`/`findById`).
      ```ts
      export class ApplicationRepository {
        private applicationsById = new Map<string, Application>();
        add(application: Application): Application { ... }
        findById(id: string): Application | undefined { ... }
      }
      ```
    files:
      - src/applications/applicationRepository.ts
    rationale: |
      No application/provider-onboarding story exists yet in this repo (only login/session), so
      there is no persistence layer to reuse; tests seed applications directly via this
      repository the same way `login.test.ts` seeds `SessionRepository` directly.

  - description: |
      Minimal `CredentialDocumentRepository` seam: `add(applicationId)` and
      `countByApplicationId(applicationId)`. This is intentionally not an HTTP upload endpoint —
      document upload is out of scope for this story — it exists only so `ApplicationService`
      and tests can establish/check the "has at least one credential document" precondition
      (AC1, AC8).
    files:
      - src/applications/credentialDocumentRepository.ts
    rationale: |
      AC1/AC8 require gating submission on document presence, but no upload feature exists in
      this codebase yet; a narrow repository seam avoids building an out-of-scope upload
      pipeline while still making the precondition testable.

  - description: |
      `ApplicationEventBus`: a thin wrapper over `node:events` `EventEmitter`, keyed by
      `providerId`, with `subscribe(providerId, listener): () => void` (unsubscribe) and
      `publish(providerId, application)`. Used by the SSE endpoint to push status changes.
    files:
      - src/applications/applicationEventBus.ts
    rationale: |
      AC9 requires the status page to reflect state changes without a manual refresh. The repo
      has no websocket/pub-sub infra and no framework; `EventEmitter` + Server-Sent Events is the
      minimal built-in mechanism for one-way server push over plain `node:http`, needing zero new
      dependencies.

  - description: |
      `NotificationService` with an injectable `EmailSender` / `AdminAlertSender` pair, retry
      logic, and admin-alert-on-exhaustion.
      ```ts
      export const NOTIFICATION_MAX_ATTEMPTS = 3;

      export interface EmailSender {
        send(to: string, subject: string, body: string): Promise<void>;
      }
      export interface AdminAlertSender {
        raise(alert: { applicationId: string; providerId: string; state: ApplicationState; error: string }): Promise<void>;
      }

      export class NotificationService {
        constructor(
          private emailSender: EmailSender,
          private adminAlertSender: AdminAlertSender,
          private maxAttempts: number = NOTIFICATION_MAX_ATTEMPTS,
        ) {}

        async notifyStateChange(application: Application, providerEmail: string): Promise<void> {
          const subject = `Your application status has changed to ${application.state}`;
          const body = application.state === "rejected"
            ? `Your application was rejected. Reason: ${application.rejectionReason}`
            : `Your application status is now: ${application.state}`;

          let lastError: unknown;
          for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            try {
              await this.emailSender.send(providerEmail, subject, body);
              return;
            } catch (err) {
              lastError = err;
            }
          }
          await this.adminAlertSender.raise({
            applicationId: application.id,
            providerId: application.providerId,
            state: application.state,
            error: lastError instanceof Error ? lastError.message : String(lastError),
          });
        }
      }
      ```
      Default `ConsoleEmailSender` / `ConsoleAdminAlertSender` implementations log via
      `console.log`/`console.error` (matching the existing `console.log`/`console.warn` style in
      `authController.ts`) as placeholders until a real email provider is wired up.
    files:
      - src/applications/notificationService.ts
    rationale: |
      AC5/AC6/AC12/AC13 need retry-then-alert behaviour that is independently testable via fake
      senders, following the same constructor-injection pattern `AuthService` already uses for
      `UserRepository`/`SessionRepository`.

  - description: |
      `ApplicationService` — the orchestration layer: `submit`, `transitionState`, `getStatus`.
      ```ts
      submit(applicationId: string, now: number = Date.now()): Application
      // throws ApplicationNotFoundError | NoCredentialDocumentError | InvalidTransitionError

      async transitionState(
        applicationId: string,
        newState: ApplicationState,
        options: { rejectionReason?: string } = {},
        now: number = Date.now(),
      ): Promise<Application>
      // throws ApplicationNotFoundError | InvalidTransitionError | MissingRejectionReasonError

      getStatus(applicationId: string): Application | undefined
      ```
      `submit` clears any prior `rejectionReason` (AC15) and does NOT send an email (AC5 only
      lists submitted->under_review, under_review->approved, under_review->rejected as
      notifying transitions — initial/re-submission is deliberately excluded). `transitionState`
      validates against `VALID_TRANSITIONS`, requires `rejectionReason` when moving to
      `rejected`, sends a notification via `NotificationService` only when the transition is in
      `NOTIFIED_TRANSITIONS`, and always publishes to `ApplicationEventBus` on success.
    files:
      - src/applications/applicationService.ts
    rationale: |
      Single place enforcing the state machine, the credential-document gate, and which
      transitions notify, so the controller stays a thin HTTP adapter (matching how
      `AuthService` currently holds all login/refresh/logout business logic).

  - description: |
      Add a small shared auth-parsing helper next to the existing token verification so four new
      handlers don't each re-implement "strip Bearer prefix, verify token".
      ```ts
      // src/auth/tokenService.ts
      export function authenticateRequest(
        authorizationHeader: string | undefined,
        now: number = Date.now(),
      ): AccessTokenPayload | null {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
        return token ? verifyAccessToken(token, now) : null;
      }
      ```
    files:
      - src/auth/tokenService.ts
    rationale: |
      `handleGetSession` in `authController.ts` already inlines this exact Bearer-parsing logic;
      extracting it avoids copy-pasting it into four new application handlers while leaving
      `handleGetSession` itself untouched (no behaviour change to existing auth routes).

  - description: |
      Add an `email` field to the `User` model/fixtures so notifications have a delivery
      address (the current `User` only has `id`, `username`, `passwordHash`, `role`).
      ```ts
      export interface User {
        id: string;
        username: string;
        passwordHash: string;
        role: Role;
        email: string;
      }
      ```
      `testUsers` fixture gets e.g. `email: "provider1@example.com"` for `provider1`.
    files:
      - src/users/fixtures/testUsers.ts
      - src/users/userRepository.ts
    rationale: |
      AC5/AC6/AC12/AC13 require sending a real email to the provider; there is currently nowhere
      in the codebase to look up a provider's address. `userRepository.ts` itself needs no
      logic change (only the `User` type it re-exports changes via the fixture import).

  - description: |
      `ApplicationController` — thin HTTP handlers mirroring `authController.ts`'s
      `{status, body}` pattern for the JSON routes, plus a dedicated streaming handler for SSE
      that gets the raw `ServerResponse` (SSE can't return a buffered `{status, body}`).
      ```ts
      export function handleSubmit(applicationService: ApplicationService, applicationId: string, auth: AccessTokenPayload | null): ControllerResponse
      export function handleGetStatus(applicationService: ApplicationService, applicationId: string, auth: AccessTokenPayload | null): ControllerResponse
      export async function handleTransition(applicationService: ApplicationService, applicationId: string, auth: AccessTokenPayload | null, body: unknown): Promise<ControllerResponse>
      export function handleStatusStream(res: ServerResponse, eventBus: ApplicationEventBus, applicationService: ApplicationService, applicationId: string, auth: AccessTokenPayload | null): void
      ```
      `handleGetStatus`/`handleSubmit`/`handleStatusStream` return 403 when
      `auth.userId !== application.providerId` (AC10); `handleTransition` returns 403 unless
      `auth.role === "admin"`.
    files:
      - src/applications/applicationController.ts
    rationale: |
      Keeps route logic thin and testable independent of `node:http`, consistent with
      `authController.ts`; the SSE handler is the one exception that must own the response
      stream directly.

  - description: |
      Wire the new routes and dependencies into the existing router/DI container.
      ```ts
      // src/app.ts — new routes added to handleRequest's route matching:
      // POST /applications/:id/submit
      // GET  /applications/:id/status
      // GET  /applications/:id/status/stream   (text/event-stream, not JSON)
      // POST /applications/:id/transition       (admin only)
      ```
      `AppDependencies` gains optional `applicationRepository`, `credentialDocumentRepository`,
      `emailSender`, `adminAlertSender`, `eventBus` — defaulted the same way
      `sessionRepository`/`userRepository` already are (`deps.x ?? new X()`).
    files:
      - src/app.ts
    rationale: |
      `app.ts` is the single composition root today; new routes/dependencies must follow its
      existing `??` default-injection convention so tests can inject fakes exactly like
      `login.test.ts` does for `sessionRepository`.

tests:
  - |
    AC1 — submitting with at least one credential document moves the application to
    'submitted'. Seed a draft application + one credential document directly via the
    repositories (no upload endpoint exists), then POST submit:
    ```ts
    const app = applicationRepository.add({ id: "app-1", providerId: provider.id, state: "draft", createdAt: now, updatedAt: now });
    credentialDocumentRepository.add("app-1");
    const res = await fetch(`${baseUrl}/applications/app-1/submit`, { method: "POST", headers: { Authorization: `Bearer ${providerToken}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.state, "submitted");
    ```
  - |
    AC2 — after submitting, the status page shows a submission confirmation. GET status
    immediately after the AC1 submit call:
    ```ts
    const res = await fetch(`${baseUrl}/applications/app-1/status`, { headers: { Authorization: `Bearer ${providerToken}` } });
    const body = await res.json();
    assert.equal(body.state, "submitted");
    assert.equal(body.message, "Your application has been submitted successfully.");
    ```
  - |
    AC3 — every state is displayed clearly on the status page. Table-drive over all four
    post-submission states, seeding each directly:
    ```ts
    for (const state of ["submitted", "under_review", "approved", "rejected"] as const) {
      applicationRepository.add({ id: `app-${state}`, providerId: provider.id, state, rejectionReason: state === "rejected" ? "missing license" : undefined, createdAt: now, updatedAt: now });
      const res = await fetch(`${baseUrl}/applications/app-${state}/status`, { headers: { Authorization: `Bearer ${providerToken}` } });
      const body = await res.json();
      assert.equal(body.state, state);
    }
    ```
  - |
    AC4 — a rejected application's status page shows the full rejection reason text. Seed a
    rejected application with a long, specific reason and assert it round-trips verbatim:
    ```ts
    const reason = "Your nursing license (#12345) could not be verified against the state registry. Please re-upload a clearer scan.";
    applicationRepository.add({ id: "app-rejected", providerId: provider.id, state: "rejected", rejectionReason: reason, createdAt: now, updatedAt: now });
    const body = await (await fetch(`${baseUrl}/applications/app-rejected/status`, { headers: { Authorization: `Bearer ${providerToken}` } })).json();
    assert.equal(body.rejectionReason, reason);
    ```
  - |
    AC5 — each of the three listed transitions sends the provider an email reflecting the new
    state. Inject a fake `EmailSender` and drive each transition via the admin endpoint:
    ```ts
    const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
    const emailSender = { send: async (to, subject, body) => { sentEmails.push({ to, subject, body }); } };
    // ...transition submitted -> under_review via POST /applications/app-1/transition as admin...
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].subject, /under_review/);
    assert.equal(sentEmails[0].to, "provider1@example.com");
    ```
  - |
    AC6 — the rejection email includes the rejection reason. Transition under_review -> rejected
    with a reason via the admin endpoint and inspect the captured email body:
    ```ts
    await fetch(`${baseUrl}/applications/app-1/transition`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ state: "rejected", rejectionReason: "Missing background check" }) });
    assert.match(sentEmails.at(-1)!.body, /Missing background check/);
    ```
  - |
    AC7 — a rejected application's status page shows a call-to-action to correct and resubmit:
    ```ts
    const body = await (await fetch(`${baseUrl}/applications/app-rejected/status`, { headers: { Authorization: `Bearer ${providerToken}` } })).json();
    assert.equal(body.cta, "Please correct the issues noted above and resubmit your application.");
    ```
  - |
    AC8 — submitting without any uploaded credential document is rejected with a clear error.
    Seed a draft application with zero documents:
    ```ts
    applicationRepository.add({ id: "app-nodocs", providerId: provider.id, state: "draft", createdAt: now, updatedAt: now });
    const res = await fetch(`${baseUrl}/applications/app-nodocs/submit`, { method: "POST", headers: { Authorization: `Bearer ${providerToken}` } });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "At least one credential document is required before you can submit your application.");
    ```
  - |
    AC9 — an open status page connection reflects a state change without a manual refresh.
    Open the SSE stream, then trigger a transition, and assert the pushed event carries the new
    state:
    ```ts
    const streamRes = await fetch(`${baseUrl}/applications/app-1/status/stream`, { headers: { Authorization: `Bearer ${providerToken}` } });
    const reader = streamRes.body!.getReader();
    await fetch(`${baseUrl}/applications/app-1/transition`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ state: "under_review" }) });
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    assert.match(chunk, /data: .*"state":"under_review"/);
    reader.cancel();
    ```
  - |
    AC10 — a provider can only see their own application. Seed applications for two different
    providers and assert cross-access is forbidden and leaks nothing:
    ```ts
    applicationRepository.add({ id: "app-other", providerId: otherProvider.id, state: "submitted", createdAt: now, updatedAt: now });
    const res = await fetch(`${baseUrl}/applications/app-other/status`, { headers: { Authorization: `Bearer ${providerToken}` } });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal("state" in body, false);
    ```
  - |
    AC11 — status page accessibility (keyboard navigation, screen-reader compatibility, WCAG 2.1
    AA colour contrast). This repository is a backend-only HTTP service with no frontend/UI code
    at all (confirmed: only `src/{auth,sessions,users}` plus `app.ts`/`server.ts` exist), so
    there is no rendered page for `node:test` to exercise here. No test is added for this AC in
    this plan; it must be covered by an automated accessibility test (e.g. axe-core or
    Lighthouse CI against the actual rendered page) in whichever frontend project consumes this
    API, once that project exists. Flagged in `assumptions_or_open_questions`.
  - |
    AC12 — a notification that fails then succeeds within the retry limit does not raise an
    admin alert. Inject an `EmailSender` that throws twice then succeeds, and an
    `AdminAlertSender` spy:
    ```ts
    let attempts = 0;
    const emailSender = { send: async () => { attempts += 1; if (attempts < 3) throw new Error("smtp timeout"); } };
    const adminAlertSender = { raise: async () => { raised.push(1); } };
    // ...trigger submitted -> under_review transition...
    assert.equal(attempts, 3);
    assert.equal(raised.length, 0);
    ```
  - |
    AC13 — a notification that fails on every retry attempt raises an admin alert. Inject an
    `EmailSender` that always throws:
    ```ts
    const emailSender = { send: async () => { throw new Error("smtp down"); } };
    const alerts: Array<{ applicationId: string }> = [];
    const adminAlertSender = { raise: async (alert) => { alerts.push(alert); } };
    // ...trigger submitted -> under_review transition...
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].applicationId, "app-1");
    ```
  - |
    AC14 — a corrected, resubmitted rejected application moves back to 'submitted'. Seed a
    rejected application with a fresh credential document (simulating the correction) and
    resubmit:
    ```ts
    applicationRepository.add({ id: "app-resubmit", providerId: provider.id, state: "rejected", rejectionReason: "old reason", createdAt: now, updatedAt: now });
    credentialDocumentRepository.add("app-resubmit");
    const res = await fetch(`${baseUrl}/applications/app-resubmit/submit`, { method: "POST", headers: { Authorization: `Bearer ${providerToken}` } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).state, "submitted");
    ```
  - |
    AC15 — after a resubmission, the prior rejection reason is no longer shown. Immediately
    following the AC14 resubmission, GET status and assert the field is gone:
    ```ts
    const body = await (await fetch(`${baseUrl}/applications/app-resubmit/status`, { headers: { Authorization: `Bearer ${providerToken}` } })).json();
    assert.equal("rejectionReason" in body, false);
    ```

assumptions_or_open_questions:
  - |
    Credential document upload has no existing implementation or HTTP endpoint in this repo.
    This plan adds only a minimal `CredentialDocumentRepository` seam (`add`/`countByApplicationId`)
    so submission can enforce/tests can seed the "at least one document" precondition; building
    the actual upload feature is assumed to be a separate story.
  - |
    Draft-application creation (e.g. on provider registration) has no existing endpoint either.
    Tests seed a `draft` `Application` directly via `ApplicationRepository`, the same way
    `login.test.ts` seeds `SessionRepository` directly — consistent with this being a
    backend-service-only repo with no onboarding flow built yet.
  - |
    AC11 (keyboard navigation, screen-reader compatibility, WCAG 2.1 AA contrast) applies to a
    rendered UI page. This repository has no frontend of any kind (only an HTTP JSON/SSE
    service), so it is explicitly out of scope for this plan and must be verified in the
    frontend project that consumes this API — see the AC11 entry in `tests`.
  - |
    No admin-review-queue story/endpoint exists yet. This plan adds a minimal
    `POST /applications/:id/transition` admin-only endpoint purely as the seam that exercises
    notifications/SSE (AC5/6/9/12/13); it is not a full admin review workflow/UI, which is
    assumed to belong to a separate story.
  - |
    `User` currently has no `email` field. This plan adds one (and a fixture value) solely to
    give `NotificationService` a delivery address — no other behaviour of the existing
    login/session code changes.
  - |
    Retry policy for notification emails is implemented as `NOTIFICATION_MAX_ATTEMPTS = 3`
    immediate sequential attempts with no backoff/delay, since no specific retry count or
    backoff strategy was specified in the story.
  - |
    Real email delivery (an actual SMTP/provider integration) is out of scope; `EmailSender` is
    an interface with a console-logging default implementation. Wiring a real provider is a
    follow-up and is why no new email-sending package is listed under `package_dependencies`.
  - |
    AC9 real-time delivery is implemented as Server-Sent Events (one-way server push) rather
    than WebSockets, since the requirement is one-directional (server -> status page) and SSE
    needs no new dependency on top of `node:http`.

package_dependencies: []

notes: |
  This is a small, backend-only, zero-runtime-dependency Node service (`node --experimental-strip-types`,
  `node:test`, no framework/DB). The only existing feature is login/session management
  (`src/auth`, `src/sessions`, `src/users`); there is no prior "applications"/"credentials"
  domain to extend, so this plan is necessarily greenfield within `src/applications/`, built to
  match the exact conventions already in place: `Map`-backed repositories with
  optional-constructor-arg fixtures, services taking repositories via constructor injection,
  thin controllers returning `{status, body}`, and `AppDependencies` defaulting each dependency
  with `deps.x ?? new X()`. Every new piece of infrastructure (retry, pub/sub, SSE) is built from
  Node built-ins already used elsewhere in the repo (`node:crypto`, and newly `node:events`), so
  `package_dependencies` is empty by design, not by omission.

  ```mermaid
  flowchart TD
    app["src/app.ts (router)"]:::touched
    ctrl["applicationController.ts"]:::touched
    svc["applicationService.ts"]:::touched
    repo["applicationRepository.ts"]:::touched
    docRepo["credentialDocumentRepository.ts"]:::touched
    notif["notificationService.ts"]:::touched
    bus["applicationEventBus.ts"]:::touched
    tok["auth/tokenService.ts\n(+authenticateRequest)"]:::touched
    users["users/userRepository.ts\n+ fixtures/testUsers.ts\n(+email field)"]:::touched
    httpUtils["httpUtils.ts\n(sendJson/asRecord/readJsonBody)"]:::context
    authCtrl["auth/authController.ts"]:::context

    app -->|"routes new endpoints"| ctrl
    app -->|"reuses existing helpers"| httpUtils
    app -.->|"existing routes, unchanged"| authCtrl
    ctrl -->|"authenticateRequest(...)"| tok
    ctrl -->|"submit/getStatus/transitionState"| svc
    svc -->|"find/add applications"| repo
    svc -->|"countByApplicationId (AC1/8 gate)"| docRepo
    svc -->|"notifyStateChange (AC5/6/12/13)"| notif
    svc -->|"publish (AC9)"| bus
    svc -->|"look up provider email"| users

    classDef touched fill:#f96,color:#000
    classDef context fill:#ddd,color:#000
  ```
