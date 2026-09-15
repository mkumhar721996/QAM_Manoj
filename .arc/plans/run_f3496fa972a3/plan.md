summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is a headless Node `http` API with
  `auth/`, `sessions/`, `users/`, `pizzas/`, and `cart/` modules, all following the same
  repository -> service -> controller layering, in-memory `Map`-backed repositories (no DB),
  snake_case JSON wire format, and `node:test` + raw `fetch` against an ephemeral
  `startTestServer()` for tests. There is no payments, booking, invoicing, or provider-disbursement
  domain anywhere in the codebase yet - this story is the first piece of the "Payments &
  Invoicing" epic to land here. It adds a new `src/cancellations/` module that receives a
  cancellation-outcome event from Booking & Scheduling over a new internal HTTP endpoint
  (`POST /payments/cancellations`), and executes the refund/disbursement split: full refund to the
  customer's original payment method for a fully-refundable outcome, or a split of
  refund-to-customer + (non-refundable amount minus service fee) disbursement-to-provider for a
  partial outcome, logging every processed event. Money movement is modeled behind a small
  `StripeGateway` interface (a real REST adapter using native `fetch` against Stripe's HTTP API,
  mirroring how `tokenService.ts` hand-rolls JWT signing instead of pulling in a library, so no new
  npm dependency is introduced) that is injectable via `AppDependencies`, exactly like
  `SessionRepository`/`CartRepository` are today, so tests can substitute a fake gateway and assert
  on the calls it recorded instead of hitting the real Stripe network.
