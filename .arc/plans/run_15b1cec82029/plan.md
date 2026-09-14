summary: |
  This is a greenfield feature: the codebase currently only has login/session-management code
  (src/auth, src/sessions, src/users) and no booking domain at all. This plan adds a minimal
  booking domain (Booking model + in-memory repository), a cancellation-policy-window helper, a
  notification stub, a RescheduleService encapsulating the reschedule business rules, and a
  POST /bookings/:id/reschedule HTTP endpoint wired into the existing single-process app.ts
  router, following the exact layering already used for auth (repository -> service -> controller
  -> app.ts route dispatch, with a hand-rolled JSON HTTP layer and node:test + fetch-based
  integration tests). Every acceptance criterion is covered by an integration test hitting the
  real HTTP endpoint via the existing startTestServer test harness, matching the style of
  test/login.test.ts and test/refresh.test.ts.

scope:
  - description: |
      Add the Booking domain model and an in-memory BookingRepository, mirroring the existing
      SessionRepository pattern (Map-backed, constructor-injectable for tests).

      ```ts
      // src/bookings/bookingModel.ts
      export type BookingStatus = "confirmed" | "cancelled" | "completed";

      export interface RescheduleEvent {
        timestamp: number;
        actingUserId: string;
        previousStartTime: number;
        newStartTime: number;
      }

      export interface Booking {
        id: string;
        customerId: string;
        providerId: string;
        startTime: number;
        endTime: number;
        status: BookingStatus;
        cancellationPolicyWindowStart: number;
        rescheduleHistory: RescheduleEvent[];
      }
      ```

      ```ts
      // src/bookings/bookingRepository.ts (key methods)
      create(input: {
        id?: string;
        customerId: string;
        providerId: string;
        startTime: number;
        endTime: number;
        status?: BookingStatus;
      }): Booking;
      findById(id: string): Booking | undefined;
      findConfirmedByProviderAndTime(
        providerId: string,
        startTime: number,
        endTime: number,
        excludeBookingId?: string,
      ): Booking | undefined; // overlap check: startTime < other.endTime && endTime > other.startTime
      ```
    files:
      - src/bookings/bookingModel.ts
      - src/bookings/bookingRepository.ts
    rationale: |
      No booking domain exists yet in the repo (confirmed by reading src/**; only auth/session/user
      modules exist). A dedicated repository is needed so the reschedule service can look up the
      booking being rescheduled and detect slot conflicts (AC1, AC2, AC8, AC9, AC10), following the
      same DI-friendly, test-injectable pattern as SessionRepository/UserRepository.

  - description: |
      Add a cancellation-policy-window helper used both at booking creation (so
      cancellationPolicyWindowStart is always populated) and recalculated on every reschedule.

      ```ts
      // src/bookings/cancellationPolicy.ts
      export const CANCELLATION_POLICY_WINDOW_HOURS = 24;
      export function computeCancellationWindowStart(
        appointmentStartTime: number,
        windowHours: number = CANCELLATION_POLICY_WINDOW_HOURS,
      ): number {
        return appointmentStartTime - windowHours * 60 * 60 * 1000;
      }
      ```
    files:
      - src/bookings/cancellationPolicy.ts
    rationale: |
      AC3 requires the cancellation policy window to be recalculated relative to the *new*
      appointment time after a reschedule. The parent epic notes the policy's actual rules are
      configurable and owned elsewhere, so this plan only needs a single pure function the
      reschedule service calls with the new start time - it deliberately does not build a full
      configurable-policy engine, which is out of scope for this story.

  - description: |
      Add a minimal NotificationService that both logs and records sent notifications, so tests
      can assert both parties were notified without needing a real email/SMS integration.

      ```ts
      // src/notifications/notificationService.ts
      export interface NotificationRecord { userId: string; message: string; sentAt: number; }
      export class NotificationService {
        notify(userId: string, message: string, now: number = Date.now()): void;
        getNotificationsForUser(userId: string): NotificationRecord[];
      }
      ```
    files:
      - src/notifications/notificationService.ts
    rationale: |
      AC6 requires both customer and provider to be notified. No notification infrastructure
      exists in the repo today. A single in-memory recorder (console.log + an inspectable array),
      injected the same way SessionRepository/UserRepository are, is the minimal viable
      implementation; actual delivery (email/SMS) is explicitly out of scope (see
      assumptions_or_open_questions).

  - description: |
      Add RescheduleService encapsulating the reschedule business rules: ownership + status
      checks, slot-conflict re-check, mutation, cancellation-window recalculation, history
      recording, and notification dispatch.

      ```ts
      // src/bookings/rescheduleService.ts
      export class BookingNotFoundError extends Error {}       // also used to hide ownership mismatches (AC12)
      export class BookingNotReschedulableError extends Error {} // AC8: status !== "confirmed"
      export class SlotUnavailableError extends Error {}          // AC9

      export class RescheduleService {
        constructor(bookingRepository: BookingRepository, notificationService: NotificationService) {}
        reschedule(
          bookingId: string,
          actingUserId: string,
          newStartTime: number,
          newEndTime: number,
          now?: number,
        ): Booking;
      }
      ```
    files:
      - src/bookings/rescheduleService.ts
    rationale: |
      Mirrors AuthService: a plain class taking repositories in its constructor, throwing typed
      errors the controller maps to HTTP status codes (same pattern as
      InvalidCredentialsError/InvalidRefreshTokenError in authService.ts). Re-checking slot
      availability at confirm time (rather than trying to implement a slot "hold" mechanism) is
      the minimal way to satisfy AC9/AC10/AC11: the check runs, and only on success does the
      booking get mutated, so a losing race leaves the original booking untouched.

  - description: |
      Add the HTTP controller function for the reschedule endpoint, mirroring authController.ts:
      Bearer-token auth check, request body validation, and error-to-status-code mapping.

      ```ts
      // src/bookings/rescheduleController.ts
      export function handleReschedule(
        rescheduleService: RescheduleService,
        authorizationHeader: string | undefined,
        bookingId: string,
        requestBody: unknown,
        now?: number,
      ): ControllerResponse;
      ```

      Status mapping: no/invalid token -> 401 (`{ error: "authentication required, please log in" }`,
      AC5); booking missing or owned by another customer -> 404 with the *same* generic body for
      both cases (AC12); status not "confirmed" -> 409 (AC8); slot conflict -> 409 with a message
      telling the customer to pick a different slot (AC11).
    files:
      - src/bookings/rescheduleController.ts
    rationale: |
      Reuses `verifyAccessToken` from tokenService.ts exactly as handleGetSession already does, and
      reuses the `ControllerResponse` shape exported from authController.ts, so behavior is
      consistent with the existing auth flow rather than inventing a second auth-check style.

  - description: |
      Wire booking dependencies and the new route into app.ts.

      ```ts
      // src/app.ts - before
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
      }
      // after
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        bookingRepository?: BookingRepository;
        notificationService?: NotificationService;
      }
      ```

      Add route dispatch for the dynamic path segment (current router only does exact
      `${method} ${pathname}` string matches):

      ```ts
      const rescheduleMatch = url.pathname.match(/^\/bookings\/([^/]+)\/reschedule$/);
      if (method === "POST" && rescheduleMatch) {
        const body = await readJsonBody(req);
        const result = handleReschedule(rescheduleService, req.headers.authorization, rescheduleMatch[1], body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - src/app.ts
    rationale: |
      app.ts is the single composition root today (it already constructs UserRepository,
      SessionRepository, AuthService and dispatches every route) - the new booking dependencies and
      route must be added here rather than creating a second server/router, since server.ts just
      calls createApp() once.

  - description: |
      Add a second seeded customer to the shared test-user fixtures, needed to test that one
      customer cannot reschedule another customer's booking (AC12).

      ```ts
      // src/users/fixtures/testUsers.ts - add to testUserSeeds
      { id: "user-customer-2", username: "customer2", role: "customer" },
      ```
    files:
      - src/users/fixtures/testUsers.ts
    rationale: |
      testUsers.ts currently seeds exactly one customer, one provider, one admin - AC12 needs two
      distinct customers to express "booking owned by a different customer." This is purely
      additive and does not change existing login/refresh/logout test behavior (those tests key off
      "customer1", which is untouched).

  - description: |
      Add the integration test suite for this story, following the existing
      test/login.test.ts / test/refresh.test.ts style (node:test + fetch against startTestServer,
      one test per AC, AC-numbered test names).
    files:
      - test/reschedule.test.ts
    rationale: |
      Matches the existing convention of black-box HTTP tests over the real createApp() listener
      rather than unit-testing the service in isolation, so the tests exercise the exact route
      wiring, auth-header parsing, and JSON contract a real client would use.

tests:
  - |
    AC1 (booking updated to new time): seed a confirmed booking via `bookingRepository.create(...)`,
    log in as customer1 to get an access token, POST
    `/bookings/{id}/reschedule` with `{ new_start_time, new_end_time }`, then assert:
    ```ts
    assert.equal(res.status, 200);
    const updated = bookingRepository.findById(booking.id)!;
    assert.equal(updated.startTime, newStartTime);
    assert.equal(updated.endTime, newEndTime);
    ```
  - |
    AC2 (original slot released): after the AC1 reschedule succeeds, assert the old slot is free:
    ```ts
    assert.equal(
      bookingRepository.findConfirmedByProviderAndTime(booking.providerId, originalStart, originalEnd),
      undefined,
    );
    ```
  - |
    AC3 (cancellation window recalculated from new time, not original): after rescheduling,
    ```ts
    const updated = bookingRepository.findById(booking.id)!;
    assert.equal(updated.cancellationPolicyWindowStart, computeCancellationWindowStart(newStartTime));
    assert.notEqual(updated.cancellationPolicyWindowStart, computeCancellationWindowStart(originalStart));
    ```
  - |
    AC4 (unlimited reschedules): reschedule the same booking 3 times in sequence with 3 different
    slots, asserting `res.status === 200` each time, then:
    ```ts
    assert.equal(bookingRepository.findById(booking.id)!.rescheduleHistory.length, 3);
    ```
  - |
    AC5 (unauthenticated rejected): POST to the reschedule endpoint with no Authorization header:
    ```ts
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "authentication required, please log in");
    ```
  - |
    AC6 (both parties notified): after a successful reschedule,
    ```ts
    assert.equal(notificationService.getNotificationsForUser(booking.customerId).length, 1);
    assert.equal(notificationService.getNotificationsForUser(booking.providerId).length, 1);
    ```
  - |
    AC7 (timestamp + acting user recorded): after a successful reschedule,
    ```ts
    const event = bookingRepository.findById(booking.id)!.rescheduleHistory.at(-1)!;
    assert.equal(event.actingUserId, "user-customer-1");
    assert.equal(typeof event.timestamp, "number");
    ```
  - |
    AC8 (non-confirmed booking rejected): seed a booking with `status: "cancelled"`, attempt
    reschedule:
    ```ts
    assert.equal(res.status, 409);
    ```
  - |
    AC9 (slot taken before confirm is rejected): seed booking A (confirmed) for provider P, seed a
    second confirmed booking C occupying the target slot for the same provider P, then attempt to
    reschedule A into that slot:
    ```ts
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /no longer available/i);
    ```
  - |
    AC10 (original booking unchanged on conflict): after the AC9 conflict response,
    ```ts
    const unchanged = bookingRepository.findById(bookingA.id)!;
    assert.equal(unchanged.startTime, originalStart);
    assert.equal(unchanged.endTime, originalEnd);
    ```
  - |
    AC11 (prompted to pick a different slot): reuses the AC9 response body -
    ```ts
    assert.match(body.error, /choose a different|select a different/i);
    ```
  - |
    AC12 (cross-customer reschedule hidden): seed a booking owned by `user-customer-2`, log in as
    `customer1`, attempt to reschedule it, and compare against a nonexistent-id request:
    ```ts
    assert.equal(res.status, 404);
    const otherOwnerBody = await res.json();
    const missingRes = await fetch(`${baseUrl}/bookings/does-not-exist/reschedule`, { ...sameOptions });
    assert.equal(missingRes.status, 404);
    const missingBody = await missingRes.json();
    assert.deepEqual(otherOwnerBody, missingBody);
    ```
  - |
    AC13 (reschedule within an hour of start permitted): seed a confirmed booking with
    `startTime: Date.now() + 30 * 60 * 1000`, attempt reschedule:
    ```ts
    assert.equal(res.status, 200);
    ```

assumptions_or_open_questions:
  - "No booking-creation endpoint exists yet in this codebase (this story is purely about rescheduling an already-confirmed booking). Tests seed bookings directly via `bookingRepository.create(...)`, matching how test/refresh.test.ts seeds sessions directly via `sessionRepository.create(...)`."
  - "The cancellation policy window duration itself (24 hours) is a placeholder constant (`CANCELLATION_POLICY_WINDOW_HOURS`) since the parent epic states the policy is configurable and owned by a separate concern; AC3 only requires that the window is recalculated relative to the new time, not any specific duration."
  - "Notification delivery is a same-process, in-memory recorder (console.log + inspectable array), not a real email/SMS integration - AC6 only requires that both parties are notified, not through which channel."
  - "Authorization for the reschedule endpoint is ownership-only (booking.customerId === authenticated user id); there is no additional role check restricting the endpoint to users with role \"customer\", since no AC exercises a provider/admin calling this endpoint and the ownership check alone satisfies AC12."
  - "The new endpoint is `POST /bookings/:id/reschedule` with a JSON body of `{ new_start_time, new_end_time }` as epoch-millisecond numbers, matching the millisecond-timestamp convention already used throughout src/sessions (e.g. `expiresAt`, `createdAt`) rather than ISO date strings."
  - "AC9/10/11's race condition (\"slot becomes unavailable ... before they confirm\") is tested by seeding the competing booking before the reschedule confirm call, since there is no separate slot-hold/reservation step in this story - the conflict check runs synchronously inside the single confirm request."

package_dependencies: []

notes: |
  This story is being built on top of a codebase that, prior to this change, has zero booking
  domain code - src/ only contains src/auth, src/sessions, src/users, src/httpUtils.ts, src/app.ts,
  and src/server.ts (confirmed via Glob and reading every file under src/ and test/). There is no
  existing bookings/, slots/, or notifications/ directory to extend, so this plan introduces them
  fresh but keeps every new piece structurally identical to the existing auth vertical
  (model -> repository -> service -> controller -> app.ts wiring; class-based repositories/services
  with constructor DI; typed Error subclasses mapped to HTTP status in the controller; node:test +
  raw `fetch` integration tests over `startTestServer`).

  ```mermaid
  flowchart TD
    app[app.ts]:::touched
    controller[rescheduleController.ts]:::touched
    service[rescheduleService.ts]:::touched
    repo[bookingRepository.ts]:::touched
    model[bookingModel.ts]:::touched
    policy[cancellationPolicy.ts]:::touched
    notif[notificationService.ts]:::touched
    tokenSvc[tokenService.ts]:::context
    authCtrl[authController.ts]:::context
    fixtures[testUsers.ts]:::touched

    app -->|"routes POST /bookings/:id/reschedule"| controller
    controller -->|"verifyAccessToken - auth check AC5"| tokenSvc
    controller -->|"reuses ControllerResponse type"| authCtrl
    controller --> service
    service -->|"lookup/mutate/conflict-check AC1,2,8,9,10"| repo
    repo --> model
    repo -->|"recompute window on reschedule AC3"| policy
    service -->|"notify customer & provider AC6"| notif
    fixtures -.->|"customer2 fixture backs AC12 test"| controller

    classDef touched fill:#f96,color:#000
    classDef context fill:#ddd,color:#000
  ```
