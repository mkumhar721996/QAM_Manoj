summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is a headless Node `http` API with
  `auth/`, `sessions/`, `users/`, `pizzas/`, `cart/` modules following a repository -> service ->
  controller layering, in-memory `Map`-backed repositories (no DB), snake_case JSON wire format,
  and `node:test` against either an ephemeral `startTestServer()` (for HTTP-boundary behaviour) or
  directly-instantiated repositories/services with an explicit `now: number` parameter (for
  time-based behaviour, e.g. `sessionRepository.isValid(session, sixDaysLater)` in
  `test/refresh.test.ts`). There is no booking, payments, or disbursement domain anywhere in the
  codebase yet, and no real payment processor or notification integration. This plan adds a new
  `src/disbursements/` module (model, repositories for disbursements/config/notifications,
  an injectable `PaymentGateway` interface, a `DisbursementService` with the dispute-window/
  retry/state-machine logic, and a thin controller) wired into `src/app.ts`. Booking & Scheduling's
  "service marked complete" signal and Stripe's `charge.dispute.created` webhook are both modelled
  as inbound HTTP POST webhooks (the only externally-observable trigger points this headless
  service has), while the 24-hour dispute window and the 15m/1h/4h retry schedule are driven by an
  explicit, directly-callable `processDue(now)` tick function rather than a real timer/cron -
  mirroring how this codebase already unit-tests time-based logic by passing a controlled `now`
  instead of waiting on real clocks. Each acceptance criterion is translated into either an
  HTTP-observable webhook/response or a directly-inspectable repository/service state change, and
  driven test-first.
