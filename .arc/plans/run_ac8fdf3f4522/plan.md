summary: |
  This introduces the platform's first payments/disbursement domain: a Stripe chargeback
  webhook endpoint that automatically reverses or claws back provider disbursements. The
  codebase currently has no payments, transaction, payout, or notification concepts at all
  (only auth, sessions, pizzas, and cart — verified via `src/app.ts`, `src/cart/*`,
  `src/users/fixtures/testUsers.ts`), so this plan builds a minimal, in-memory payments
  module following the existing repository/service/controller conventions (mirroring
  `src/cart/cartRepository.ts` / `cartService.ts` / `cartController.ts`) and wires a new
  route into `src/app.ts`. On receiving a normalized Stripe "charge.dispute.created"
  webhook, the service resolves the transaction's provider, decides a reversal strategy
  (claw back a sufficient pending payout, hold future payouts, or directly claw back
  already-disbursed funds), notifies the admin and provider, and records an audit log
  entry, all in one synchronous request handling the webhook.

scope:
  - description: |
      Define the payments domain model types shared by the new repositories/services:
      `Transaction`, `Payout`/`PayoutStatus`, `ChargebackWebhookEvent`, `ReversalAction`,
      and `ChargebackReversal`.
      ```ts
      export type DisbursementStatus = "pending_payout" | "disbursed";
      export interface Transaction {
        id: string;
        stripeChargeId: string;
        providerId: string;
        amount: number;
        disbursementStatus: DisbursementStatus;
      }
      export type PayoutStatus = "pending" | "held" | "clawed_back";
      export interface Payout {
        id: string;
        providerId: string;
        amount: number;
        status: PayoutStatus;
        createdAt: number;
      }
      export type ReversalAction = "clawback_from_pending_payout" | "hold_future_payouts" | "direct_clawback";
      export interface ChargebackWebhookEvent {
        id: string;
        stripeChargeId: string;
        amount: number;
      }
      export interface ChargebackReversal {
        chargebackId: string;
        transactionId: string;
        providerId: string;
        amount: number;
        action: ReversalAction;
        createdAt: number;
      }
      ```
    files:
      - src/payments/paymentsModel.ts
    rationale: |
      Mirrors the existing pattern of small model files per domain (e.g.
      `src/cart/cartModel.ts`) so repositories/services share one typed vocabulary.

  - description: |
      Add `TransactionRepository`, seeded from a `testTransactions` fixture, indexed by
      Stripe charge id (the only identifier the webhook payload carries):
      ```ts
      export class TransactionRepository {
        constructor(transactions: Transaction[] = testTransactions)
        findByStripeChargeId(chargeId: string): Transaction | undefined
      }
      ```
    files:
      - src/payments/transactionRepository.ts
      - src/payments/fixtures/testTransactions.ts
    rationale: |
      Follows the `PizzaRepository` pattern (`src/pizzas/pizzaRepository.ts`): in-memory
      `Map` seeded from a fixtures file, constructor-injectable for tests.

  - description: |
      Add `PayoutRepository` holding pending payouts per provider plus per-provider
      "held" and "direct clawback" accumulators:
      ```ts
      export class PayoutRepository {
        findPendingByProviderId(providerId: string): Payout | undefined
        clawBack(payoutId: string, amount: number): void
        holdFuturePayouts(providerId: string, amount: number): void
        isHeld(providerId: string): boolean
        createPayout(providerId: string, amount: number, now?: number): Payout
        recordDirectClawback(providerId: string, amount: number): void
        getDirectClawbackAmount(providerId: string): number
      }
      ```
      `createPayout` is the mechanism that enforces AC3: any payout created for a
      provider while held is created with `status: "held"` instead of `"pending"`.
    files:
      - src/payments/payoutRepository.ts
    rationale: |
      This is the only stateful piece needed to prove the three reversal strategies
      (AC2-AC4) without inventing a real payout-scheduling subsystem, which is out of
      scope for this story.

  - description: |
      Add `ReversalRepository` (stores each `ChargebackReversal`) and
      `AuditLogRepository` (append-only log of chargeback audit entries: timestamp,
      actor id, amount, action), e.g.:
      ```ts
      export interface AuditLogEntry {
        timestamp: number;
        actorId: string;
        chargebackAmount: number;
        action: ReversalAction;
      }
      export class AuditLogRepository {
        record(entry: AuditLogEntry): void
        findAll(): AuditLogEntry[]
      }
      ```
    files:
      - src/payments/reversalRepository.ts
      - src/payments/auditLogRepository.ts
    rationale: |
      AC7 requires a durable, queryable log of every chargeback event; a dedicated
      repository (rather than only `console.log`) makes it assertable in tests, matching
      how `SessionRepository` makes session state assertable today.

  - description: |
      Add `NotificationRepository` (in-memory store of sent notifications) and
      `NotificationService` with `notifyAdmin(reversal)` / `notifyProvider(reversal)`:
      ```ts
      export interface Notification {
        recipientRole: "admin" | "provider";
        recipientId: string;
        chargebackId: string;
        amount: number;
      }
      export class NotificationRepository {
        save(notification: Notification): void
        findByRecipientRole(role: "admin" | "provider"): Notification[]
      }
      export class NotificationService {
        constructor(notificationRepository: NotificationRepository)
        notifyAdmin(reversal: ChargebackReversal): void
        notifyProvider(reversal: ChargebackReversal): void
      }
      ```
    files:
      - src/payments/notificationRepository.ts
      - src/payments/notificationService.ts
    rationale: |
      No real email/SMS integration exists anywhere in this codebase yet, so
      notifications are recorded in-memory (the same "in-memory store as the seam for
      testing" approach used for sessions/carts) rather than speculatively integrating a
      real notification provider.

  - description: |
      Add `ChargebackService.processChargeback(event, now?)` that resolves the
      transaction, picks the reversal strategy, persists the reversal + audit entry, and
      triggers both notifications:
      ```ts
      export class TransactionNotFoundError extends Error {}

      export class ChargebackService {
        constructor(
          transactionRepository: TransactionRepository,
          payoutRepository: PayoutRepository,
          reversalRepository: ReversalRepository,
          auditLogRepository: AuditLogRepository,
          notificationService: NotificationService,
        )
        processChargeback(event: ChargebackWebhookEvent, now: number = Date.now()): ChargebackReversal
      }
      ```
      Strategy selection (in a private `reverseDisbursement` helper):
      ```ts
      const pendingPayout = this.payoutRepository.findPendingByProviderId(transaction.providerId);
      if (pendingPayout && pendingPayout.amount >= chargebackAmount) {
        this.payoutRepository.clawBack(pendingPayout.id, chargebackAmount);
        return "clawback_from_pending_payout";
      }
      if (transaction.disbursementStatus === "disbursed" && !pendingPayout) {
        this.payoutRepository.recordDirectClawback(transaction.providerId, chargebackAmount);
        return "direct_clawback";
      }
      this.payoutRepository.holdFuturePayouts(transaction.providerId, chargebackAmount);
      return "hold_future_payouts";
      ```
    files:
      - src/payments/chargebackService.ts
    rationale: |
      Single orchestration point keeps the branch-per-AC logic (AC1-AC4) in one testable
      place, and centralizes the notify+log side effects (AC5-AC7) so every code path
      that creates a reversal also notifies and logs it.

  - description: |
      Add `handleChargebackWebhook(chargebackService, requestBody)` that validates the
      minimal Stripe dispute-webhook shape and maps errors to HTTP statuses:
      ```ts
      export function handleChargebackWebhook(
        chargebackService: ChargebackService,
        requestBody: unknown,
      ): ControllerResponse {
        const body = asRecord(requestBody);
        const data = asRecord(body.data);
        const object = asRecord(data.object);
        // validate body.id, body.type === "charge.dispute.created", object.amount, object.charge
      }
      ```
      400 on malformed payload, 404 via `TransactionNotFoundError`, 200 with
      `{ chargeback_id, transaction_id, provider_id, amount, action }` on success.
    files:
      - src/payments/chargebackController.ts
    rationale: |
      Matches the existing controller convention (`src/cart/cartController.ts`,
      `src/auth/authController.ts`): thin, returns a `ControllerResponse`, reuses
      `asRecord`/`ControllerResponse` from `src/httpUtils.ts`/`src/auth/authController.ts`.

  - description: |
      Wire a new unauthenticated route `POST /webhooks/stripe/chargebacks` into
      `src/app.ts`: instantiate the five new repositories/services (defaulting like the
      existing ones), add the route to the known-POST-routes check, and extend
      `AppDependencies` with the new optional repository fields so tests can inject
      seeded fixtures / spy on state, e.g.:
      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
        transactionRepository?: TransactionRepository;
        payoutRepository?: PayoutRepository;
        reversalRepository?: ReversalRepository;
        auditLogRepository?: AuditLogRepository;
        notificationRepository?: NotificationRepository;
      }
      ```
    files:
      - src/app.ts
    rationale: |
      This is the only existing file the feature must modify; it is the single request
      router/dependency-composition root today (verified: no framework, no separate
      router file — `handleRequest` in `src/app.ts` is a single if-chain over
      `${method} ${pathname}`).

  - description: |
      Write the integration test suite driving the webhook end-to-end through
      `startTestServer`, injecting seeded `TransactionRepository`/`PayoutRepository` and
      asserting on `NotificationRepository`/`AuditLogRepository`/`PayoutRepository`
      state after the call, one test group per AC.
    files:
      - test/chargebackReversal.test.ts
    rationale: |
      Mirrors `test/cartCustomisation.test.ts`: black-box HTTP tests against
      `startTestServer` (see `test/testServer.ts`), with repositories passed in via
      `AppDependencies` so test code can both seed preconditions and assert on post-call
      side effects.

tests:
  - |
    AC1 - a chargeback webhook triggers a disbursement reversal for the affected provider.
    Seed `TransactionRepository` with one transaction for `user-provider-1`
    (`disbursementStatus: "pending_payout"`, `stripeChargeId: "ch_1"`) and a matching
    pending `Payout`. POST a `charge.dispute.created` event referencing `ch_1` to
    `/webhooks/stripe/chargebacks` and assert a reversal was initiated:
    ```ts
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_1", "ch_1", 40));
    assert.equal(res.status, 200);
    const body = await res.json() as { provider_id: string; action: string };
    assert.equal(body.provider_id, "user-provider-1");
    assert.ok(["clawback_from_pending_payout", "hold_future_payouts", "direct_clawback"].includes(body.action));
    ```
  - |
    AC2 - a sufficient pending payout is clawed back by exactly the chargeback amount.
    Seed a pending payout of 100 for the provider, POST a chargeback of 40 against it,
    then re-read the payout from the same repository instance:
    ```ts
    await postWebhook(server.baseUrl, disputeEvent("evt_2", "ch_1", 40));
    const payout = payoutRepository.findPendingByProviderId("user-provider-1");
    assert.equal(payout?.amount, 60);
    ```
  - |
    AC3 - an insufficient (or absent) pending payout causes future payouts to be held
    until recovered. Seed a pending payout of 20 for a transaction not yet disbursed,
    POST a chargeback of 100 (exceeds the payout), then assert the response action and
    that a newly-created payout for that provider comes back held:
    ```ts
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_3", "ch_2", 100));
    assert.equal((await res.json() as { action: string }).action, "hold_future_payouts");
    const nextPayout = payoutRepository.createPayout("user-provider-1", 50);
    assert.equal(nextPayout.status, "held");
    ```
  - |
    AC4 - funds already fully disbursed with no pending payout available trigger a
    direct clawback. Seed a transaction with `disbursementStatus: "disbursed"` and an
    empty `PayoutRepository` (no pending payouts at all), POST the chargeback, and
    assert:
    ```ts
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_4", "ch_3", 100));
    assert.equal((await res.json() as { action: string }).action, "direct_clawback");
    assert.equal(payoutRepository.getDirectClawbackAmount("user-provider-1"), 100);
    ```
  - |
    AC5 - the admin is notified with the chargeback details. Inject a
    `NotificationRepository`, POST a chargeback, and assert an admin notification was
    recorded with the right amount and chargeback id:
    ```ts
    await postWebhook(server.baseUrl, disputeEvent("evt_5", "ch_1", 40));
    const adminNotifications = notificationRepository.findByRecipientRole("admin");
    assert.equal(adminNotifications.length, 1);
    assert.equal(adminNotifications[0].amount, 40);
    assert.equal(adminNotifications[0].chargebackId, "evt_5");
    ```
  - |
    AC6 - the provider is notified that a chargeback was received against their
    transaction. Same setup as AC5, asserting the provider-facing notification instead:
    ```ts
    await postWebhook(server.baseUrl, disputeEvent("evt_6", "ch_1", 40));
    const providerNotifications = notificationRepository.findByRecipientRole("provider");
    assert.equal(providerNotifications.length, 1);
    assert.equal(providerNotifications[0].recipientId, "user-provider-1");
    ```
  - |
    AC7 - the chargeback event is logged with a timestamp, actor identifier, chargeback
    amount, and the reversal action taken. Inject an `AuditLogRepository` and assert on
    the recorded entry:
    ```ts
    await postWebhook(server.baseUrl, disputeEvent("evt_7", "ch_1", 40));
    const entries = auditLogRepository.findAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorId, "evt_7");
    assert.equal(entries[0].chargebackAmount, 40);
    assert.equal(entries[0].action, "clawback_from_pending_payout");
    assert.equal(typeof entries[0].timestamp, "number");
    ```

assumptions_or_open_questions:
  - |
    No payments/transaction/payout/disbursement concept exists anywhere in the current
    codebase (verified: the app is a pizza-ordering demo with only auth/cart/pizzas —
    `src/auth`, `src/cart`, `src/pizzas`, `src/sessions`, `src/users`). This plan treats
    `provider` (an existing `Role` in `src/users/fixtures/testUsers.ts`) as the
    disbursement recipient and builds the entire transaction/payout/notification domain
    from scratch as in-memory repositories, matching the project's existing convention
    (no DB, no ORM) — it does not attempt to integrate a real payments/ledger system.
  - |
    Stripe webhook signature verification (the `Stripe-Signature` header /
    `stripe.webhooks.constructEvent`) is NOT implemented. No AC asks for it, and adding
    real signature verification would require the `stripe` SDK plus a webhook
    secret/config story of its own. This is a real production security gap (anyone could
    POST a forged payload to the endpoint) that should be tracked as separate follow-up
    work before this endpoint is exposed publicly.
  - |
    The webhook payload shape is assumed to be Stripe's real `charge.dispute.created`
    event normalized minimally as `{ id, type, data: { object: { id, amount, charge } } }`,
    and `amount` is treated as a plain number in the same currency unit as
    `Transaction.amount` (no cents-conversion, since no monetary unit convention exists
    elsewhere in the codebase to be consistent with).
  - |
    "Actor identifier" for the AC7 audit log is the Stripe event id (`event.id`), since
    the reversal is system-initiated by the webhook rather than by a logged-in human
    actor. No other actor identity is available on this call path.
  - |
    A provider can have at most one open pending payout at a time in this model
    (`findPendingByProviderId` returns a single `Payout | undefined`); this is the
    simplest model that satisfies AC2-AC4 and isn't contradicted by anything in the
    story.
  - |
    "Future payouts held until recovered" (AC3) is proven via
    `PayoutRepository.createPayout` returning `status: "held"` while a hold is
    outstanding; there is no scheduler/cron in this codebase that actually generates
    payouts periodically, so "future payout creation" is exercised directly rather than
    through a real disbursement scheduler (out of scope).

package_dependencies: []

notes: |
  No new third-party dependencies are needed: everything (webhook parsing, in-memory
  repositories, notification/audit "sinks") is built with the same `node:http` /
  plain-TypeScript approach already used for auth, sessions, cart, and pizzas — there is
  no database, ORM, or HTTP framework anywhere in this project to be consistent with, and
  Stripe signature verification (which would need the `stripe` package) is explicitly out
  of scope per the open questions above. Verified against the current codebase: `src/app.ts`
  is a single `handleRequest` if-chain over `${method} ${pathname}` with an
  `AppDependencies` DI object (no router library); `src/cart/*` is the closest existing
  analog (repository + service + controller, each independently constructable and
  injectable); `src/httpUtils.ts` provides `asRecord`/`sendJson`/`readJsonBody` used by
  every existing controller; `test/testServer.ts` + `test/cartCustomisation.test.ts` are
  the exact test-harness pattern this plan's `test/chargebackReversal.test.ts` follows.

  ```mermaid
  flowchart TD
    Stripe["Stripe (external)"] -->|POST /webhooks/stripe/chargebacks| AppTs

    subgraph existing["existing, touched"]
      AppTs["src/app.ts<br/>route table + DI"]
      HttpUtils["src/httpUtils.ts<br/>asRecord/readJsonBody/sendJson"]
    end

    subgraph new["src/payments/* (new)"]
      Controller["chargebackController.ts"]
      Service["chargebackService.ts"]
      TxRepo["transactionRepository.ts"]
      PayoutRepo["payoutRepository.ts"]
      ReversalRepo["reversalRepository.ts"]
      AuditRepo["auditLogRepository.ts"]
      NotifSvc["notificationService.ts"]
      NotifRepo["notificationRepository.ts"]
    end

    AppTs -->|"wires deps + adds route (AC1)"| Controller
    Controller -->|"reuses existing utils"| HttpUtils
    Controller -->|"processChargeback() - AC1"| Service
    Service -->|"findByStripeChargeId() - AC1"| TxRepo
    Service -->|"findPendingByProviderId/clawBack (AC2), holdFuturePayouts (AC3), recordDirectClawback (AC4)"| PayoutRepo
    Service -->|"save(reversal)"| ReversalRepo
    Service -->|"record(entry) - AC7"| AuditRepo
    Service -->|"notifyAdmin (AC5) / notifyProvider (AC6)"| NotifSvc
    NotifSvc --> NotifRepo

    classDef touched fill:#f96,color:#000
    class AppTs,Controller,Service,TxRepo,PayoutRepo,ReversalRepo,AuditRepo,NotifSvc,NotifRepo touched
  ```
