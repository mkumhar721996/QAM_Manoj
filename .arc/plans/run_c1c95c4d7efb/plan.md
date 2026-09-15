summary: |
  This plan adds a Stripe-backed payment-capture step to booking confirmation. It introduces a
  `booking` module (model + in-memory repository + HTTP controller) and a `payments` module
  (a `PaymentGateway` port with a Stripe adapter, a `PaymentService` that orchestrates
  authorize -> capture -> one 30s-delayed retry -> booking-state transition, and an in-memory
  audit log), plus a minimal `NotificationService` port used to send an email + SMS on
  successful confirmation. The goal is to secure funds before service delivery while never
  letting raw card data reach the platform, and to make capture failures degrade to a
  recoverable "pending payment" state instead of an outright cancellation. Existing modules
  (auth, cart) are untouched except for `app.ts`, which gains the new dependencies and one new
  route, following the same optional-injected-dependency pattern already used for
  `cartRepository`/`pizzaRepository`.

scope:
  - description: |
      Add the `Booking` domain model and an in-memory `BookingRepository` (mirrors
      `CartRepository`/`SessionRepository`): a booking is created elsewhere (out of scope) in
      status `awaiting_confirmation` and this repository exposes `create`, `findById`, and
      `updateStatus` so the payment flow can move it to `confirmed` or `pending_payment`.
    files:
      - src/booking/bookingModel.ts
      - src/booking/bookingRepository.ts
    rationale: |
      No booking module exists yet in the codebase (confirmed via grep — no hits for
      "booking" anywhere). The confirmation flow needs somewhere to read/write booking status,
      and an in-memory Map-backed repository matches the existing style
      (`src/cart/cartRepository.ts`, `src/sessions/sessionRepository.ts`).
  - description: |
      Add a `PaymentGateway` port (`authorize`/`capture`) plus a `StripePaymentGateway`
      adapter that implements it using the `stripe` npm SDK with `capture_method: "manual"`,
      so authorization and capture are two distinct, separately-callable steps.
    files:
      - src/payments/paymentGateway.ts
      - src/payments/stripePaymentGateway.ts
    rationale: |
      AC1-3 require the platform to hand Stripe a token (never raw card data) and to perform
      authorize and capture as distinct actions against that token. Modeling this as a port +
      adapter (same DI shape as `PizzaRepository`/`CartRepository` being passed into
      `CartService`) lets `PaymentService` be unit-tested against a fake gateway without
      hitting Stripe's real API.
  - description: |
      Add an in-memory `PaymentAuditLogRepository` that records one entry per capture attempt
      (bookingId, actorId, attempt number, outcome, timestamp).
    files:
      - src/payments/paymentAuditLogRepository.ts
    rationale: |
      AC8 requires every capture attempt (success or failure) to be logged with a timestamp
      and actor identifier, and requires this to be assertable in tests. The existing codebase
      logs via `console.log`/`console.warn` for informational purposes only (see
      `authController.ts`), which isn't queryable from a test; a small repository mirrors the
      project's existing "state lives in an injectable in-memory repository" convention instead
      of asserting on stdout.
  - description: |
      Add a `NotificationService` port (`sendBookingConfirmationEmail` /
      `sendBookingConfirmationSms`) with a default `LoggingNotificationService` adapter that
      just logs; no real email/SMS provider is integrated.
    files:
      - src/notifications/notificationService.ts
    rationale: |
      AC9 only requires that the customer "receives a confirmation via both email and SMS" on
      successful capture; it does not name a provider. A port + trigger point is the testable,
      minimal implementation. Wiring a real provider (SendGrid/Twilio/etc.) is speculative
      beyond what's stated and is called out under assumptions/open questions.
  - description: |
      Add `PaymentService.confirmBooking(bookingId, paymentToken, actorId)`, which
      authorizes once, attempts capture, on failure waits 30s (via `setTimeout`, mockable with
      `node:test`'s `mock.timers`) and retries capture exactly once, logs every attempt, and
      transitions the booking to `confirmed` (on any successful capture) or `pending_payment`
      (if both attempts fail) — never leaving it in `awaiting_confirmation` and never
      cancelling it outright. On success it fires both notifications.
    files:
      - src/payments/paymentService.ts
    rationale: |
      This is the orchestration unit that AC2, AC3, AC4, AC5, AC6, AC7, AC8, and AC9 all
      exercise. Keeping it as a plain class taking its four collaborators as constructor
      arguments (gateway, bookingRepository, auditLog, notificationService) matches
      `CartService`'s constructor-injection style and keeps it independently unit-testable
      without an HTTP server.
  - description: |
      Add `handleConfirmBooking` controller: extracts the bearer actor (reusing
      `verifyAccessToken`, same pattern as `cartController.ts`), rejects any request body
      containing raw card-data fields, requires a string `payment_token`, and otherwise calls
      `PaymentService.confirmBooking`.
    files:
      - src/booking/bookingController.ts
    rationale: |
      AC1 is enforced at this boundary: the endpoint must never accept raw card fields, only a
      Stripe token. This mirrors `handleAddToCart`'s validate-then-delegate shape.
  - description: |
      Wire the new dependencies into `createApp` (as optional, overridable `AppDependencies`
      fields, same as `cartRepository`) and add the `POST /bookings/:id/confirm` route.
    files:
      - src/app.ts
    rationale: |
      Every existing feature (auth, cart) is reachable only through routes registered in
      `handleRequest`/`createApp`; the booking-confirmation endpoint needs the same treatment
      to be reachable over HTTP and overridable by tests.
  - description: |
      Add a dummy `STRIPE_SECRET_KEY` to `.env.test` so `createApp()` can construct the default
      `StripePaymentGateway` at startup without a real secret (constructing the Stripe SDK
      client performs no network I/O; only `authorize`/`capture` calls would, and tests inject
      a fake gateway instead of exercising the real one).
    files:
      - .env.test
    rationale: |
      `tokenService.ts` already throws at import time if `JWT_SECRET` is unset, and `.env.test`
      supplies a `test-only-secret-do-not-use-in-production` value for it. The same pattern is
      needed for `STRIPE_SECRET_KEY` so unrelated tests (login, cart) that call `createApp()`
      with no overrides don't fail to even construct the app.

tests:
  - |
    AC1 (`test/bookingConfirmation.test.ts`, HTTP-level via `startTestServer`): a booking is
    seeded with `bookingRepository.create({ customerId, amount: 2500, currency: "usd" })` in
    status `awaiting_confirmation`. Posting to `/bookings/:id/confirm` with a body containing
    raw card fields is rejected before any gateway call is made:
    ```ts
    const res = await confirmBooking(server.baseUrl, accessToken, booking.id, {
      card_number: "4242424242424242",
      cvv: "123",
    });
    assert.equal(res.status, 400);
    assert.equal(fakeGateway.authorizeCalls.length, 0);
    ```
    A second test in the same file asserts a request with only `payment_token` is accepted and
    forwarded to the gateway verbatim:
    ```ts
    const res = await confirmBooking(server.baseUrl, accessToken, booking.id, { payment_token: "tok_visa" });
    assert.equal(res.status, 200);
    assert.equal(fakeGateway.authorizeCalls[0].paymentToken, "tok_visa");
    ```
    Minimal code: `handleConfirmBooking` in `src/booking/bookingController.ts` inspects the
    parsed body for any of `card_number`/`cvc`/`cvv`/`expiry_month`/`expiry_year` and returns
    400 if present, otherwise requires `typeof payment_token === "string"`.
  - |
    AC2 (`test/paymentCapture.test.ts`, unit-level against `PaymentService` with a fake
    `PaymentGateway`): authorize is called once with the booking's token, amount and currency.
    ```ts
    await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    assert.deepEqual(gateway.authorizeCalls, [{ paymentToken: "tok_visa", amount: booking.amount, currency: booking.currency }]);
    ```
    Minimal code: `PaymentService.confirmBooking` calls
    `this.gateway.authorize(paymentToken, booking.amount, booking.currency)` before any capture
    attempt.
  - |
    AC3 (`test/paymentCapture.test.ts`): capture is called against the `paymentIntentId`
    returned by authorize.
    ```ts
    const gateway = new FakeGateway({ authorizeResult: { paymentIntentId: "pi_test_123" } });
    await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    assert.equal(gateway.captureCalls[0], "pi_test_123");
    ```
    Minimal code: after a successful authorize, call `this.gateway.capture(authorization.paymentIntentId)`.
  - |
    AC4 (`test/paymentCapture.test.ts`): a successful capture transitions the booking to
    `confirmed`.
    ```ts
    const result = await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    assert.equal(result.status, "confirmed");
    assert.equal(bookingRepository.findById(booking.id)?.status, "confirmed");
    ```
    Minimal code: on capture success, call `this.bookingRepository.updateStatus(booking.id, "confirmed")`.
  - |
    AC5 (`test/paymentCapture.test.ts`, timers mocked): immediately after the first capture
    attempt fails, and before the 30s retry has elapsed, the booking is not confirmed.
    ```ts
    mock.timers.enable({ apis: ["setTimeout"] });
    const gateway = new FakeGateway({ captureBehavior: "always-fail" });
    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await Promise.resolve();
    await Promise.resolve();
    assert.notEqual(bookingRepository.findById(booking.id)?.status, "confirmed");
    mock.timers.tick(30_000);
    await confirmPromise;
    ```
    Minimal code: the booking's status is only updated after the whole
    authorize/capture/retry sequence resolves, never optimistically.
  - |
    AC6 (`test/paymentCapture.test.ts`, timers mocked): a capture that fails once then
    succeeds is retried exactly once, exactly 30 seconds later.
    ```ts
    mock.timers.enable({ apis: ["setTimeout"] });
    const gateway = new FakeGateway({ captureBehavior: "fail-then-succeed" });
    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(gateway.captureCalls.length, 1);
    mock.timers.tick(29_999);
    assert.equal(gateway.captureCalls.length, 1);
    mock.timers.tick(1);
    const result = await confirmPromise;
    assert.equal(gateway.captureCalls.length, 2);
    assert.equal(result.status, "confirmed");
    ```
    Minimal code: `export const CAPTURE_RETRY_DELAY_MS = 30_000;` in `paymentService.ts`; on
    first capture failure, `await new Promise<void>((resolve) => setTimeout(resolve, CAPTURE_RETRY_DELAY_MS));`
    then attempt capture exactly one more time (no loop).
  - |
    AC7 (`test/paymentCapture.test.ts`, timers mocked): when the retried capture also fails,
    the booking moves to `pending_payment`, not a cancelled state.
    ```ts
    mock.timers.enable({ apis: ["setTimeout"] });
    const gateway = new FakeGateway({ captureBehavior: "always-fail" });
    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await Promise.resolve();
    await Promise.resolve();
    mock.timers.tick(30_000);
    const result = await confirmPromise;
    assert.equal(result.status, "pending_payment");
    assert.equal(gateway.captureCalls.length, 2);
    ```
    Minimal code: if the second capture attempt also throws, call
    `this.bookingRepository.updateStatus(booking.id, "pending_payment")` and return that
    booking (no cancellation path exists anywhere in this module).
  - |
    AC8 (`test/paymentCapture.test.ts`, timers mocked with `Date` included so timestamps
    advance with `tick`): every attempt (success or failure) is logged with a timestamp and
    actor id.
    ```ts
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const gateway = new FakeGateway({ captureBehavior: "fail-then-succeed" });
    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "actor-42");
    await Promise.resolve();
    await Promise.resolve();
    mock.timers.tick(30_000);
    await confirmPromise;
    const entries = auditLog.findByBookingId(booking.id);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].outcome, "failure");
    assert.equal(entries[1].outcome, "success");
    assert.ok(entries.every((e) => e.actorId === "actor-42" && typeof e.timestamp === "number"));
    assert.equal(entries[1].timestamp - entries[0].timestamp, 30_000);
    ```
    Minimal code: `attemptCapture` records to `this.auditLog` in both the try and catch
    branches, before returning success/failure.
  - |
    AC9 (`test/paymentCapture.test.ts`): on a successful capture, both an email and an SMS
    confirmation are sent; on total failure, neither is sent.
    ```ts
    const result = await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    assert.deepEqual(notificationService.emailsSent, [{ customerId: booking.customerId, bookingId: booking.id }]);
    assert.deepEqual(notificationService.smsSent, [{ customerId: booking.customerId, bookingId: booking.id }]);
    ```
    and, in the always-fail scenario:
    ```ts
    assert.equal(notificationService.emailsSent.length, 0);
    assert.equal(notificationService.smsSent.length, 0);
    ```
    Minimal code: only after `updateStatus(..., "confirmed")` succeeds, call
    `await Promise.all([this.notificationService.sendBookingConfirmationEmail(booking.customerId, booking.id), this.notificationService.sendBookingConfirmationSms(booking.customerId, booking.id)]);`.

assumptions_or_open_questions:
  - |
    Booking creation itself (how a booking first enters `awaiting_confirmation`, pricing,
    catalog linkage) is out of scope for this story — it's assumed to already exist or be
    delivered by a separate story. `BookingRepository.create()` is added only as the minimal
    seam tests need to set up a booking to confirm.
  - |
    The confirm endpoint does not accept `amount`/`currency` from the client — those come from
    the already-created booking record — to avoid trusting a client-supplied charge amount.
    Flagging this as an assumption since no AC states it explicitly.
  - "The audit log's actor identifier is the authenticated caller's user id from the bearer access token (i.e. the customer confirming their own booking). Staff/admin confirming on a customer's behalf is out of scope."
  - |
    Real email/SMS delivery (a provider like SendGrid/Twilio) is explicitly out of scope; only
    the `NotificationService` port and a logging default adapter are implemented. Wiring a real
    provider is a follow-up and would need its own package_dependencies entry once chosen.
  - |
    Retrying `capture()` against the same Stripe PaymentIntent id on transient failure is
    assumed safe/idempotent (it targets the same intent, not a new charge). This plan does not
    add explicit Stripe idempotency-key handling; if Stripe's real error taxonomy has failure
    modes where a "failed" capture actually succeeded server-side, a second capture call could
    behave unexpectedly — worth validating against Stripe's docs before going live, but out of
    scope for this in-memory/fake-gateway-tested plan.
  - "`STRIPE_SECRET_KEY` is read once from the environment (same pattern as `JWT_SECRET` in `src/auth/tokenService.ts`), and a non-secret placeholder value is added to `.env.test` purely so app construction succeeds; no test exercises the real Stripe network client."

package_dependencies:
  - name: stripe
    version: ^17.4.0
    ecosystem: npm
    rationale: |
      `StripePaymentGateway` (src/payments/stripePaymentGateway.ts) needs the official Stripe
      Node SDK to create/confirm PaymentIntents with `capture_method: "manual"` (authorize)
      and to call `paymentIntents.capture()` (capture). Nothing in the current codebase
      depends on it today (`package.json` has no dependencies at all yet).

notes: |
  No file currently mentions "booking" anywhere in the repo (verified by grep), so this is a
  net-new module pair (`booking`, `payments`) plus a small `notifications` port, wired into the
  existing `app.ts` router the same way `cart` was wired in QAM-MANOJ-STORY-050. AC2/AC3/AC4/
  AC5/AC6/AC7/AC8/AC9 are all covered by direct unit tests against `PaymentService` (fast,
  deterministic, using `node:test`'s `mock.timers` to compress the 30s retry delay) rather than
  through the HTTP layer, to avoid mocking global timers underneath a real `fetch`/HTTP
  round-trip. AC1 is the one boundary concern that genuinely needs the HTTP layer, since it's
  about what the controller accepts/rejects.

  ```mermaid
  flowchart TD
    classDef touched fill:#f96,color:#000

    app["src/app.ts (createApp/handleRequest)"]:::touched
    bookingController["src/booking/bookingController.ts\nhandleConfirmBooking"]:::touched
    bookingRepo["src/booking/bookingRepository.ts"]:::touched
    paymentService["src/payments/paymentService.ts\nPaymentService.confirmBooking"]:::touched
    paymentGateway["src/payments/paymentGateway.ts\n(PaymentGateway port)"]:::touched
    stripeGateway["src/payments/stripePaymentGateway.ts\n(Stripe SDK adapter)"]:::touched
    auditLog["src/payments/paymentAuditLogRepository.ts"]:::touched
    notification["src/notifications/notificationService.ts"]:::touched
    tokenService["src/auth/tokenService.ts\nverifyAccessToken (existing, reused)"]
    httpUtils["src/httpUtils.ts\nasRecord/sendJson (existing, reused)"]

    app -->|"registers POST /bookings/:id/confirm"| bookingController
    bookingController -->|"extracts actor id, same as cartController"| tokenService
    bookingController -->|"validates body via asRecord"| httpUtils
    bookingController -->|"delegates confirm(bookingId, token, actorId)"| paymentService
    paymentService -->|"authorize() then capture(), retry once after 30s"| paymentGateway
    paymentGateway -.->|"real impl"| stripeGateway
    paymentService -->|"read/updateStatus"| bookingRepo
    paymentService -->|"record every attempt"| auditLog
    paymentService -->|"on success only"| notification
  ```
