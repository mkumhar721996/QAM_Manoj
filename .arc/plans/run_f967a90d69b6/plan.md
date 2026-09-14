summary: |
  This story introduces the first booking-cancellation flow in what is currently an auth/session-only
  service: there is no `bookings`, `payments`, or `notifications` module in the repo today. The plan adds a
  minimal Booking domain (model + in-memory repository, mirroring the existing `SessionRepository`
  pattern), a pure cancellation-policy evaluator (free-cancellation window vs. time remaining until the
  appointment), and two outbound "gateway" ports — `PaymentsGateway` and `NotificationsGateway` — with
  in-memory stub implementations that record every call so tests can assert on them, following the same
  dependency-injection style already used for `UserRepository`/`SessionRepository` in `app.ts`. A new
  `BookingService` orchestrates: ownership/status checks, policy evaluation, marking the booking cancelled
  with an audit trail (timestamp + actor id), and signalling both gateways. A new controller reuses the
  existing `verifyAccessToken` helper to gate the route on authentication, and a new
  `POST /bookings/:id/cancel` route is wired into `app.ts`'s existing hand-rolled router. Every acceptance
  criterion gets one failing test first in a new `test/cancelBooking.test.ts`, run against the real HTTP
  server via `startTestServer`, matching the style of `login.test.ts`/`refresh.test.ts`/`logout.test.ts`.

