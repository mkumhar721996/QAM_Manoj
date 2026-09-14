summary: |
  Introduce a no-show auto-detection and enforcement engine for confirmed bookings. Today this
  repository (`qam-manoj-story-007-login-session-management`) only implements login/session
  management (`src/auth`, `src/sessions`, `src/users`) — there is no booking, payments, or
  notifications domain anywhere in the codebase yet. This plan adds that domain from scratch as a
  small, cohesive service slice: a `Booking`/`FinancialOutcome` model, an in-memory
  `BookingRepository`, a versioned `NoShowPolicyRepository` (grace period + financial outcome per
  version), two outbound "port" abstractions (`PaymentsInvoicingClient`, `NotificationsClient`)
  with in-memory fakes for testing, and a `NoShowDetectionService` that implements the actual rule
  engine described by the 13 acceptance criteria: cancellation guard, grace-period math, idempotent
  re-evaluation, financial-outcome resolution (including the "no policy configured" default),
  exactly one payments signal + two notifications per newly-detected no-show, and an audit
  timestamp. Each acceptance criterion gets one failing test first, written directly against the
  service (not through HTTP), then the minimal implementation to pass it.
scope:
  - description: |
      Add the booking domain model: `BookingStatus`, `FinancialOutcome`, and `Booking`.

      ```ts
      export type BookingStatus = "confirmed" | "cancelled" | "noshow";

      export interface FinancialOutcome {
        type: "fee" | "no_charge";
        amount: number;
        policyId?: string;
        policyVersion?: number;
      }

      export interface Booking {
        id: string;
        customerId: string;
        providerId: string;
        service: string;
        appointmentTime: number; // epoch ms
        policyId?: string;
        status: BookingStatus;
        cancellationConfirmedAt?: number;
        noShowDetectedAt?: number;
        financialOutcome?: FinancialOutcome;
      }
      ```
    files:
      - src/bookings/bookingModel.ts
    rationale: |
      Establishes the vocabulary every other new file depends on. Mirrors the shape of
      `src/sessions/sessionModel.ts` (plain interface, no class) already used in this repo.

  - description: |
      Add `BookingRepository`, an in-memory Map-based store mirroring the style of
      `src/sessions/sessionRepository.ts` (constructor-less, `Map<string, Booking>`, plain methods,
      no framework).

      ```ts
      export class BookingRepository {
        create(input: {
          id: string; customerId: string; providerId: string; service: string;
          appointmentTime: number; policyId?: string;
        }): Booking;
        findById(id: string): Booking | undefined;
        update(booking: Booking): void;
        recordCancellation(id: string, now: number): Booking;
        list(): Booking[];
      }
      ```

      `recordCancellation` only transitions a booking out of `"confirmed"` into `"cancelled"`
      (matching the design's simulator, where "Record confirmed cancellation" is only enabled
      while status is Confirmed) — it is a no-op guard against overwriting an existing `"noshow"`
      status.
    files:
      - src/bookings/bookingRepository.ts
    rationale: |
      Needed so `NoShowDetectionService` and the tests have somewhere to read/write booking state.
      No booking storage of any kind exists in the repo today.

  - description: |
      Add a versioned no-show policy model + repository. A policy has an ordered list of versions;
      the most recently added version is always "current" and is what future detections use (AC6).
      A booking's own `financialOutcome` is written once at detection time and never recomputed, so
      past no-shows keep the outcome that was in effect when they were detected even after the
      policy is updated later.

      ```ts
      export interface NoShowPolicyVersion {
        version: number;
        gracePeriodMinutes: number;
        outcomeType: "fee" | "no_charge";
        feeAmount: number;
        effectiveFrom: number;
      }

      export interface NoShowPolicy {
        id: string;
        versions: NoShowPolicyVersion[];
      }
      ```

      ```ts
      export class NoShowPolicyRepository {
        create(
          id: string,
          initial: { gracePeriodMinutes: number; outcomeType: "fee" | "no_charge"; feeAmount: number },
          effectiveFrom: number,
        ): NoShowPolicy;
        addVersion(
          id: string,
          next: { gracePeriodMinutes: number; outcomeType: "fee" | "no_charge"; feeAmount: number },
          effectiveFrom: number,
        ): NoShowPolicy;
        currentVersion(id: string): NoShowPolicyVersion | undefined;
      }
      ```
    files:
      - src/noshow/noShowPolicyModel.ts
      - src/noshow/noShowPolicyRepository.ts
    rationale: |
      Directly reflects the design's "No-Show Policies" screen (Standard Grace Policy v2 with a
      version history table showing v1 → v2, and a banner: "This policy governs any no-show
      detected from now on. Bookings already marked no-show keep the outcome that was in effect at
      detection time.") — that sentence is the exact rule AC6 requires and is what this repository
      implements.

  - description: |
      Add a `PaymentsInvoicingClient` port (interface) plus an `InMemoryPaymentsInvoicingClient`
      fake that records every signal sent, mirroring the design's "Payments & Invoicing signal log"
      screen (one row per booking, first time only).

      ```ts
      export interface NoShowFinancialSignal {
        bookingId: string;
        outcome: FinancialOutcome;
        signalledAt: number;
      }

      export interface PaymentsInvoicingClient {
        signalNoShowOutcome(signal: NoShowFinancialSignal): void;
      }

      export class InMemoryPaymentsInvoicingClient implements PaymentsInvoicingClient {
        signals: NoShowFinancialSignal[] = [];
        signalNoShowOutcome(signal: NoShowFinancialSignal): void {
          this.signals.push(signal);
        }
      }
      ```
    files:
      - src/payments/paymentsInvoicingClient.ts
    rationale: |
      Payments & Invoicing is explicitly a separate system this epic delegates financial execution
      to ("financial execution is delegated to Payments & Invoicing"), and no such service or
      client exists anywhere in this repo. A port + in-memory fake is the correct minimal seam:
      it lets the detection rule (exactly one signal per new no-show, correct outcome shape) be
      fully tested now, without inventing a wire protocol/HTTP client for a system whose contract
      isn't specified anywhere in this codebase or the story.

  - description: |
      Add a `NotificationsClient` port plus an `InMemoryNotificationsClient` fake that records every
      notification sent, mirroring the design's "Notifications" screen (customer message with the
      financial outcome highlighted; provider message with booking + customer + location details).

      ```ts
      export interface NoShowNotification {
        bookingId: string;
        recipient: "customer" | "provider";
        sentAt: number;
        payload: Record<string, unknown>;
      }

      export interface NotificationsClient {
        notifyCustomerNoShow(booking: Booking, now: number): void;
        notifyProviderNoShow(booking: Booking, now: number): void;
      }

      export class InMemoryNotificationsClient implements NotificationsClient {
        sent: NoShowNotification[] = [];
        notifyCustomerNoShow(booking: Booking, now: number): void {
          this.sent.push({
            bookingId: booking.id,
            recipient: "customer",
            sentAt: now,
            payload: { service: booking.service, appointmentTime: booking.appointmentTime, financialOutcome: booking.financialOutcome },
          });
        }
        notifyProviderNoShow(booking: Booking, now: number): void {
          this.sent.push({
            bookingId: booking.id,
            recipient: "provider",
            sentAt: now,
            payload: {
              bookingId: booking.id, customerId: booking.customerId, service: booking.service,
              appointmentTime: booking.appointmentTime, financialOutcome: booking.financialOutcome,
            },
          });
        }
      }
      ```
    files:
      - src/notifications/notificationsClient.ts
    rationale: |
      Same reasoning as the payments port: Notifications is a separate system in this product, not
      present in this repo, so a testable seam is the correct minimal scope. The payload shapes are
      taken directly from the design's message-card copy (customer body highlights the outcome;
      provider body lists customer, service, time, location).

  - description: |
      Add `NoShowDetectionService`, the actual rule engine, constructed with the four
      repositories/ports above.

      ```ts
      export class BookingNotFoundError extends Error {
        constructor(bookingId: string) { super(`Booking not found: ${bookingId}`); }
      }

      export class NoShowDetectionService {
        constructor(
          private bookingRepository: BookingRepository,
          private policyRepository: NoShowPolicyRepository,
          private paymentsClient: PaymentsInvoicingClient,
          private notificationsClient: NotificationsClient,
        ) {}

        detect(bookingId: string, now: number = Date.now()): Booking {
          const booking = this.bookingRepository.findById(bookingId);
          if (!booking) throw new BookingNotFoundError(bookingId);
          if (booking.status !== "confirmed") return booking; // AC10 idempotency / already cancelled
          if (now < booking.appointmentTime) return booking; // appointment hasn't happened yet

          const policyVersion = booking.policyId ? this.policyRepository.currentVersion(booking.policyId) : undefined;
          const graceMs = (policyVersion?.gracePeriodMinutes ?? 0) * 60_000;
          if (now - booking.appointmentTime < graceMs) return booking; // AC7 not yet due

          const outcome: FinancialOutcome = policyVersion
            ? { type: policyVersion.outcomeType, amount: policyVersion.outcomeType === "fee" ? policyVersion.feeAmount : 0,
                policyId: booking.policyId, policyVersion: policyVersion.version }
            : { type: "no_charge", amount: 0 }; // AC8/AC9 no-policy default

          booking.status = "noshow";
          booking.noShowDetectedAt = now; // AC5
          booking.financialOutcome = outcome;
          this.bookingRepository.update(booking);

          this.paymentsClient.signalNoShowOutcome({ bookingId: booking.id, outcome, signalledAt: now }); // AC3
          this.notificationsClient.notifyCustomerNoShow(booking, now); // AC4/AC12
          this.notificationsClient.notifyProviderNoShow(booking, now); // AC4/AC13

          return booking;
        }

        detectAll(now: number = Date.now()): Booking[] {
          return this.bookingRepository.list()
            .filter((b) => b.status === "confirmed")
            .map((b) => this.detect(b.id, now));
        }
      }
      ```
    files:
      - src/noshow/noShowDetectionService.ts
    rationale: |
      This one method is where every acceptance criterion actually lives: the cancellation/no-op
      guard (AC2, AC10, AC11), the grace-period comparison (AC1, AC7), the no-policy default
      (AC8, AC9), the single signal + double notification (AC3, AC4), and the audit timestamp
      (AC5). `detectAll` is a thin convenience for evaluating every confirmed booking in one pass
      (what the design's "Run detection sweep" button visually represents) — no AC requires a
      specific scheduling/HTTP mechanism, so nothing beyond this plain iteration helper is built.

  - description: |
      Add the test file with one `node:test` per acceptance criterion, run directly against
      `NoShowDetectionService` and its in-memory fakes (no HTTP layer — see
      `assumptions_or_open_questions` for why).
    files:
      - test/noShowDetection.test.ts
    rationale: |
      Follows this repo's existing `node:test` + `node:assert/strict` convention (see
      `test/login.test.ts`, `test/logout.test.ts`), adapted to unit-test the service directly
      instead of over HTTP, since these tests are inherently about controlling a simulated clock.