scope:
  - description: |
      Write the failing acceptance tests first, covering all 6 ACs against the not-yet-existing
      `POST /payments/cancellations` route, using a `FakeStripeGateway` test double (defined in the
      test file itself, since it is a test seam, not shared fixture data) injected via
      `AppDependencies`. These must fail (404/import errors) before any implementation exists.
    files:
      - "test/cancellationPayment.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before writing any production
      code, matching the existing `test/login.test.ts` style of injecting a real repository and
      asserting on it directly after an HTTP call (see AC8 in `login.test.ts` checking
      `sessionRepository.countByUserId` post-request) - here the equivalent seam is
      `cancellationLogRepository` plus the `FakeStripeGateway`'s recorded calls.
  - description: |
      Add the cancellation domain model, modeled on `src/sessions/sessionModel.ts`.

      ```ts
      // src/cancellations/cancellationModel.ts
      export type CancellationOutcome = "full_refund" | "partial_refund";

      export interface CancellationEvent {
        bookingId: string;
        actorId: string;
        outcome: CancellationOutcome;
        paymentIntentId: string;
        providerId?: string;
        refundAmountCents: number;
        nonRefundableAmountCents: number;
        serviceFeeCents: number;
      }

      export interface CancellationLogEntry {
        id: string;
        bookingId: string;
        actorId: string;
        refundAmountCents: number;
        nonRefundableAmountCents: number;
        timestamp: number;
      }
      ```
    files:
      - "src/cancellations/cancellationModel.ts"
    rationale: |
      A single shared shape for the inbound event and the audit-log entry that every layer below
      (service, controller, tests) refers to, matching how `sessionModel.ts` is the shared
      `Session` shape for `sessionRepository.ts`/`authService.ts`.
  - description: |
      Add the `StripeGateway` port and a real REST adapter, modeled on the manual-crypto style of
      `src/auth/tokenService.ts` (no `stripe` SDK dependency - plain `fetch` against Stripe's HTTP
      API, matching this codebase's existing zero-third-party-dependency convention for
      security/payment primitives).

      ```ts
      // src/cancellations/stripeGateway.ts
      export interface RefundResult { id: string; amountCents: number; }
      export interface DisbursementResult { id: string; amountCents: number; }

      export interface StripeGateway {
        refund(paymentIntentId: string, amountCents: number): Promise<RefundResult>;
        disburseToProvider(providerId: string, amountCents: number): Promise<DisbursementResult>;
      }

      export class StripeApiGateway implements StripeGateway {
        constructor(private secretKey: string) {}

        async refund(paymentIntentId: string, amountCents: number): Promise<RefundResult> {
          const res = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ payment_intent: paymentIntentId, amount: String(amountCents) }),
          });
          if (!res.ok) throw new Error(`Stripe refund failed: ${res.status}`);
          const body = (await res.json()) as { id: string };
          return { id: body.id, amountCents };
        }

        async disburseToProvider(providerId: string, amountCents: number): Promise<DisbursementResult> {
          const res = await fetch("https://api.stripe.com/v1/transfers", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ destination: providerId, amount: String(amountCents), currency: "usd" }),
          });
          if (!res.ok) throw new Error(`Stripe transfer failed: ${res.status}`);
          const body = (await res.json()) as { id: string };
          return { id: body.id, amountCents };
        }
      }
      ```
    files:
      - "src/cancellations/stripeGateway.ts"
    rationale: |
      AC1/AC2 require issuing the refund "via Stripe" and AC3 requires routing the non-refundable
      portion through the "normal provider disbursement path" - both are external money movement,
      so they must sit behind an interface the service depends on (`StripeGateway`), letting tests
      inject a fake and assert on exactly which calls were made with which amounts, without ever
      hitting the real Stripe network.
  - description: |
      Add an in-memory `CancellationLogRepository`, modeled directly on
      `src/sessions/sessionRepository.ts`.

      ```ts
      // src/cancellations/cancellationLogRepository.ts
      import crypto from "node:crypto";
      import type { CancellationLogEntry } from "./cancellationModel.ts";

      export class CancellationLogRepository {
        private entriesByBookingId: Map<string, CancellationLogEntry[]> = new Map();

        add(entry: Omit<CancellationLogEntry, "id">): CancellationLogEntry {
          const logEntry: CancellationLogEntry = { ...entry, id: crypto.randomUUID() };
          const entries = this.entriesByBookingId.get(entry.bookingId) ?? [];
          entries.push(logEntry);
          this.entriesByBookingId.set(entry.bookingId, entries);
          return logEntry;
        }

        findByBookingId(bookingId: string): CancellationLogEntry[] {
          return this.entriesByBookingId.get(bookingId) ?? [];
        }
      }
      ```
    files:
      - "src/cancellations/cancellationLogRepository.ts"
    rationale: |
      AC5 requires every processed refund/cancellation event to be logged with a timestamp, actor
      identifier, refund amount, and non-refundable amount - a per-booking in-memory store
      (matching the existing no-DB pattern) is the minimal way to make that assertion checkable by
      injecting the repository into `startTestServer()` and reading it back directly, the same way
      `test/login.test.ts` reads `sessionRepository` back after an HTTP call.
  - description: |
      Add `CancellationPaymentService` with the refund/disbursement split rules for AC1-AC6.

      ```ts
      // src/cancellations/cancellationPaymentService.ts
      export class InvalidCancellationEventError extends Error {}

      export interface CancellationExecutionResult {
        refundId: string;
        refundAmountCents: number;
        disbursementId?: string;
        disbursementAmountCents?: number;
      }

      export class CancellationPaymentService {
        constructor(
          private stripeGateway: StripeGateway,
          private cancellationLogRepository: CancellationLogRepository,
        ) {}

        async processCancellation(
          event: CancellationEvent,
          now: number = Date.now(),
        ): Promise<CancellationExecutionResult> {
          if (event.outcome === "partial_refund" && !event.providerId) {
            throw new InvalidCancellationEventError("provider_id is required for a partial refund outcome");
          }
          if (event.outcome === "partial_refund" && event.serviceFeeCents > event.nonRefundableAmountCents) {
            throw new InvalidCancellationEventError("service_fee_cents cannot exceed non_refundable_amount_cents");
          }

          const refund = await this.stripeGateway.refund(event.paymentIntentId, event.refundAmountCents);

          let disbursement: { id: string; amountCents: number } | undefined;
          if (event.outcome === "partial_refund" && event.nonRefundableAmountCents > 0) {
            const disbursementAmountCents = event.nonRefundableAmountCents - event.serviceFeeCents;
            disbursement = await this.stripeGateway.disburseToProvider(event.providerId!, disbursementAmountCents);
          }

          this.cancellationLogRepository.add({
            bookingId: event.bookingId,
            actorId: event.actorId,
            refundAmountCents: event.refundAmountCents,
            nonRefundableAmountCents: event.nonRefundableAmountCents,
            timestamp: now,
          });

          return {
            refundId: refund.id,
            refundAmountCents: refund.amountCents,
            disbursementId: disbursement?.id,
            disbursementAmountCents: disbursement?.amountCents,
          };
        }
      }
      ```
    files:
      - "src/cancellations/cancellationPaymentService.ts"
    rationale: |
      Centralises the full-vs-partial branching (refund only vs. refund + disbursement-minus-fee)
      and the "fee is never waived" rule from AC4/AC6 in one framework-agnostic place, mirroring how
      `CartService`/`AuthService` centralise their respective business rules rather than spreading
      them across the controller.
  - description: |
      Add `cancellationController.ts` with the HTTP handler, reusing the shared `ControllerResponse`
      type from `src/auth/authController.ts` and `asRecord` from `httpUtils.ts` for body parsing -
      same layering `cartController.ts` already uses.

      ```ts
      // src/cancellations/cancellationController.ts
      export async function handleCancellationEvent(
        service: CancellationPaymentService,
        requestBody: unknown,
      ): Promise<ControllerResponse> {
        const {
          booking_id: bookingId,
          actor_id: actorId,
          outcome,
          payment_intent_id: paymentIntentId,
          provider_id: providerId,
          refund_amount_cents: refundAmountCents,
          non_refundable_amount_cents: nonRefundableAmountCents,
          service_fee_cents: serviceFeeCents,
        } = asRecord(requestBody);

        if (
          typeof bookingId !== "string" ||
          typeof actorId !== "string" ||
          (outcome !== "full_refund" && outcome !== "partial_refund") ||
          typeof paymentIntentId !== "string" ||
          typeof refundAmountCents !== "number" ||
          typeof nonRefundableAmountCents !== "number" ||
          typeof serviceFeeCents !== "number" ||
          (providerId !== undefined && typeof providerId !== "string")
        ) {
          return { status: 400, body: { error: "invalid cancellation event payload" } };
        }

        try {
          const result = await service.processCancellation({
            bookingId, actorId, outcome, paymentIntentId, providerId,
            refundAmountCents, nonRefundableAmountCents, serviceFeeCents,
          });
          console.log(`cancellation processed for bookingId=${bookingId} outcome=${outcome}`);
          return {
            status: 200,
            body: {
              refund_id: result.refundId,
              refund_amount_cents: result.refundAmountCents,
              disbursement_id: result.disbursementId,
              disbursement_amount_cents: result.disbursementAmountCents,
            },
          };
        } catch (err) {
          if (err instanceof InvalidCancellationEventError) {
            return { status: 400, body: { error: err.message } };
          }
          throw err;
        }
      }
      ```
    files:
      - "src/cancellations/cancellationController.ts"
    rationale: |
      Keeps the HTTP-shape concerns (snake_case body, status codes) in the controller layer only,
      exactly like `authController.ts`/`cartController.ts`, so `CancellationPaymentService` stays
      HTTP-agnostic.
  - description: |
      Wire the new route into `src/app.ts`: instantiate `CancellationLogRepository`/`StripeApiGateway`/
      `CancellationPaymentService`, extend `AppDependencies` so tests can inject a fake gateway and a
      real (or fake) log repository, and add `POST /payments/cancellations` to the route table.

      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
        cancellationLogRepository?: CancellationLogRepository;
        stripeGateway?: StripeGateway;
      }
      ```

      ```ts
      if (route === "POST /payments/cancellations") {
        const body = await readJsonBody(req);
        const result = await handleCancellationEvent(cancellationPaymentService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```

      `createApp` default-constructs `deps.stripeGateway ?? new StripeApiGateway(process.env.STRIPE_SECRET_KEY ?? "")`
      so tests that don't care about Stripe calls still work without a real key, but any test that
      exercises this route in practice will inject a `FakeStripeGateway`.
    files:
      - "src/app.ts"
    rationale: |
      `createApp` is the single composition root today (constructs `UserRepository`,
      `SessionRepository`, `PizzaRepository`, `CartRepository`/`CartService` and dispatches on
      `${method} ${pathname}`) - the new module must be composed and routed the same way rather than
      starting a second server or router.
tests:
  - |
    AC1 - GIVEN Booking & Scheduling emits a cancellation event with a fully refundable outcome
    WHEN the event is received THEN the platform issues a full refund to the customer's original
    payment method via Stripe.

    ```ts
    test("AC1: a fully refundable outcome issues a full refund via Stripe", async () => {
      const stripeGateway = new FakeStripeGateway();
      const server = await startTestServer({ stripeGateway });
      try {
        const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: "booking-1", actor_id: "customer-1", outcome: "full_refund",
            payment_intent_id: "pi_123", refund_amount_cents: 5000,
            non_refundable_amount_cents: 0, service_fee_cents: 0,
          }),
        });
        assert.equal(res.status, 200);
        assert.deepEqual(stripeGateway.refundCalls, [{ paymentIntentId: "pi_123", amountCents: 5000 }]);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - GIVEN Booking & Scheduling emits a cancellation event with a partial refund outcome WHEN
    the event is received THEN the platform refunds the refundable portion to the customer's
    original payment method.

    ```ts
    test("AC2: a partial refund outcome refunds only the refundable portion", async () => {
      const stripeGateway = new FakeStripeGateway();
      const server = await startTestServer({ stripeGateway });
      try {
        const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: "booking-2", actor_id: "customer-1", outcome: "partial_refund",
            payment_intent_id: "pi_456", provider_id: "acct_789", refund_amount_cents: 3000,
            non_refundable_amount_cents: 2000, service_fee_cents: 500,
          }),
        });
        assert.equal(res.status, 200);
        assert.deepEqual(stripeGateway.refundCalls, [{ paymentIntentId: "pi_456", amountCents: 3000 }]);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN a partial refund outcome WHEN the event is received THEN the platform routes the
    non-refundable portion through the normal provider disbursement path (total non-refundable
    amount minus service fee).

    ```ts
    test("AC3: the non-refundable portion minus service fee is disbursed to the provider", async () => {
      const stripeGateway = new FakeStripeGateway();
      const server = await startTestServer({ stripeGateway });
      try {
        await fetch(`${server.baseUrl}/payments/cancellations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: "booking-3", actor_id: "customer-1", outcome: "partial_refund",
            payment_intent_id: "pi_789", provider_id: "acct_111", refund_amount_cents: 3000,
            non_refundable_amount_cents: 2000, service_fee_cents: 500,
          }),
        });
        assert.deepEqual(stripeGateway.disburseCalls, [{ providerId: "acct_111", amountCents: 1500 }]);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN a cancellation results in a non-refundable portion WHEN the service fee is
    calculated THEN the service fee is not waived; it is deducted from the non-refundable portion
    before disbursement to the provider.

    ```ts
    test("AC4: the service fee is never waived from the non-refundable portion", async () => {
      const stripeGateway = new FakeStripeGateway();
      const server = await startTestServer({ stripeGateway });
      try {
        await fetch(`${server.baseUrl}/payments/cancellations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: "booking-4", actor_id: "customer-1", outcome: "partial_refund",
            payment_intent_id: "pi_999", provider_id: "acct_222", refund_amount_cents: 1000,
            non_refundable_amount_cents: 4000, service_fee_cents: 700,
          }),
        });
        const [disbursed] = stripeGateway.disburseCalls;
        assert.equal(disbursed.amountCents, 4000 - 700);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 - GIVEN any refund or cancellation payment event WHEN the event is processed THEN it is
    logged with a timestamp, actor identifier, refund amount, and non-refundable amount.

    ```ts
    test("AC5: the processed event is logged with timestamp, actor, refund amount, non-refundable amount", async () => {
      const stripeGateway = new FakeStripeGateway();
      const cancellationLogRepository = new CancellationLogRepository();
      const server = await startTestServer({ stripeGateway, cancellationLogRepository });
      try {
        const before = Date.now();
        const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: "booking-5", actor_id: "customer-42", outcome: "partial_refund",
            payment_intent_id: "pi_555", provider_id: "acct_333", refund_amount_cents: 1200,
            non_refundable_amount_cents: 800, service_fee_cents: 100,
          }),
        });
        assert.equal(res.status, 200);

        const [entry] = cancellationLogRepository.findByBookingId("booking-5");
        assert.equal(entry.actorId, "customer-42");
        assert.equal(entry.refundAmountCents, 1200);
        assert.equal(entry.nonRefundableAmountCents, 800);
        assert.ok(entry.timestamp >= before && entry.timestamp <= Date.now());
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 - GIVEN a fully refundable outcome WHEN the full refund is issued to the customer THEN no
    service fee is deducted from the refunded amount.

    ```ts
    test("AC6: no service fee is deducted from a full refund", async () => {
      const stripeGateway = new FakeStripeGateway();
      const server = await startTestServer({ stripeGateway });
      try {
        await fetch(`${server.baseUrl}/payments/cancellations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: "booking-6", actor_id: "customer-1", outcome: "full_refund",
            payment_intent_id: "pi_777", refund_amount_cents: 6000,
            non_refundable_amount_cents: 0, service_fee_cents: 0,
          }),
        });
        const [refunded] = stripeGateway.refundCalls;
        assert.equal(refunded.amountCents, 6000);
        assert.equal(stripeGateway.disburseCalls.length, 0);
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - "This repo has no existing booking/payment-capture/invoice domain at all, so the 'cancellation event from Booking & Scheduling' is modeled as a new synchronous internal HTTP endpoint, POST /payments/cancellations, called service-to-service. There is no webhook signature verification or API-key auth on this endpoint, since no AC mentions one and no such mechanism exists elsewhere in this codebase (contrast with Stripe's own webhook signing, which is a different, external-facing concern) - please confirm this is acceptable for a first pass, or point to an existing internal-auth convention it should reuse."
  - "The event payload carries refund_amount_cents, non_refundable_amount_cents, and service_fee_cents as already-computed integers (in cents) rather than this service deriving them from a stored booking/invoice record, since no booking or invoice domain exists in this codebase yet for it to read from. AC4 ('WHEN the service fee is calculated') is read as 'this service must not waive/zero out a fee value it receives', not as 'this service must itself derive the fee rate from a policy engine'."
  - "No `stripe` npm package is added; Stripe is called via a hand-rolled REST adapter (`StripeApiGateway`, plain `fetch`), mirroring the existing convention of hand-rolling JWT in `src/auth/tokenService.ts` instead of adding a jsonwebtoken dependency. If the team would rather standardize on the official Stripe SDK now, that changes `package_dependencies` below and the `StripeApiGateway` implementation - flag if so."
  - "`actor_id` in the event is assumed to be an opaque identifier supplied by Booking & Scheduling (e.g. the customer, provider, or admin who triggered the cancellation) and is passed through to the log verbatim; this service does not validate it against `users/`."
  - "For a partial_refund outcome, provider_id is required (needed to route the disbursement); for a full_refund outcome it is not required/used, since AC1/AC6 involve no disbursement at all."
  - "Log storage is in-memory only (CancellationLogRepository, lost on process restart), matching the existing SessionRepository/CartRepository pattern - no persistence layer or queryable log-retrieval HTTP endpoint is introduced, since no AC asks for one; tests read the repository directly (same pattern as AC8 in test/login.test.ts reading sessionRepository directly)."
  - "If service_fee_cents exceeds non_refundable_amount_cents on a partial_refund event, this is treated as an invalid event (400, InvalidCancellationEventError) rather than clamping to zero, since no AC specifies the desired behavior for that edge case."
package_dependencies: []
notes: |
  No existing code in this repo references payments, Stripe, bookings, cancellations, invoices, or
  disbursement in any form (confirmed via a repo-wide search) - this is a greenfield module for
  this story, so it is built as a new `src/cancellations/` feature slice using the exact same
  layering every other feature in this repo already uses, rather than introducing a new
  architectural pattern.

  Layering/call-graph for the touched modules, plus their existing real callers/callees read while
  planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: routes + composition root)"]
    cancellationController["src/cancellations/cancellationController.ts (new)"]
    cancellationService["src/cancellations/cancellationPaymentService.ts (new)"]
    cancellationLogRepo["src/cancellations/cancellationLogRepository.ts (new)"]
    stripeGateway["src/cancellations/stripeGateway.ts (new)"]
    cancellationModel["src/cancellations/cancellationModel.ts (new)"]
    authController["src/auth/authController.ts (existing, untouched: ControllerResponse type)"]
    httpUtils["src/httpUtils.ts (existing, untouched)"]
    testFile["test/cancellationPayment.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]
    stripeApi["Stripe HTTP API (external)"]

    app -->|"routes POST /payments/cancellations"| cancellationController
    cancellationController -->|"asRecord()/body parsing"| httpUtils
    cancellationController -->|"imports ControllerResponse type"| authController
    cancellationController -->|"processCancellation()"| cancellationService
    cancellationService -->|"refund(), disburseToProvider()"| stripeGateway
    cancellationService -->|"add()"| cancellationLogRepo
    cancellationService -->|"uses"| cancellationModel
    stripeGateway -->|"fetch() POST /v1/refunds, /v1/transfers"| stripeApi
    testFile -->|"drives via fetch()"| app
    testFile -->|"startTestServer() with injected FakeStripeGateway"| testServer
    testFile -->|"asserts on recorded calls / log entries"| cancellationLogRepo

    classDef touched fill:#f96,color:#000
    class app,cancellationController,cancellationService,cancellationLogRepo,stripeGateway,cancellationModel,testFile touched
  ```