scope:
  - description: |
      Add the booking domain model and an in-memory repository that can look up a booking by id and mark
      it cancelled with an audit trail. No booking domain exists in the repo today, so this is new.

      ```ts
      // src/bookings/bookingModel.ts
      export type BookingStatus = "confirmed" | "cancelled";

      export interface Booking {
        id: string;
        customerId: string;
        providerId: string;
        appointmentAt: number; // epoch ms
        status: BookingStatus;
        cancelledAt?: number;
        cancelledBy?: string;
      }
      ```

      ```ts
      // src/bookings/bookingRepository.ts (shape, mirrors SessionRepository)
      export class BookingRepository {
        create(booking: Booking): Booking { /* ... */ }
        findById(bookingId: string): Booking | undefined { /* ... */ }
        markCancelled(bookingId: string, cancelledBy: string, now: number): Booking { /* ... */ }
      }
      ```
    files:
      - src/bookings/bookingModel.ts
      - src/bookings/bookingRepository.ts
    rationale: |
      AC1 needs the booking's `appointmentAt`; AC2 and AC6 need a mutable status plus `cancelledAt`/
      `cancelledBy` fields recorded on the record itself, mirroring how `SessionRepository` tracks
      `revoked`/`expiresAt` directly on the `Session` record.

  - description: |
      Add a pure function that evaluates the cancellation policy from time remaining until the
      appointment, returning whether the free-cancellation window still applies and the resulting
      financial outcome.

      ```ts
      // src/bookings/cancellationPolicy.ts
      export const FREE_CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
      export type CancellationOutcome = "full_refund" | "no_refund";

      export interface CancellationPolicyResult {
        withinFreeWindow: boolean;
        outcome: CancellationOutcome;
      }

      export function evaluateCancellationPolicy(
        appointmentAt: number,
        now: number = Date.now(),
        freeCancellationWindowMs: number = FREE_CANCELLATION_WINDOW_MS,
      ): CancellationPolicyResult {
        const withinFreeWindow = appointmentAt - now >= freeCancellationWindowMs;
        return { withinFreeWindow, outcome: withinFreeWindow ? "full_refund" : "no_refund" };
      }
      ```
    files:
      - src/bookings/cancellationPolicy.ts
    rationale: |
      AC1 requires evaluating the applicable policy from time remaining until the appointment; AC3/AC4
      require that evaluation to drive the financial outcome signalled downstream. Kept as a pure,
      directly-unit-testable function rather than folded into the service, so AC1 can be tested in
      isolation from the HTTP/gateway plumbing.

  - description: |
      Add a `PaymentsGateway` port and an in-memory stub implementation that records every signal so
      tests can assert what was sent, mirroring how `SessionRepository` is injected into `startTestServer`
      for assertions in the existing auth tests.

      ```ts
      // src/payments/paymentsGateway.ts
      export interface CancellationOutcomeSignal {
        bookingId: string;
        customerId: string;
        outcome: "full_refund" | "no_refund";
        signalledAt: number;
      }

      export interface PaymentsGateway {
        signalCancellationOutcome(signal: CancellationOutcomeSignal): void;
      }

      export class InMemoryPaymentsGateway implements PaymentsGateway {
        readonly signals: CancellationOutcomeSignal[] = [];
        signalCancellationOutcome(signal: CancellationOutcomeSignal): void {
          this.signals.push(signal);
        }
      }
      ```
    files:
      - src/payments/paymentsGateway.ts
    rationale: |
      AC3/AC4 require a full-refund or fee/no-refund outcome to be "signalled to Payments & Invoicing".
      No cross-service HTTP client exists anywhere in this repo yet, so the boundary is modeled as an
      injectable port (like the existing repositories), with the real outbound transport left as a
      separate integration concern (see assumptions).

  - description: |
      Add a `NotificationsGateway` port and in-memory stub implementation, same shape as the payments
      gateway, used to notify the provider.

      ```ts
      // src/notifications/notificationsGateway.ts
      export interface ProviderCancellationNotification {
        bookingId: string;
        providerId: string;
        notifiedAt: number;
      }

      export interface NotificationsGateway {
        notifyProviderOfCancellation(notification: ProviderCancellationNotification): void;
      }

      export class InMemoryNotificationsGateway implements NotificationsGateway {
        readonly notifications: ProviderCancellationNotification[] = [];
        notifyProviderOfCancellation(notification: ProviderCancellationNotification): void {
          this.notifications.push(notification);
        }
      }
      ```
    files:
      - src/notifications/notificationsGateway.ts
    rationale: AC5 requires the provider be notified via Notifications when a cancellation is processed.

  - description: |
      Add `BookingService.cancelBooking` to orchestrate the whole flow: look up the booking (scoped to the
      requesting customer), reject if not found/not confirmed, evaluate the policy, mark cancelled with
      timestamp + actor id, then call both gateways.

      ```ts
      // src/bookings/bookingService.ts
      export class BookingNotFoundError extends Error { constructor() { super("Booking not found"); } }
      export class BookingNotCancellableError extends Error {
        constructor() { super("Only confirmed bookings can be cancelled"); }
      }

      export class BookingService {
        constructor(
          private bookingRepository: BookingRepository,
          private paymentsGateway: PaymentsGateway,
          private notificationsGateway: NotificationsGateway,
        ) {}

        cancelBooking(bookingId: string, customerId: string, now: number = Date.now()) {
          const booking = this.bookingRepository.findById(bookingId);
          if (!booking || booking.customerId !== customerId) throw new BookingNotFoundError();
          if (booking.status !== "confirmed") throw new BookingNotCancellableError();

          const policy = evaluateCancellationPolicy(booking.appointmentAt, now);
          const cancelled = this.bookingRepository.markCancelled(bookingId, customerId, now);
          console.log(`booking cancelled: bookingId=${bookingId} actorId=${customerId} at=${new Date(now).toISOString()}`);

          this.paymentsGateway.signalCancellationOutcome({
            bookingId, customerId, outcome: policy.outcome, signalledAt: now,
          });
          this.notificationsGateway.notifyProviderOfCancellation({
            bookingId, providerId: booking.providerId, notifiedAt: now,
          });

          return { booking: cancelled, outcome: policy.outcome };
        }
      }
      ```
    files:
      - src/bookings/bookingService.ts
    rationale: |
      Single orchestration point for AC1-AC6, mirroring how `AuthService` composes `UserRepository` +
      `SessionRepository` + token helpers.

  - description: |
      Add an HTTP controller that authenticates the caller via the existing `verifyAccessToken` helper
      before invoking the service, returning a 401 with a login prompt when the caller is unauthenticated.

      ```ts
      // src/bookings/bookingController.ts
      export function handleCancelBooking(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
        bookingId: string,
        now: number = Date.now(),
      ): ControllerResponse {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
        const payload = token ? verifyAccessToken(token, now) : null;
        if (!payload) {
          return { status: 401, body: { error: "Authentication required. Please log in to cancel this booking." } };
        }
        try {
          const result = bookingService.cancelBooking(bookingId, payload.userId, now);
          return {
            status: 200,
            body: {
              booking_id: result.booking.id,
              status: result.booking.status,
              cancelled_at: result.booking.cancelledAt,
              outcome: result.outcome,
            },
          };
        } catch (err) {
          if (err instanceof BookingNotFoundError) return { status: 404, body: { error: err.message } };
          if (err instanceof BookingNotCancellableError) return { status: 409, body: { error: err.message } };
          throw err;
        }
      }
      ```
    files:
      - src/bookings/bookingController.ts
    rationale: |
      AC7/AC8 require rejecting unauthenticated requests with a prompt to log in; reuses the same
      `verifyAccessToken` helper `handleGetSession` already uses, rather than inventing a second auth
      mechanism.

  - description: |
      Wire up dependencies and the new route in `app.ts`. The existing router matches on an exact
      `"METHOD /path"` string, so a dynamic `:id` segment needs a regex match added alongside the existing
      exact-match checks.

      ```ts
      // src/app.ts — inside handleRequest, before the current 404 fallthrough
      const cancelMatch = route.match(/^POST \/bookings\/([^/]+)\/cancel$/);
      if (cancelMatch) {
        const result = handleCancelBooking(bookingService, req.headers.authorization, cancelMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }
      ```

      `AppDependencies` gains optional `bookingRepository`, `paymentsGateway`, `notificationsGateway`,
      defaulted the same way `userRepository`/`sessionRepository` already are (`deps.x ?? new X()`).
    files:
      - src/app.ts
    rationale: Exposes the new flow over HTTP and keeps deps injectable for tests, per existing conventions.

  - description: |
      Write one failing test per acceptance criterion first, against the real HTTP server via
      `startTestServer`, matching the style of `login.test.ts`/`refresh.test.ts`/`logout.test.ts`. Bookings
      are seeded directly via `bookingRepository.create(...)` (no fixtures file), mirroring how
      `sessionRepository.create(...)` is already used directly in `refresh.test.ts`.
    files:
      - test/cancelBooking.test.ts
    rationale: Test-first coverage for all 8 ACs before any production code is written.