tests:
  - |
    AC1 — grace period elapses with no cancellation → auto no-show.
    ```ts
    test("AC1: booking is marked no-show once the 15-minute grace period elapses with no confirmed cancellation", () => {
      const { bookingRepository, policyRepository, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      const result = service.detect(booking.id, apptTime + 15 * 60_000);

      assert.equal(result.status, "noshow");
    });
    ```
  - |
    AC2 — confirmed cancellation before the appointment time prevents a no-show.
    ```ts
    test("AC2: a confirmed cancellation recorded before the appointment time passes prevents a no-show", () => {
      const { bookingRepository, policyRepository, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
      bookingRepository.recordCancellation(booking.id, apptTime - 5 * 60_000);

      const result = service.detect(booking.id, apptTime + 20 * 60_000);

      assert.equal(result.status, "cancelled");
    });
    ```
  - |
    AC3 — no-show status update signals the configured financial outcome to Payments & Invoicing.
    ```ts
    test("AC3: marking a booking no-show signals the configured financial outcome to Payments & Invoicing", () => {
      const { bookingRepository, policyRepository, payments, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      service.detect(booking.id, apptTime + 15 * 60_000);

      assert.equal(payments.signals.length, 1);
      assert.deepEqual(payments.signals[0].outcome, { type: "fee", amount: 22.5, policyId: "standard-grace", policyVersion: 1 });
    });
    ```
  - |
    AC4 — no-show status update notifies both the customer and the provider.
    ```ts
    test("AC4: marking a booking no-show notifies both the customer and the provider", () => {
      const { bookingRepository, policyRepository, notifications, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      service.detect(booking.id, apptTime + 15 * 60_000);

      const recipients = notifications.sent.map((n) => n.recipient).sort();
      assert.deepEqual(recipients, ["customer", "provider"]);
    });
    ```
  - |
    AC5 — no-show record update logs a timestamp for auditability.
    ```ts
    test("AC5: a no-show status update logs the detection timestamp on the booking", () => {
      const { bookingRepository, policyRepository, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
      const detectedAt = apptTime + 15 * 60_000;

      const result = service.detect(booking.id, detectedAt);

      assert.equal(result.noShowDetectedAt, detectedAt);
    });
    ```
  - |
    AC6 — an updated policy governs subsequently detected no-shows, past no-shows keep their original outcome.
    ```ts
    test("AC6: an updated no-show policy governs the outcome of subsequently detected no-shows only", () => {
      const { bookingRepository, policyRepository, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 45 }, apptTime - 1000);
      const bookingA = bookingRepository.create({ id: "BKG-A", customerId: "cust-a", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
      service.detect(bookingA.id, apptTime + 15 * 60_000);

      policyRepository.addVersion("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime + 20 * 60_000);
      const laterApptTime = apptTime + 60 * 60_000;
      const bookingB = bookingRepository.create({ id: "BKG-B", customerId: "cust-b", providerId: "prov-1", service: "Haircut", appointmentTime: laterApptTime, policyId: "standard-grace" });
      const resultB = service.detect(bookingB.id, laterApptTime + 15 * 60_000);

      assert.equal(resultB.financialOutcome?.amount, 22.5);
      assert.equal(resultB.financialOutcome?.policyVersion, 2);
      assert.equal(bookingRepository.findById(bookingA.id)?.financialOutcome?.amount, 45);
    });
    ```
  - |
    AC7 — only 10 of the 15 grace-period minutes elapsed → not yet marked no-show.
    ```ts
    test("AC7: booking is not yet marked no-show when only 10 of 15 grace-period minutes have elapsed", () => {
      const { bookingRepository, policyRepository, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      const result = service.detect(booking.id, apptTime + 10 * 60_000);

      assert.equal(result.status, "confirmed");
    });
    ```
  - |
    AC8 — no applicable policy configured → still auto-marked no-show once the appointment time passes.
    ```ts
    test("AC8: a booking with no applicable no-show policy is marked no-show once the appointment time passes", () => {
      const { bookingRepository, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T08:30:00Z");
      const booking = bookingRepository.create({ id: "BKG-2", customerId: "cust-2", providerId: "prov-2", service: "Initial Consultation", appointmentTime: apptTime });

      const result = service.detect(booking.id, apptTime + 1000);

      assert.equal(result.status, "noshow");
    });
    ```
  - |
    AC9 — no applicable policy configured → financial outcome signalled is "no charge".
    ```ts
    test("AC9: a booking with no applicable no-show policy signals a 'no charge' outcome to Payments & Invoicing", () => {
      const { bookingRepository, payments, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T08:30:00Z");
      const booking = bookingRepository.create({ id: "BKG-2", customerId: "cust-2", providerId: "prov-2", service: "Initial Consultation", appointmentTime: apptTime });

      service.detect(booking.id, apptTime + 1000);

      assert.deepEqual(payments.signals[0].outcome, { type: "no_charge", amount: 0 });
    });
    ```
  - |
    AC10 — re-evaluating an already-no-show booking is a no-op (no duplicate signal or notification).
    ```ts
    test("AC10: re-evaluating an already no-show booking sends no additional signal or notification", () => {
      const { bookingRepository, policyRepository, payments, notifications, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      service.detect(booking.id, apptTime + 15 * 60_000);
      service.detect(booking.id, apptTime + 20 * 60_000);

      assert.equal(payments.signals.length, 1);
      assert.equal(notifications.sent.length, 2);
    });
    ```
  - |
    AC11 — a confirmed cancellation recorded immediately before detection still wins even after the appointment time has passed.
    ```ts
    test("AC11: a confirmed cancellation recorded immediately before detection prevents a no-show even after the appointment time has passed", () => {
      const { bookingRepository, policyRepository, payments, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
      const detectionTime = apptTime + 20 * 60_000;
      bookingRepository.recordCancellation(booking.id, detectionTime - 1);

      const result = service.detect(booking.id, detectionTime);

      assert.equal(result.status, "cancelled");
      assert.equal(payments.signals.length, 0);
    });
    ```
  - |
    AC12 — the customer no-show notification includes the financial outcome.
    ```ts
    test("AC12: the customer no-show notification includes the financial outcome", () => {
      const { bookingRepository, policyRepository, notifications, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      service.detect(booking.id, apptTime + 15 * 60_000);

      const customerNotification = notifications.sent.find((n) => n.recipient === "customer");
      assert.deepEqual(customerNotification?.payload.financialOutcome, { type: "fee", amount: 22.5, policyId: "standard-grace", policyVersion: 1 });
    });
    ```
  - |
    AC13 — the provider no-show notification includes the booking and customer details.
    ```ts
    test("AC13: the provider no-show notification includes the booking and customer details", () => {
      const { bookingRepository, policyRepository, notifications, service } = createHarness();
      const apptTime = Date.parse("2026-09-14T09:00:00Z");
      policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
      const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

      service.detect(booking.id, apptTime + 15 * 60_000);

      const providerNotification = notifications.sent.find((n) => n.recipient === "provider");
      assert.equal(providerNotification?.payload.bookingId, "BKG-1");
      assert.equal(providerNotification?.payload.customerId, "cust-1");
      assert.equal(providerNotification?.payload.service, "Haircut");
    });
    ```
