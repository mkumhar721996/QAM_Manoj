summary: |
  This story has no existing code to build on: the repository currently has no payments, booking,
  or notification domain at all (only auth/session, cart, and pizza catalog modules), and the
  `User` model has no email address. The plan adds a new, self-contained `src/notifications`
  module — domain types, an `EmailSender` abstraction (with a console-logging default
  implementation, since no real email provider/credentials exist in this codebase yet), a
  `DeliveryLogRepository` for logging and duplicate-suppression, and a `NotificationService` that
  exposes two entry points (`notifyRefundIssued`, `notifyCaptureFailureAttempt`) that a future
  payments/booking story will call when a refund is issued or a capture attempt fails. It also
  adds an `email` field to the existing `User` fixture so the service can resolve "the customer's
  account email on file" (AC5) via the existing `UserRepository`, reusing the current
  auth/session conventions (in-memory repositories, constructor-injected dependencies, `now`
  parameters for testability) rather than introducing new infrastructure.
scope:
  - description: |
      Add an `email` field to the `User` model and seed data so notifications have a real
      "account email on file" to deliver to, per AC5.
    files:
      - src/users/fixtures/testUsers.ts
    rationale: |
      `UserRepository` (src/users/userRepository.ts) is the only existing "customer account"
      store in the codebase. Reusing it (rather than inventing a separate customer/email store)
      keeps this story consistent with how `AuthService` already resolves users by id, and
      avoids a second source of truth for account email.
  - description: |
      Define the notification domain types: the two triggering events and the delivery log
      shape.
      ```ts
      export type NotificationType = "refund_issued" | "capture_failed";
      export type DeliveryStatus = "sent" | "permanently_failed";

      export interface RefundIssuedEvent {
        transactionId: string;
        customerId: string;
        refundAmount: number;
        currency: string;
        originalPaymentMethod: string;
      }

      export interface CaptureFailureAttemptEvent {
        transactionId: string;
        customerId: string;
        attemptNumber: number;
        maxAttempts: number;
      }

      export interface DeliveryLogEntry {
        id: string;
        notificationType: NotificationType;
        transactionId: string;
        recipientEmail: string;
        status: DeliveryStatus;
        timestamp: number;
      }
      ```
    files:
      - src/notifications/notificationModel.ts
    rationale: |
      No payment-capture or booking-cancellation domain exists yet in this codebase (the parent
      epic's capture/disbursement/invoice work is unimplemented). `attemptNumber`/`maxAttempts`
      on `CaptureFailureAttemptEvent` is the minimal shape needed to satisfy both AC2 ("after all
      retries") and AC4 ("retries remain") from a single call site, without speculatively
      building the retry-tracking machinery that will actually live in the future capture-attempt
      story.
  - description: |
      Add an `EmailSender` interface and a default `ConsoleEmailSender` implementation (no real
      SMTP/provider integration exists in this repo, so a console-logging default is the minimal
      concrete sender; see assumptions).
      ```ts
      export interface EmailMessage {
        to: string;
        subject: string;
        body: string;
      }
      export interface EmailSender {
        send(message: EmailMessage): Promise<void>;
      }
      ```
    files:
      - src/notifications/emailSender.ts
    rationale: |
      `NotificationService` must depend on an injectable abstraction (matching the constructor-
      injection style already used by `CartService`/`AuthService`) so tests can supply a fake
      sender that fails on demand to exercise retry (AC6) and permanent-failure (AC7) paths.
  - description: |
      Add an in-memory `DeliveryLogRepository` that records the final delivery outcome per
      notification and answers "has this transaction/notification-type already been sent" for
      duplicate suppression.
      ```ts
      class DeliveryLogRepository {
        recordSent(type: NotificationType, transactionId: string, recipientEmail: string, now?: number): DeliveryLogEntry;
        recordPermanentlyFailed(type: NotificationType, transactionId: string, recipientEmail: string, now?: number): DeliveryLogEntry;
        hasSucceeded(type: NotificationType, transactionId: string): boolean;
        getAll(): DeliveryLogEntry[];
      }
      ```
    files:
      - src/notifications/deliveryLogRepository.ts
    rationale: |
      Mirrors the existing `Map`-backed in-memory repository pattern (`CartRepository`,
      `SessionRepository`). `hasSucceeded` is the dedup check backing AC8; `recordSent`/
      `recordPermanentlyFailed` back AC3/AC7.
  - description: |
      Add `NotificationService`, the orchestrator: resolves the customer's email via
      `UserRepository`, checks for a prior successful send (AC8), composes the email body, retries
      delivery a fixed number of times on failure (AC6), and logs the final outcome (AC3/AC7).
      ```ts
      class NotificationService {
        constructor(
          userRepository: UserRepository,
          deliveryLogRepository: DeliveryLogRepository,
          emailSender: EmailSender,
          maxDeliveryAttempts: number = 3,
        );
        notifyRefundIssued(event: RefundIssuedEvent): Promise<void>;
        notifyCaptureFailureAttempt(event: CaptureFailureAttemptEvent): Promise<void>;
      }
      ```
    files:
      - src/notifications/notificationService.ts
    rationale: |
      A single private `sendIfNotDuplicate` path shared by both public methods keeps the retry/
      log/dedup logic in one place, so AC3/AC6/AC7/AC8 apply uniformly to both notification types
      instead of being duplicated per trigger.
  - description: |
      Test suites, one per logical grouping of acceptance criteria (see `tests` for the exact
      failing assertions).
    files:
      - test/refundNotification.test.ts
      - test/captureFailureNotification.test.ts
      - test/notificationDelivery.test.ts
    rationale: |
      Follows the existing convention of one `*.test.ts` file per feature area (e.g.
      `test/cartCustomisation.test.ts`), split here by trigger (refund vs. capture-failure) plus
      one file for the cross-cutting delivery/retry/log/dedup behaviour that applies to both.
tests:
  - |
    AC1 — `test/refundNotification.test.ts`: build a `NotificationService` with a real
    `UserRepository` (seeded with `email: "u1@example.com"`), an in-memory
    `DeliveryLogRepository`, and a `FakeEmailSender` that records sent messages. Call
    `await service.notifyRefundIssued({ transactionId: "txn-1", customerId: "user-customer-1", refundAmount: 24.5, currency: "USD", originalPaymentMethod: "Visa ending 4242" })`
    then assert:
    ```ts
    assert.equal(emailSender.sentMessages.length, 1);
    assert.match(emailSender.sentMessages[0].body, /24\.5/);
    assert.match(emailSender.sentMessages[0].body, /Visa ending 4242/);
    ```
    This fails first because neither `NotificationService` nor `notificationModel.ts` exist.
    Minimal code: add `RefundIssuedEvent` to `notificationModel.ts` and implement
    `notifyRefundIssued` in `notificationService.ts` to compose a body containing the amount and
    original payment method and call `emailSender.send`.
  - |
    AC2 — `test/captureFailureNotification.test.ts`: call
    `await service.notifyCaptureFailureAttempt({ transactionId: "txn-2", customerId: "user-customer-1", attemptNumber: 3, maxAttempts: 3 })`
    (final attempt) and assert:
    ```ts
    assert.equal(emailSender.sentMessages.length, 1);
    assert.match(emailSender.sentMessages[0].body, /update your payment method/i);
    ```
    Fails first because `notifyCaptureFailureAttempt` does not exist. Minimal code: implement it
    in `notificationService.ts` to compose a failure-explanation body and send when
    `attemptNumber >= maxAttempts`.
  - |
    AC3 — `test/notificationDelivery.test.ts`: after a successful `notifyRefundIssued` call,
    assert a log entry exists with a timestamp and recipient identifier:
    ```ts
    const before = Date.now();
    await service.notifyRefundIssued(event);
    const [entry] = deliveryLogRepository.getAll();
    assert.equal(entry.recipientEmail, "u1@example.com");
    assert.ok(entry.timestamp >= before);
    assert.equal(entry.status, "sent");
    ```
    Fails first because `DeliveryLogRepository` does not exist. Minimal code: implement
    `recordSent` and call it from `NotificationService` after a successful send.
  - |
    AC4 — `test/captureFailureNotification.test.ts`: call
    `await service.notifyCaptureFailureAttempt({ transactionId: "txn-3", customerId: "user-customer-1", attemptNumber: 1, maxAttempts: 3 })`
    (retries remain) and assert:
    ```ts
    assert.equal(emailSender.sentMessages.length, 0);
    assert.equal(deliveryLogRepository.getAll().length, 0);
    ```
    Fails first because there is no guard against non-final attempts. Minimal code: add the
    `if (event.attemptNumber < event.maxAttempts) return;` early-return in
    `notifyCaptureFailureAttempt` before any send/log occurs.
  - |
    AC5 — `test/refundNotification.test.ts`: assert the resolved recipient is the user's email on
    file rather than any other identifier:
    ```ts
    assert.equal(emailSender.sentMessages[0].to, "u1@example.com");
    ```
    Fails first because `NotificationService` has no way to resolve a customer's email. Minimal
    code: inject `UserRepository` into `NotificationService` and call
    `userRepository.findById(event.customerId)?.email` to build the `EmailMessage.to` field
    (requires the `email` field added to `User` in scope item 1).
  - |
    AC6 — `test/notificationDelivery.test.ts`: use a `FakeEmailSender` configured to fail twice
    then succeed (`new FakeEmailSender({ failTimes: 2 })`), call `notifyRefundIssued`, and assert:
    ```ts
    assert.equal(emailSender.attemptCount, 3);
    assert.equal(deliveryLogRepository.getAll()[0].status, "sent");
    ```
    Fails first because sending is currently a single attempt with no retry loop. Minimal code:
    wrap the `emailSender.send` call in `sendIfNotDuplicate` in a
    `for (let attempt = 1; attempt <= this.maxDeliveryAttempts; attempt++)` loop that returns on
    the first success.
  - |
    AC7 — `test/notificationDelivery.test.ts`: use a `FakeEmailSender` configured to always fail
    (`new FakeEmailSender({ failTimes: Infinity })`), call `notifyRefundIssued`, and assert:
    ```ts
    assert.equal(emailSender.attemptCount, 3);
    assert.equal(deliveryLogRepository.getAll()[0].status, "permanently_failed");
    ```
    Fails first because there is no terminal "give up" branch. Minimal code: after the retry loop
    in `sendIfNotDuplicate` exhausts `maxDeliveryAttempts` without success, call
    `deliveryLogRepository.recordPermanentlyFailed(...)`.
  - |
    AC8 — `test/refundNotification.test.ts`: call `notifyRefundIssued` twice with the same
    `transactionId` and assert no duplicate send:
    ```ts
    await service.notifyRefundIssued(event);
    await service.notifyRefundIssued(event);
    assert.equal(emailSender.sentMessages.length, 1);
    ```
    Fails first because there is no duplicate check. Minimal code: at the top of
    `sendIfNotDuplicate`, `if (this.deliveryLogRepository.hasSucceeded(type, transactionId)) return;`.
assumptions_or_open_questions:
  - "No real email provider/SMTP integration exists anywhere in this codebase (no credentials in .env/.env.test, no mail library dependency). This plan implements `EmailSender` as an injectable interface with a `ConsoleEmailSender` default so the feature is testable and complete on its own; wiring a real provider (e.g. SES/SendGrid) is left for a future infra story."
  - "The 'fixed number of retries' in AC6/AC7 is not specified numerically by the story. This plan defaults `maxDeliveryAttempts` to 3 total attempts (1 initial + 2 retries), configurable via the `NotificationService` constructor."
  - "Neither a payment-capture-attempt domain nor a booking-cancellation domain exists yet in this codebase (the parent epic's capture/disbursement work is unimplemented). This plan does not invent that domain; it only adds the two call-in points (`notifyRefundIssued`, `notifyCaptureFailureAttempt`) that a future payments/booking story is expected to call with the given event shapes."
  - "AC2's 'booking is cancelled' and AC4's 'attempt fails but retries remain' are modeled as the same entry point (`notifyCaptureFailureAttempt`) distinguished by `attemptNumber >= maxAttempts`, since no separate booking-cancellation trigger exists yet to call a distinct method."
  - "Retries are performed synchronously in-process with no delay/backoff between attempts, since no scheduler/queue infrastructure exists in this codebase to defer a retry."
  - "The `User` fixture's new `email` field is assumed to be a plausible stand-in for the real 'account email on file' referenced by AC5; no other account/profile store exists to source it from."
package_dependencies: []
notes: |
  This module is intentionally decoupled from any specific caller: no route in `src/app.ts` is
  added, because there is no existing refund/booking-cancellation/capture-attempt HTTP endpoint
  or domain object to trigger it from yet. `NotificationService` is designed to be called
  directly (as the tests do) by whichever future payments story implements refund execution and
  capture-retry handling.

  ```mermaid
  flowchart TD
    TU[testUsers.ts fixtures]
    UR[UserRepository]
    NM[notificationModel.ts]
    ES[emailSender.ts]
    DLR[deliveryLogRepository.ts]
    NS[notificationService.ts]

    TU -->|adds email field| UR
    UR -->|findById resolves account email - AC5| NS
    NM -->|event and log types| NS
    ES -->|send, retried on failure - AC6/AC7| NS
    DLR -->|dedup check + log outcome - AC3/AC7/AC8| NS

    classDef touched fill:#f96,color:#000
    class TU,UR,NM,ES,DLR,NS touched
  ```