tests:
  - |
    AC1 — pure unit test of the policy evaluator, no HTTP involved:
    ```ts
    test("AC1: evaluates the cancellation policy based on time remaining until the appointment", () => {
      const now = Date.now();
      const farOut = evaluateCancellationPolicy(now + 48 * 60 * 60 * 1000, now);
      assert.equal(farOut.withinFreeWindow, true);
      const soon = evaluateCancellationPolicy(now + 2 * 60 * 60 * 1000, now);
      assert.equal(soon.withinFreeWindow, false);
    });
    ```
  - |
    AC2 — booking is marked cancelled after a confirmed cancellation:
    ```ts
    test("AC2: a confirmed cancellation marks the booking as cancelled", async () => {
      const bookingRepository = new BookingRepository();
      bookingRepository.create({ id: "booking-1", customerId: "user-customer-1", providerId: "user-provider-1",
        appointmentAt: Date.now() + 48 * 60 * 60 * 1000, status: "confirmed" });
      const server = await startTestServer({ bookingRepository });
      try {
        const { access_token } = await login(server.baseUrl);
        const res = await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
          method: "POST", headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(res.status, 200);
        assert.equal(bookingRepository.findById("booking-1")!.status, "cancelled");
      } finally { await server.close(); }
    });
    ```
  - |
    AC3 — within the free-cancellation window, a full refund is signalled:
    ```ts
    test("AC3: cancelling within the free-cancellation window signals a full refund", async () => {
      const bookingRepository = new BookingRepository();
      const paymentsGateway = new InMemoryPaymentsGateway();
      bookingRepository.create({ id: "booking-1", customerId: "user-customer-1", providerId: "user-provider-1",
        appointmentAt: Date.now() + 48 * 60 * 60 * 1000, status: "confirmed" });
      const server = await startTestServer({ bookingRepository, paymentsGateway });
      try {
        const { access_token } = await login(server.baseUrl);
        await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
          method: "POST", headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(paymentsGateway.signals.length, 1);
        assert.equal(paymentsGateway.signals[0].outcome, "full_refund");
      } finally { await server.close(); }
    });
    ```
  - |
    AC4 — outside the free-cancellation window, a no-refund outcome is signalled:
    ```ts
    test("AC4: cancelling outside the free-cancellation window signals a no-refund outcome", async () => {
      const bookingRepository = new BookingRepository();
      const paymentsGateway = new InMemoryPaymentsGateway();
      bookingRepository.create({ id: "booking-1", customerId: "user-customer-1", providerId: "user-provider-1",
        appointmentAt: Date.now() + 2 * 60 * 60 * 1000, status: "confirmed" });
      const server = await startTestServer({ bookingRepository, paymentsGateway });
      try {
        const { access_token } = await login(server.baseUrl);
        await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
          method: "POST", headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(paymentsGateway.signals[0].outcome, "no_refund");
      } finally { await server.close(); }
    });
    ```
  - |
    AC5 — the provider is notified via Notifications:
    ```ts
    test("AC5: a confirmed cancellation notifies the provider via Notifications", async () => {
      const bookingRepository = new BookingRepository();
      const notificationsGateway = new InMemoryNotificationsGateway();
      bookingRepository.create({ id: "booking-1", customerId: "user-customer-1", providerId: "user-provider-1",
        appointmentAt: Date.now() + 48 * 60 * 60 * 1000, status: "confirmed" });
      const server = await startTestServer({ bookingRepository, notificationsGateway });
      try {
        const { access_token } = await login(server.baseUrl);
        await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
          method: "POST", headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(notificationsGateway.notifications.length, 1);
        assert.equal(notificationsGateway.notifications[0].providerId, "user-provider-1");
      } finally { await server.close(); }
    });
    ```
  - |
    AC6 — a timestamp and actor id are recorded for auditability:
    ```ts
    test("AC6: a processed cancellation records a timestamp and actor id", async () => {
      const bookingRepository = new BookingRepository();
      bookingRepository.create({ id: "booking-1", customerId: "user-customer-1", providerId: "user-provider-1",
        appointmentAt: Date.now() + 48 * 60 * 60 * 1000, status: "confirmed" });
      const server = await startTestServer({ bookingRepository });
      try {
        const { access_token } = await login(server.baseUrl);
        const before = Date.now();
        await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
          method: "POST", headers: { Authorization: `Bearer ${access_token}` },
        });
        const booking = bookingRepository.findById("booking-1")!;
        assert.equal(booking.cancelledBy, "user-customer-1");
        assert.ok(booking.cancelledAt! >= before);
      } finally { await server.close(); }
    });
    ```
  - |
    AC7 — an unauthenticated cancellation request is rejected and has no effect:
    ```ts
    test("AC7: an unauthenticated cancellation request is rejected", async () => {
      const bookingRepository = new BookingRepository();
      bookingRepository.create({ id: "booking-1", customerId: "user-customer-1", providerId: "user-provider-1",
        appointmentAt: Date.now() + 48 * 60 * 60 * 1000, status: "confirmed" });
      const server = await startTestServer({ bookingRepository });
      try {
        const res = await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, { method: "POST" });
        assert.equal(res.status, 401);
        assert.equal(bookingRepository.findById("booking-1")!.status, "confirmed");
      } finally { await server.close(); }
    });
    ```
  - |
    AC8 — the rejection prompts the user to log in:
    ```ts
    test("AC8: an unauthenticated cancellation attempt is prompted to log in", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, { method: "POST" });
        const body = (await res.json()) as { error: string };
        assert.match(body.error, /log in/i);
      } finally { await server.close(); }
    });
    ```