assumptions_or_open_questions:
  - |
    This repository currently has zero booking, payments, or notifications code (it is a headless
    login/session HTTP service — `src/auth`, `src/sessions`, `src/users` only, per `package.json`'s
    own description "Login & Session Management service"). I am introducing the entire booking /
    no-show domain from scratch, scoped as tightly as I can to what the 13 ACs actually require.
  - |
    The approved design prototype (`.arc/designs/QAM-MANOJ-STORY-036-design.html`) shows a full
    5-screen "Booking Ops" console UI (Bookings Queue, Booking Detail simulator, No-Show Policies,
    Payments Signal Log, Notifications) with its own bespoke CSS token set. This repo has no
    frontend framework, templating engine, or static-asset serving of any kind — `src/app.ts` is a
    raw `node:http` JSON request router. There is nothing to build those screens into without
    inventing a UI stack this work item's actual codebase doesn't have and no AC calls for. I am
    treating the prototype purely as the source of truth for the domain vocabulary and behavior it
    demonstrates (booking fields, status badges, policy versioning banner text, payments-signal-log
    columns, notification message content) — which is what the data model and test assertions
    below are built from — and flagging that turning it into literal rendered screens is a separate,
    currently out-of-scope task until this repo has a frontend layer.
  - |
    No AC specifies an HTTP/API contract (routes, request/response shapes) for triggering
    detection, recording a cancellation, or configuring a policy — unlike the existing `/auth/*`
    routes, which is why `src/app.ts` isn't touched by this plan. I deliberately did not invent
    routes for this, since the ACs and design are both about the detection *behavior*, not a wire
    format; that would be speculative scope. Wiring these services behind HTTP endpoints (and
    behind a real scheduler/interval or the Payments & Invoicing / Notifications systems' real
    wire protocols once those are specified) is a natural follow-up, not part of this plan.
  - |
    Tests call `NoShowDetectionService.detect(bookingId, now)` with an explicit `now` rather than
    going through HTTP, because the ACs hinge on simulated elapsed time (10 vs 15 minutes) that
    can't be tested by real-time waiting. This mirrors `AuthService.login(username, password, now)`
    already taking an injectable `now` in this codebase (`src/auth/authService.ts`) — the
    difference is I'm not exposing a client-suppliable clock over HTTP anywhere, since that would
    be a genuine security/integrity smell for a production endpoint.
  - |
    The design shows fees computed as a percentage of a service's price (e.g. "50% of $45.00 service
    = $22.50"). No service-pricing/catalog concept exists anywhere in this repo, so each policy
    version stores a concrete resolved `feeAmount` rather than a percentage formula. Open question
    for a future item: once a service/pricing catalog exists, should policies store a percentage and
    have the detection service (or Payments & Invoicing itself) resolve it against the booking's
    price at detection time?
  - |
    "Confirmed cancellation" is modeled simply as `BookingRepository.recordCancellation` flipping a
    `"confirmed"` booking to `"cancelled"` — matching the design's simulator, where the only gate is
    "booking must currently be confirmed." Neither the ACs nor the design describe a separate
    cancellation-approval workflow, so none is modeled.