scope:
  - description: |
      Write the failing tests first in a new `test/disbursement.test.ts`, covering all 14 ACs.
      Most exercise `DisbursementService` directly (constructing it with a scripted fake
      `PaymentGateway`, matching how `refresh.test.ts` drives `SessionRepository` directly with a
      fabricated `now`); two prove the webhook/config routes are wired into `src/app.ts`. These
      must fail with import/module-not-found errors before any implementation exists.
    files:
      - "test/disbursement.test.ts"
    rationale: |
      Establishes the test-first contract before any production code exists. Time-based ACs
      (24h window, 15m/1h/4h retries) are driven by passing an explicit `now` into
      `processDue(now)` rather than real timers, exactly like the existing convention in
      `test/refresh.test.ts` (`sessionRepository.isValid(session, sixDaysLater)`,
      `sessionRepository.create(..., eightDaysAgo)`).
  - description: |
      Add the disbursement domain model and supporting in-memory repositories, modelled directly
      on `src/sessions/sessionModel.ts` + `src/sessions/sessionRepository.ts` (plain interfaces,
      `Map`-backed store, no persistence layer).

      ```ts
      // src/disbursements/disbursementModel.ts
      export type DisbursementStatus = "dispute_window" | "retry_pending" | "disbursed" | "failed_manual_intervention";

      export interface Disbursement {
        bookingId: string;
        providerId: string;
        totalAmount: number;
        status: DisbursementStatus;
        disburseAt: number;
        disputeRaised: boolean;
        retryCount: number;
        nextRetryAt?: number;
        disbursedAt?: number;
        serviceFeeAmount?: number;
        netAmount?: number;
      }

      export interface DisbursementAttempt {
        bookingId: string;
        timestamp: number;
        actor: string;
        retryCount: number;
        outcome: "success" | "failure";
        reason?: string;
      }

      export interface Notification {
        timestamp: number;
        recipient: "admin" | "provider";
        bookingId: string;
        message: string;
      }

      export interface RecoveryTask {
        bookingId: string;
        providerId: string;
        createdAt: number;
        reason: string;
      }
      ```

      ```ts
      // src/disbursements/disbursementRepository.ts
      export class DisbursementRepository {
        private disbursementsByBookingId: Map<string, Disbursement> = new Map();
        private attempts: DisbursementAttempt[] = [];

        create(disbursement: Disbursement): void {
          this.disbursementsByBookingId.set(disbursement.bookingId, disbursement);
        }

        findByBookingId(bookingId: string): Disbursement | undefined {
          return this.disbursementsByBookingId.get(bookingId);
        }

        listDue(now: number): Disbursement[] {
          return [...this.disbursementsByBookingId.values()].filter((d) => {
            if (d.disputeRaised) return false;
            if (d.status === "dispute_window") return d.disburseAt <= now;
            if (d.status === "retry_pending") return d.nextRetryAt !== undefined && d.nextRetryAt <= now;
            return false;
          });
        }

        addAttempt(attempt: DisbursementAttempt): void {
          this.attempts.push(attempt);
        }

        getAttempts(bookingId: string): DisbursementAttempt[] {
          return this.attempts.filter((a) => a.bookingId === bookingId);
        }
      }
      ```

      ```ts
      // src/disbursements/configRepository.ts
      export class ConfigRepository {
        private serviceFeeRate: number;
        constructor(initialRate: number = 0.15) {
          this.serviceFeeRate = initialRate;
        }
        getServiceFeeRate(): number {
          return this.serviceFeeRate;
        }
        setServiceFeeRate(rate: number): void {
          this.serviceFeeRate = rate;
        }
      }
      ```

      ```ts
      // src/disbursements/notificationRepository.ts
      export class NotificationRepository {
        private notifications: Notification[] = [];
        private recoveryTasks: RecoveryTask[] = [];

        notifyAdmin(bookingId: string, message: string, now: number = Date.now()): void {
          this.notifications.push({ timestamp: now, recipient: "admin", bookingId, message });
        }
        notifyProvider(bookingId: string, message: string, now: number = Date.now()): void {
          this.notifications.push({ timestamp: now, recipient: "provider", bookingId, message });
        }
        createRecoveryTask(bookingId: string, providerId: string, reason: string, now: number = Date.now()): void {
          this.recoveryTasks.push({ bookingId, providerId, createdAt: now, reason });
        }
        getNotifications(): Notification[] {
          return [...this.notifications];
        }
        getRecoveryTasks(): RecoveryTask[] {
          return [...this.recoveryTasks];
        }
      }
      ```

      ```ts
      // src/disbursements/paymentGateway.ts
      export interface DisbursementPaymentInput {
        bookingId: string;
        providerId: string;
        amount: number;
      }
      export interface DisbursementPaymentResult {
        success: boolean;
        failureReason?: string;
      }
      export interface PaymentGateway {
        disburse(input: DisbursementPaymentInput): Promise<DisbursementPaymentResult>;
      }
      export class InMemoryPaymentGateway implements PaymentGateway {
        async disburse(_input: DisbursementPaymentInput): Promise<DisbursementPaymentResult> {
          return { success: true };
        }
      }
      ```
    files:
      - "src/disbursements/disbursementModel.ts"
      - "src/disbursements/disbursementRepository.ts"
      - "src/disbursements/configRepository.ts"
      - "src/disbursements/notificationRepository.ts"
      - "src/disbursements/paymentGateway.ts"
    rationale: |
      Separates the disbursement record/attempt log (AC1-AC10), the runtime-mutable fee config
      (AC11), the admin/provider notification log (AC8/AC9/AC12), and the recovery-task log
      (AC13) into their own `Map`-backed stores, matching the single-responsibility-per-repository
      pattern already used by `SessionRepository`/`CartRepository`/`PizzaRepository`. `PaymentGateway`
      is a small interface (not a real Stripe/payout SDK integration, since none exists in this
      codebase and no AC requires one) so tests can inject a scripted fake that fails N times then
      succeeds, the same way `AppDependencies` already allows injecting a `SessionRepository`.
  - description: |
      Add `DisbursementService`, the state machine covering AC1-AC10 and AC12-AC14.

      ```ts
      // src/disbursements/disbursementService.ts
      export const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;
      export const RETRY_DELAYS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000];
      export const MAX_RETRIES = 3;

      export class DisbursementService {
        constructor(
          private disbursementRepository: DisbursementRepository,
          private configRepository: ConfigRepository,
          private paymentGateway: PaymentGateway,
          private notificationRepository: NotificationRepository,
        ) {}

        handleServiceCompleted(bookingId: string, providerId: string, totalAmount: number, now: number = Date.now()): void {
          this.disbursementRepository.create({
            bookingId,
            providerId,
            totalAmount,
            status: "dispute_window",
            disburseAt: now + DISPUTE_WINDOW_MS,
            disputeRaised: false,
            retryCount: 0,
          });
        }

        handleDisputeCreated(bookingId: string, now: number = Date.now()): void {
          const disbursement = this.disbursementRepository.findByBookingId(bookingId);
          if (!disbursement) return;

          if (disbursement.status === "disbursed") {
            this.notificationRepository.notifyAdmin(
              bookingId,
              `Chargeback raised for booking ${bookingId} after disbursement`,
              now,
            );
            this.notificationRepository.createRecoveryTask(
              bookingId,
              disbursement.providerId,
              "chargeback after disbursement",
              now,
            );
            return;
          }
          disbursement.disputeRaised = true;
        }

        async processDue(now: number = Date.now()): Promise<void> {
          for (const disbursement of this.disbursementRepository.listDue(now)) {
            const rate = this.configRepository.getServiceFeeRate();
            const serviceFeeAmount = disbursement.totalAmount * rate;
            const netAmount = disbursement.totalAmount - serviceFeeAmount;
            const attemptRetryCount = disbursement.retryCount;

            const result = await this.paymentGateway.disburse({
              bookingId: disbursement.bookingId,
              providerId: disbursement.providerId,
              amount: netAmount,
            });

            this.disbursementRepository.addAttempt({
              bookingId: disbursement.bookingId,
              timestamp: now,
              actor: "system:disbursement-scheduler",
              retryCount: attemptRetryCount,
              outcome: result.success ? "success" : "failure",
              reason: result.failureReason,
            });

            if (result.success) {
              disbursement.status = "disbursed";
              disbursement.disbursedAt = now;
              disbursement.serviceFeeAmount = serviceFeeAmount;
              disbursement.netAmount = netAmount;
              continue;
            }

            disbursement.retryCount = attemptRetryCount + 1;
            if (disbursement.retryCount > MAX_RETRIES) {
              disbursement.status = "failed_manual_intervention";
              this.notificationRepository.notifyAdmin(
                disbursement.bookingId,
                `Disbursement failed after ${MAX_RETRIES} retries for booking ${disbursement.bookingId}`,
                now,
              );
              this.notificationRepository.notifyProvider(
                disbursement.bookingId,
                `Please update your payout details for booking ${disbursement.bookingId}`,
                now,
              );
              continue;
            }
            disbursement.status = "retry_pending";
            disbursement.nextRetryAt = now + RETRY_DELAYS_MS[disbursement.retryCount - 1];
          }
        }
      }
      ```
    files:
      - "src/disbursements/disbursementService.ts"
    rationale: |
      Centralises the dispute-window/retry/state-machine rules in one place, mirroring how
      `AuthService`/`CartService` centralise their respective business rules rather than spreading
      them across the controller. `retryCount` on the `Disbursement` record tracks *retries already
      attempted* (0 = only the original attempt has run); the attempt log's `retryCount` records the
      count *at the time of that attempt* (0 = original, 1/2/3 = the three retries), so
      `RETRY_DELAYS_MS[disbursement.retryCount - 1]` yields 15m after the original failure, 1h after
      retry 1, and 4h after retry 2 - matching AC6's "15 minutes, 1 hour, and 4 hours after the
      preceding attempt". A dispute (`disputeRaised`) permanently excludes a booking from
      `listDue`, which is what implements both AC2 (window still open) and AC4 (dispute during the
      window) as the same "would otherwise disburse" guard.
  - description: |
      Add `disbursementController.ts` with the two inbound webhook handlers and the admin-only
      config endpoint, reusing `verifyAccessToken`/`asRecord`/`ControllerResponse` exactly like
      `cartController.ts` and `authController.ts` do.

      ```ts
      // src/disbursements/disbursementController.ts
      export function handleServiceCompletedWebhook(
        disbursementService: DisbursementService,
        requestBody: unknown,
      ): ControllerResponse {
        const { booking_id: bookingId, provider_id: providerId, total_amount: totalAmount } = asRecord(requestBody);
        if (typeof bookingId !== "string" || typeof providerId !== "string" || typeof totalAmount !== "number") {
          return { status: 400, body: { error: "booking_id, provider_id, and total_amount are required" } };
        }
        disbursementService.handleServiceCompleted(bookingId, providerId, totalAmount);
        return { status: 202 };
      }

      export function handleStripeDisputeWebhook(
        disbursementService: DisbursementService,
        requestBody: unknown,
      ): ControllerResponse {
        const { type, booking_id: bookingId } = asRecord(requestBody);
        if (type !== "charge.dispute.created" || typeof bookingId !== "string") {
          return { status: 400, body: { error: "type must be charge.dispute.created and booking_id is required" } };
        }
        disbursementService.handleDisputeCreated(bookingId);
        return { status: 200 };
      }

      export function handleUpdateServiceFeeRate(
        configRepository: ConfigRepository,
        authorizationHeader: string | undefined,
        requestBody: unknown,
      ): ControllerResponse {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
        const payload = token ? verifyAccessToken(token) : null;
        if (!payload || payload.role !== "admin") {
          return { status: 403, body: { error: "admin role required" } };
        }
        const { rate } = asRecord(requestBody);
        if (typeof rate !== "number" || rate < 0 || rate > 1) {
          return { status: 400, body: { error: "rate must be a number between 0 and 1" } };
        }
        configRepository.setServiceFeeRate(rate);
        return { status: 200, body: { rate } };
      }
      ```
    files:
      - "src/disbursements/disbursementController.ts"
    rationale: |
      Keeps HTTP-shape concerns (snake_case body, status codes, Bearer-token/role parsing) in the
      controller layer only, so `DisbursementService` stays framework/HTTP-agnostic, matching the
      existing `cartController.ts`/`authController.ts` split. Restricting the fee-rate change to
      `role === "admin"` reuses the `Role` type already seeded in
      `src/users/fixtures/testUsers.ts` ("customer" | "provider" | "admin").
  - description: |
      Wire the new module into `src/app.ts`: extend `AppDependencies`, construct the new
      repositories/service in `createApp`, and add routing for the two webhooks and the config
      endpoint.

      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
        disbursementRepository?: DisbursementRepository;
        configRepository?: ConfigRepository;
        notificationRepository?: NotificationRepository;
        paymentGateway?: PaymentGateway;
      }
      ```

      Routing addition inside `handleRequest` (extend the existing "requires body" guard list,
      then add explicit branches before the final `handleLogout` fallback):

      ```ts
      if (
        route !== "POST /auth/login" &&
        route !== "POST /auth/refresh" &&
        route !== "POST /auth/logout" &&
        route !== "POST /cart/items" &&
        route !== "POST /webhooks/booking-service-completed" &&
        route !== "POST /webhooks/stripe/dispute" &&
        route !== "PUT /config/service-fee-rate"
      ) {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req);
      // ...existing POST /auth/login, /auth/refresh, /cart/items branches...

      if (route === "POST /webhooks/booking-service-completed") {
        const result = handleServiceCompletedWebhook(disbursementService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "POST /webhooks/stripe/dispute") {
        const result = handleStripeDisputeWebhook(disbursementService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "PUT /config/service-fee-rate") {
        const result = handleUpdateServiceFeeRate(configRepository, req.headers.authorization, body);
        sendJson(res, result.status, result.body);
        return;
      }

      const result = handleLogout(authService, body);
      sendJson(res, result.status, result.body);
      ```
    files:
      - "src/app.ts"
    rationale: |
      `createApp` is the single composition root today - the new module must be constructed and
      routed the same way rather than starting a second server or router, matching how
      `PizzaRepository`/`CartRepository`/`CartService` were added previously. `PUT` is a new HTTP
      method for this codebase (only `GET`/`POST` exist today); it is called out explicitly here so
      the reviewer can confirm this small deviation before it is written.
tests:
  - |
    AC1 - service-completed signal starts a 24-hour dispute window.
    ```ts
    test("AC1: a service-completed signal starts a 24-hour dispute window", () => {
      const disbursementRepository = new DisbursementRepository();
      const service = new DisbursementService(
        disbursementRepository, new ConfigRepository(), new InMemoryPaymentGateway(), new NotificationRepository(),
      );
      const now = Date.now();
      service.handleServiceCompleted("booking-1", "user-provider-1", 100, now);
      const disbursement = disbursementRepository.findByBookingId("booking-1")!;
      assert.equal(disbursement.status, "dispute_window");
      assert.equal(disbursement.disburseAt - now, 24 * 60 * 60 * 1000);
    });
    ```
  - |
    AC2 - funds are not disbursed while the dispute window is still open.
    ```ts
    test("AC2: funds are not disbursed while the dispute window is open", async () => {
      const disbursementRepository = new DisbursementRepository();
      const gateway = new ScriptedPaymentGateway([{ success: true }]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(), gateway, new NotificationRepository());
      const now = Date.now();
      service.handleServiceCompleted("booking-2", "user-provider-1", 100, now);
      await service.processDue(now + 23 * 60 * 60 * 1000);
      assert.equal(gateway.calls.length, 0);
      assert.equal(disbursementRepository.findByBookingId("booking-2")!.status, "dispute_window");
    });
    ```
  - |
    AC3 - after the window elapses with no chargeback, provider is paid total minus service fee.
    ```ts
    test("AC3: disbursement pays total minus the service fee once the window elapses", async () => {
      const disbursementRepository = new DisbursementRepository();
      const gateway = new ScriptedPaymentGateway([{ success: true }]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(0.1), gateway, new NotificationRepository());
      const now = Date.now();
      service.handleServiceCompleted("booking-3", "user-provider-1", 200, now);
      await service.processDue(now + 24 * 60 * 60 * 1000);
      assert.equal(gateway.calls[0].amount, 180);
      assert.equal(disbursementRepository.findByBookingId("booking-3")!.status, "disbursed");
    });
    ```
  - |
    AC4 - a Stripe dispute during the window prevents the automatic disbursement.
    ```ts
    test("AC4: a dispute during the window prevents automatic disbursement", async () => {
      const disbursementRepository = new DisbursementRepository();
      const gateway = new ScriptedPaymentGateway([{ success: true }]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(), gateway, new NotificationRepository());
      const now = Date.now();
      service.handleServiceCompleted("booking-4", "user-provider-1", 100, now);
      service.handleDisputeCreated("booking-4", now + 1000);
      await service.processDue(now + 24 * 60 * 60 * 1000);
      assert.equal(gateway.calls.length, 0);
      assert.equal(disbursementRepository.findByBookingId("booking-4")!.status, "dispute_window");
    });
    ```
  - |
    AC5 - a failing disbursement is retried automatically up to 3 times.
    ```ts
    test("AC5: a failing disbursement is retried up to 3 times", async () => {
      const disbursementRepository = new DisbursementRepository();
      const gateway = new ScriptedPaymentGateway([
        { success: false }, { success: false }, { success: false }, { success: false },
      ]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(), gateway, new NotificationRepository());
      let now = Date.now();
      service.handleServiceCompleted("booking-5", "user-provider-1", 100, now);
      now += 24 * 60 * 60 * 1000;
      for (let i = 0; i < 4; i += 1) {
        await service.processDue(now);
        const d = disbursementRepository.findByBookingId("booking-5")!;
        now = d.nextRetryAt ?? now;
      }
      assert.equal(gateway.calls.length, 4);
      assert.equal(disbursementRepository.findByBookingId("booking-5")!.status, "failed_manual_intervention");
    });
    ```
  - |
    AC6 - retries occur at 15 minutes, 1 hour, and 4 hours after the preceding attempt.
    ```ts
    test("AC6: retries are scheduled at 15m, 1h, then 4h after the preceding attempt", async () => {
      const disbursementRepository = new DisbursementRepository();
      const gateway = new ScriptedPaymentGateway([{ success: false }, { success: false }, { success: false }, { success: false }]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(), gateway, new NotificationRepository());
      let now = Date.now();
      service.handleServiceCompleted("booking-6", "user-provider-1", 100, now);
      now += 24 * 60 * 60 * 1000;

      await service.processDue(now);
      assert.equal(disbursementRepository.findByBookingId("booking-6")!.nextRetryAt! - now, 15 * 60 * 1000);

      now = disbursementRepository.findByBookingId("booking-6")!.nextRetryAt!;
      await service.processDue(now);
      assert.equal(disbursementRepository.findByBookingId("booking-6")!.nextRetryAt! - now, 60 * 60 * 1000);

      now = disbursementRepository.findByBookingId("booking-6")!.nextRetryAt!;
      await service.processDue(now);
      assert.equal(disbursementRepository.findByBookingId("booking-6")!.nextRetryAt! - now, 4 * 60 * 60 * 1000);
    });
    ```
  - |
    AC7 - after all 3 retries fail, funds remain held pending manual intervention (no gateway
    success recorded, disbursement never reaches "disbursed").
    ```ts
    test("AC7: funds remain held after all 3 retries fail", async () => {
      // same setup/loop as the AC5 test
      assert.equal(disbursementRepository.findByBookingId("booking-5")!.status, "failed_manual_intervention");
      assert.equal(disbursementRepository.findByBookingId("booking-5")!.disbursedAt, undefined);
    });
    ```
  - |
    AC8 - the admin is notified for manual intervention after the final retry fails.
    ```ts
    test("AC8: admin is notified after the final retry fails", async () => {
      // same setup as AC5, using a NotificationRepository instance kept in scope
      const notifications = notificationRepository.getNotifications();
      assert.ok(notifications.some((n) => n.recipient === "admin" && n.bookingId === "booking-5"));
    });
    ```
  - |
    AC9 - the provider is notified to update their payout details after the final retry fails.
    ```ts
    test("AC9: provider is notified to update payout details after the final retry fails", async () => {
      const notifications = notificationRepository.getNotifications();
      assert.ok(notifications.some((n) => n.recipient === "provider" && n.bookingId === "booking-5"));
    });
    ```
  - |
    AC10 - every disbursement attempt is logged with a timestamp, actor identifier, and retry count.
    ```ts
    test("AC10: each attempt is logged with a timestamp, actor, and retry count", async () => {
      const disbursementRepository = new DisbursementRepository();
      const gateway = new ScriptedPaymentGateway([{ success: true }]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(), gateway, new NotificationRepository());
      const now = Date.now();
      service.handleServiceCompleted("booking-10", "user-provider-1", 100, now);
      await service.processDue(now + 24 * 60 * 60 * 1000);
      const [attempt] = disbursementRepository.getAttempts("booking-10");
      assert.equal(attempt.timestamp, now + 24 * 60 * 60 * 1000);
      assert.equal(attempt.actor, "system:disbursement-scheduler");
      assert.equal(attempt.retryCount, 0);
    });
    ```
  - |
    AC11 - a service-fee-rate change via config is applied to the next disbursement without a
    code deployment (driven through the real HTTP admin endpoint, then a directly-called
    `processDue`, sharing the same injected `configRepository`/`disbursementRepository` instances).
    ```ts
    test("AC11: a runtime service-fee-rate change is applied without a code deployment", async () => {
      const disbursementRepository = new DisbursementRepository();
      const configRepository = new ConfigRepository();
      const server = await startTestServer({ disbursementRepository, configRepository });
      try {
        const { access_token: adminToken } = await loginAs(server.baseUrl, "admin1");
        const putRes = await fetch(`${server.baseUrl}/config/service-fee-rate`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ rate: 0.25 }),
        });
        assert.equal(putRes.status, 200);

        const service = new DisbursementService(disbursementRepository, configRepository, new InMemoryPaymentGateway(), new NotificationRepository());
        const now = Date.now();
        service.handleServiceCompleted("booking-11", "user-provider-1", 100, now);
        await service.processDue(now + 24 * 60 * 60 * 1000);
        assert.equal(disbursementRepository.findByBookingId("booking-11")!.netAmount, 75);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC12 - the admin is alerted when a chargeback is raised after funds have already been disbursed.
    ```ts
    test("AC12: admin is alerted on a chargeback raised after disbursement", async () => {
      const disbursementRepository = new DisbursementRepository();
      const notificationRepository = new NotificationRepository();
      const gateway = new ScriptedPaymentGateway([{ success: true }]);
      const service = new DisbursementService(disbursementRepository, new ConfigRepository(), gateway, notificationRepository);
      const now = Date.now();
      service.handleServiceCompleted("booking-12", "user-provider-1", 100, now);
      await service.processDue(now + 24 * 60 * 60 * 1000);
      service.handleDisputeCreated("booking-12", now + 25 * 60 * 60 * 1000);
      assert.ok(notificationRepository.getNotifications().some((n) => n.recipient === "admin" && n.bookingId === "booking-12"));
    });
    ```
  - |
    AC13 - a manual recovery task is created against the provider for a post-disbursement chargeback.
    ```ts
    test("AC13: a recovery task is created against the provider on a post-disbursement chargeback", async () => {
      // same setup as AC12
      const [task] = notificationRepository.getRecoveryTasks();
      assert.equal(task.bookingId, "booking-12");
      assert.equal(task.providerId, "user-provider-1");
    });
    ```
  - |
    AC14 - no automatic reversal of the disbursement is attempted on a post-disbursement chargeback.
    ```ts
    test("AC14: no automatic reversal is attempted on a post-disbursement chargeback", async () => {
      // same setup as AC12
      const before = { ...disbursementRepository.findByBookingId("booking-12")! };
      service.handleDisputeCreated("booking-12", now + 25 * 60 * 60 * 1000);
      const after = disbursementRepository.findByBookingId("booking-12")!;
      assert.deepEqual(after, before);
      assert.equal(gateway.calls.length, 1);
    });
    ```
assumptions_or_open_questions:
  - "Booking & Scheduling's 'service marked complete' event and Stripe's charge.dispute.created webhook are both modelled as unauthenticated inbound HTTP POST webhooks (POST /webhooks/booking-service-completed, POST /webhooks/stripe/dispute), the only externally-observable trigger points a headless service like this has. Webhook signature verification / service-to-service auth is out of scope since no AC requires it - please confirm, or point to an existing inter-service auth mechanism this should reuse."
  - "'Provider's net share' is assumed to be a percentage-based fee (netAmount = totalAmount - totalAmount * serviceFeeRate), matching AC11's wording ('service fee rate'). A flat per-booking fee is not modelled."
  - "No real payment processor or payout API is integrated (none exists in this codebase and none is requested); disbursement execution is behind an injectable PaymentGateway interface with an InMemoryPaymentGateway default, so tests fully control success/failure without any new third-party dependency."
  - "The 24-hour dispute window and the 15m/1h/4h retry schedule have no real recurring scheduler (setInterval/cron/queue) wired up in this plan. DisbursementService.processDue(now) is the directly-callable, fully deterministic tick function, mirroring how this codebase already unit-tests time-based logic (e.g. sessionRepository.isValid(session, now)) by passing an explicit `now` rather than waiting on real timers. Wiring an actual recurring worker process that calls processDue(Date.now()) on an interval is assumed to be infrastructure/deployment work outside this plan's scope - please confirm."
  - "Admin/provider 'notification' (AC8, AC9, AC12) is modelled as an in-memory NotificationRepository log rather than an email/SMS/push integration, since no AC specifies a channel and none exists in this codebase today."
  - "Only a user with role 'admin' (already seeded in src/users/fixtures/testUsers.ts) may change the service fee rate via PUT /config/service-fee-rate; no AC specifies who may change it, but restricting it to admin is the minimal safe default."
  - "Disbursement/attempt/notification/recovery-task state is asserted in tests via direct repository access (injected into startTestServer, same pattern as SessionRepository in refresh.test.ts) rather than new read-only HTTP endpoints, since no AC requires a provider/admin-facing screen or API to view this state."
  - "The attempt log's actor identifier for automatic attempts is the fixed string 'system:disbursement-scheduler', since these are system-initiated, not human-initiated, actions."
  - "Default service fee rate is 0.15 (15%) absent any stated default; this is only a seed value and is fully overridable via PUT /config/service-fee-rate per AC11."
package_dependencies: []
notes: |
  Route dispatch in `src/app.ts` today is a flat set of exact `${method} ${pathname}` string
  comparisons for `GET`/`POST` only. This plan adds three new `POST`/`PUT` routes to that same flat
  list rather than introducing a router library; `PUT` is a new HTTP method for this codebase,
  called out explicitly in scope so the reviewer can weigh in before it's written.

  Layering/call-graph for the touched modules, plus their existing real callers/callees read while
  planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: routes + composition root)"]
    disbursementController["src/disbursements/disbursementController.ts (new)"]
    disbursementService["src/disbursements/disbursementService.ts (new)"]
    disbursementRepository["src/disbursements/disbursementRepository.ts (new)"]
    configRepository["src/disbursements/configRepository.ts (new)"]
    notificationRepository["src/disbursements/notificationRepository.ts (new)"]
    paymentGateway["src/disbursements/paymentGateway.ts (new)"]
    tokenService["src/auth/tokenService.ts (existing, untouched)"]
    httpUtils["src/httpUtils.ts (existing, untouched)"]
    authController["src/auth/authController.ts (existing, untouched: ControllerResponse type reused)"]
    testFile["test/disbursement.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes the 2 webhooks + PUT /config/service-fee-rate"| disbursementController
    disbursementController -->|"verifyAccessToken() + role==admin check"| tokenService
    disbursementController -->|"asRecord() body parsing"| httpUtils
    disbursementController -->|"reuses ControllerResponse type"| authController
    disbursementController -->|"handleServiceCompleted(), handleDisputeCreated()"| disbursementService
    disbursementController -->|"setServiceFeeRate()"| configRepository
    disbursementService -->|"create(), listDue(), addAttempt()"| disbursementRepository
    disbursementService -->|"getServiceFeeRate()"| configRepository
    disbursementService -->|"disburse()"| paymentGateway
    disbursementService -->|"notifyAdmin(), notifyProvider(), createRecoveryTask()"| notificationRepository
    testFile -->|"unit-tests directly with controlled now"| disbursementService
    testFile -->|"fetch() for webhook/config routing"| app
    testFile -->|"startTestServer()"| testServer

    classDef touched fill:#f96,color:#000
    class app,disbursementController,disbursementService,disbursementRepository,configRepository,notificationRepository,paymentGateway,testFile touched
  ```