assumptions_or_open_questions:
  - |
    The free-cancellation window length isn't specified in the story; this plan defaults it to 24 hours
    before the appointment (`FREE_CANCELLATION_WINDOW_MS`). Needs confirmation from product/config source.
  - |
    AC4 says "the configured fee or no-refund outcome". No fee schedule/amount is specified anywhere in the
    story, so this plan implements only the binary case: outside the free window, a `"no_refund"` outcome
    is signalled. A real percentage/flat-fee amount would need a follow-up once the fee schedule and its
    configuration source are defined.
  - |
    `PaymentsGateway` and `NotificationsGateway` are modeled as injectable ports with in-memory stub
    implementations (recording calls for test assertions), matching this repo's existing DI pattern for
    `UserRepository`/`SessionRepository`. No cross-service HTTP/queue client exists anywhere in this repo
    today, so the real outbound transport to the actual Payments & Invoicing / Notifications services is
    treated as a separate integration concern, out of scope for this story.
  - |
    A cancellation for a booking not owned by the authenticated customer, or not in `"confirmed"` status,
    is treated as `404 Not Found` / `409 Conflict` respectively. Neither is a literal acceptance criterion,
    but both are necessary to avoid one customer cancelling another's booking or double-cancelling; no
    dedicated test is listed for these since they're not ACs, but they exist in `BookingService`.
  - |
    No booking fixtures file is added (unlike `testUsers.ts`) — tests seed bookings directly via
    `bookingRepository.create(...)`, mirroring how `sessionRepository.create(...)` is already used directly
    in `refresh.test.ts`, since booking times need to be relative to test-run time.

package_dependencies: []

notes: |
  This is a small, low-risk addition to an otherwise minimal hand-rolled Node HTTP service (no framework,
  no ORM, no existing cross-service client). The new modules follow the exact layering already
  established by the auth slice: controller (HTTP concerns + auth) → service (orchestration) →
  repository/gateways (state + boundaries). `verifyAccessToken` is reused as-is, unmodified.

  ```mermaid
  flowchart TD
    app[app.ts] -->|routes POST /bookings/:id/cancel| controller[bookingController.ts]
    controller -->|reuses existing helper| tokenService[tokenService.ts]
    controller -->|AC7/AC8: 401 + login prompt if unauth| service[bookingService.ts]
    service -->|AC2/AC6: lookup + mark cancelled| bookingRepo[bookingRepository.ts]
    service -->|AC1: time-remaining vs free window| policy[cancellationPolicy.ts]
    service -->|AC3/AC4: full_refund or no_refund| paymentsGw[paymentsGateway.ts]
    service -->|AC5: notify provider| notifGw[notificationsGateway.ts]

    classDef touched fill:#f96,color:#000
    class app,controller,service,bookingRepo,policy,paymentsGw,notifGw touched
    class tokenService untouched
  ```