package_dependencies: []
notes: |
  This is a self-contained new feature slice with no existing callers, so the diagram below shows
  the new modules' internal call shape rather than integration with pre-existing code (there is
  none to integrate with yet — `src/auth`, `src/sessions`, `src/users` are untouched by this plan).

  ```mermaid
  flowchart TD
    classDef touched fill:#f96,color:#000

    Test["test/noShowDetection.test.ts"]:::touched
    Service["NoShowDetectionService\nsrc/noshow/noShowDetectionService.ts"]:::touched
    BookingRepo["BookingRepository\nsrc/bookings/bookingRepository.ts"]:::touched
    PolicyRepo["NoShowPolicyRepository\nsrc/noshow/noShowPolicyRepository.ts"]:::touched
    Payments["PaymentsInvoicingClient port + in-memory fake\nsrc/payments/paymentsInvoicingClient.ts"]:::touched
    Notifications["NotificationsClient port + in-memory fake\nsrc/notifications/notificationsClient.ts"]:::touched
    Model["Booking / FinancialOutcome types\nsrc/bookings/bookingModel.ts"]:::touched

    Test -->|"constructs service + fakes, asserts detect() result & fake call logs"| Service
    Service -->|"findById / update / recordCancellation"| BookingRepo
    Service -->|"currentVersion() for grace period + outcome"| PolicyRepo
    Service -->|"signalNoShowOutcome() exactly once per new no-show"| Payments
    Service -->|"notifyCustomerNoShow() + notifyProviderNoShow() exactly once each"| Notifications
    BookingRepo --> Model
    Service --> Model
  ```

  Existing conventions this plan deliberately follows, read directly from the repo:
  - Map-based in-memory repositories with plain methods (`src/sessions/sessionRepository.ts`),
    no ORM/database anywhere in this project.
  - Constructor-injected dependencies on a plain class, no DI framework
    (`src/auth/authService.ts`'s `AuthService(userRepository, sessionRepository)`).
  - An injectable `now: number = Date.now()` parameter on time-sensitive methods
    (`AuthService.login`, `SessionRepository.isValid`).
  - `node:test` + `node:assert/strict`, one `test(...)` per acceptance criterion, AC number named
    in the test title (`test/login.test.ts`, `test/logout.test.ts`).
  - No third-party dependencies anywhere in `package.json` (`"dependencies": {}`) — this plan adds
    none either.
