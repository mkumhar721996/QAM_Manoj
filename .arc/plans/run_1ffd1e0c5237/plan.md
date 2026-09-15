summary: |
  This codebase currently has no booking/scheduling domain at all — it is a login/session
  service with a pizza cart bolted on (src/auth, src/sessions, src/users, src/pizzas, src/cart).
  There is no Booking model, repository, service, controller, or route. This plan adds the
  minimal booking domain needed to satisfy STORY-038: an append-only in-memory booking store
  seeded with fixture bookings (mirroring the existing pizzas/testUsers fixture pattern), a
  service that always scopes reads by the requester's own id, and three read routes plus one
  delete route wired into the existing manual router in src/app.ts, following the same
  Repository -> Service -> Controller layering and bearer-token auth pattern already used by
  auth and cart. The goal is strictly retention (no code path can ever remove a booking record)
  and correctly scoped read access for the owning customer and provider — no booking creation,
  cancellation, or completion workflow is added, since the parent epic assigns that to other
  stories.
scope:
  - description: |
      Add the Booking domain type and seed fixture data. Extend the existing test user fixtures
      with a second customer/provider pair so AC5 (cross-tenant visibility) has a genuine
      "someone else's booking" to assert against.
    files:
      - src/bookings/bookingModel.ts
      - src/bookings/fixtures/testBookings.ts
      - src/users/fixtures/testUsers.ts
    rationale: |
      No booking concept exists anywhere in the repo today. Fixtures follow the same pattern as
      src/pizzas/fixtures/pizzaCatalog.ts and src/users/fixtures/testUsers.ts (a plain seed array
      the repository maps by id). Two independent customer/provider pairs are needed because
      every existing seed user (customer1/provider1/admin1) belongs to the same tenant pairing,
      so there is currently no fixture data that lets a test prove one customer cannot see
      another's booking.
  - description: |
      Add BookingRepository as an append-only in-memory store: lookups by id/customerId/
      providerId, and no method that can ever remove an entry from the map.

      ```ts
      export class BookingDeletionNotAllowedError extends Error {}

      export class BookingRepository {
        private bookingsById: Map<string, Booking>;
        constructor(bookings: Booking[] = testBookings) {
          this.bookingsById = new Map(bookings.map((b) => [b.id, b]));
        }
        findById(bookingId: string): Booking | undefined { ... }
        listByCustomerId(customerId: string): Booking[] { ... }
        listByProviderId(providerId: string): Booking[] { ... }
        delete(_bookingId: string): never {
          throw new BookingDeletionNotAllowedError(
            "Cancelled or completed bookings cannot be deleted or purged",
          );
        }
      }
      ```
    files:
      - src/bookings/bookingRepository.ts
    rationale: |
      AC4 is enforced structurally rather than by a runtime permission check: the only "delete"
      method that exists on the store unconditionally throws, so no caller — present or future —
      has a code path that removes a record from bookingsById.
  - description: |
      Add BookingService, which joins a booking with its counterparty's user details (via the
      existing UserRepository) and always scopes queries by the requester's own id.

      ```ts
      export interface BookingHistoryEntry {
        id: string;
        status: BookingStatus;
        appointmentTime: number;
        counterparty: { id: string; username: string };
      }

      export class BookingService {
        constructor(
          private bookingRepository: BookingRepository,
          private userRepository: UserRepository,
        ) {}
        getCustomerHistory(customerId: string): BookingHistoryEntry[] { ... }
        getProviderHistory(providerId: string): BookingHistoryEntry[] { ... }
        getBookingForRequester(requesterId: string, bookingId: string): BookingHistoryEntry | undefined { ... }
        deleteBooking(bookingId: string): never {
          return this.bookingRepository.delete(bookingId);
        }
      }
      ```
    files:
      - src/bookings/bookingService.ts
    rationale: |
      Scoping every read by requesterId (rather than filtering a broader result afterward) is
      what makes AC5 hold by construction: getBookingForRequester returns undefined for a
      booking that isn't the requester's regardless of role, so the controller can map "not
      mine" and "doesn't exist" to the same response.
  - description: |
      Add BookingController and wire four routes into the existing manual router in src/app.ts,
      following the same bearer-token + ControllerResponse pattern as authController/
      cartController.

      Routes:
      - `GET /bookings/customer/history` (requires role `customer`)
      - `GET /bookings/provider/history` (requires role `provider`)
      - `GET /bookings/:id` (either role; 404 if the booking isn't the requester's)
      - `DELETE /bookings/:id` (always rejected, 405, regardless of caller)
    files:
      - src/bookings/bookingController.ts
      - src/app.ts
    rationale: |
      Matches the existing routing style in src/app.ts (string-matched `${method} ${pathname}`
      plus one regex match for the `:id` segment, mirroring the existing `/pizzas/:id` handling)
      and the existing controller contract (`{ status, body }` via handleGetPizza/handleGetCart).
  - description: |
      Add the failing-tests-first integration suite exercising all five ACs end-to-end through
      the HTTP server, matching the style of test/cartCustomisation.test.ts.
    files:
      - test/bookingHistory.test.ts
    rationale: |
      Every existing test file in this repo drives the app through startTestServer() + fetch()
      rather than unit-testing controllers directly, so this plan follows that convention for
      consistency and to genuinely exercise the routing added in src/app.ts.
tests:
  - |
    AC1 — customer sees final status, appointment time, and provider details:
    ```ts
    test("AC1: customer sees final status, appointment time, and provider details", async () => {
      const server = await startTestServer();
      try {
        const { access_token } = await login(server.baseUrl, "customer1");
        const res = await fetch(`${server.baseUrl}/bookings/customer/history`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { bookings: Array<Record<string, unknown>> };
        const completed = body.bookings.find((b) => b.id === "booking-1");
        assert.equal(completed?.status, "completed");
        assert.equal(completed?.appointment_time, BOOKING_1_APPOINTMENT_TIME);
        assert.deepEqual(completed?.provider, { id: "user-provider-1", username: "provider1" });
      } finally {
        await server.close();
      }
    });
    ```
    This test must fail first because /bookings/customer/history does not exist yet (404 from
    the current catch-all in src/app.ts).
  - |
    AC2 — provider sees final status, appointment time, and customer details:
    ```ts
    test("AC2: provider sees final status, appointment time, and customer details", async () => {
      const server = await startTestServer();
      try {
        const { access_token } = await login(server.baseUrl, "provider1");
        const res = await fetch(`${server.baseUrl}/bookings/provider/history`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { bookings: Array<Record<string, unknown>> };
        const completed = body.bookings.find((b) => b.id === "booking-1");
        assert.equal(completed?.status, "completed");
        assert.deepEqual(completed?.customer, { id: "user-customer-1", username: "customer1" });
      } finally {
        await server.close();
      }
    });
    ```
    Fails first for the same reason as AC1 (route does not exist).
  - |
    AC3 — a booking from years ago is still present:
    ```ts
    test("AC3: bookings remain in history regardless of how long ago they occurred", async () => {
      const server = await startTestServer();
      try {
        const { access_token } = await login(server.baseUrl, "customer1");
        const res = await fetch(`${server.baseUrl}/bookings/customer/history`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const body = (await res.json()) as { bookings: Array<{ id: string }> };
        assert.ok(
          body.bookings.some((b) => b.id === "booking-old"),
          "expected a multi-year-old booking to still appear in history",
        );
      } finally {
        await server.close();
      }
    });
    ```
    Requires a fixture booking (`booking-old`) with `appointmentTime` several years in the past,
    e.g. `Date.now() - 5 * 365 * 24 * 60 * 60 * 1000`.
  - |
    AC4 — deletion/purge of a cancelled or completed booking is rejected, and the record still
    exists afterward:
    ```ts
    test("AC4: deleting or purging a booking is rejected and the record is retained", async () => {
      const server = await startTestServer();
      try {
        const { access_token } = await login(server.baseUrl, "customer1");
        const delRes = await fetch(`${server.baseUrl}/bookings/booking-1`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(delRes.status, 405);

        const getRes = await fetch(`${server.baseUrl}/bookings/booking-1`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(getRes.status, 200);
      } finally {
        await server.close();
      }
    });
    ```
    Also add a repository-level unit assertion as the very first failing test, since it pins the
    structural guarantee directly:
    ```ts
    assert.throws(
      () => new BookingRepository().delete("booking-1"),
      BookingDeletionNotAllowedError,
    );
    ```
  - |
    AC5 — a booking belonging to a different customer/provider is not visible:
    ```ts
    test("AC5: a booking belonging to a different customer/provider is not visible", async () => {
      const server = await startTestServer();
      try {
        const { access_token } = await login(server.baseUrl, "customer1");
        // booking-3 belongs to customer2/provider2 in the fixture data
        const directRes = await fetch(`${server.baseUrl}/bookings/booking-3`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        assert.equal(directRes.status, 404);

        const historyRes = await fetch(`${server.baseUrl}/bookings/customer/history`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const historyBody = (await historyRes.json()) as { bookings: Array<{ id: string }> };
        assert.ok(!historyBody.bookings.some((b) => b.id === "booking-3"));
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - |
    No booking creation, cancellation, or completion workflow exists in this codebase, and the
    parent epic explicitly assigns slot selection/confirmation/rescheduling/cancellation to the
    rest of the "Booking & Scheduling" epic. This plan therefore only adds retention + scoped
    read access on top of seeded fixture bookings that are already in a terminal state
    (cancelled/completed); it does not add any endpoint to create or transition a booking.
  - |
    Chosen HTTP status codes (not specified by the ACs): 405 for the delete/purge rejection
    (the operation is structurally unsupported, not caller-specific), and 404 — not 403 — when a
    customer/provider requests a booking that isn't theirs, so the response doesn't confirm
    that a booking with that id exists at all.
  - |
    /bookings/customer/history requires the token's role to be exactly "customer" and
    /bookings/provider/history requires exactly "provider" (403 otherwise); there is no
    admin-override view, since none of the ACs mention one.
  - |
    Added two additional seed users (customer2/provider2) to src/users/fixtures/testUsers.ts
    purely so AC5 has a second, independent customer/provider pair to test against via real
    login — this file is test-only fixture data, so the addition is additive and doesn't change
    any existing behavior or test.
  - |
    "Appointment time" is modeled as a single epoch-ms instant (no separate start/end), since
    the ACs only ever refer to "appointment time" in the singular.
package_dependencies: []
notes: |
  Every route in this plan is added to the single manual router in src/app.ts (there is no
  framework/router library in this project — see the string-matched `${method} ${pathname}`
  dispatch and the one regex-matched path already there for `/pizzas/:id`). The new
  `/bookings/:id` routes follow that same regex-match precedent.

  ```mermaid
  flowchart TD
    appTs["app.ts (router)"]
    bookingController["bookingController.ts"]
    bookingService["bookingService.ts"]
    bookingRepository["bookingRepository.ts"]
    userRepository["userRepository.ts"]
    tokenService["tokenService.ts"]
    testBookingsFixture["fixtures/testBookings.ts"]
    testUsersFixture["fixtures/testUsers.ts"]

    appTs -->|"routes GET/DELETE /bookings/*"| bookingController
    bookingController -->|"verifyAccessToken (existing)"| tokenService
    bookingController -->|"getCustomerHistory / getProviderHistory / getBookingForRequester / deleteBooking"| bookingService
    bookingService -->|"listByCustomerId / listByProviderId / findById / delete (always throws)"| bookingRepository
    bookingService -->|"findById, for counterparty username"| userRepository
    bookingRepository -->|"seeds"| testBookingsFixture
    userRepository -->|"seeds, +customer2/provider2"| testUsersFixture

    classDef touched fill:#f96,color:#000
    class appTs,bookingController,bookingService,bookingRepository,testBookingsFixture,testUsersFixture touched
  ```

  userRepository.ts and tokenService.ts are read but not modified — both already expose exactly
  what's needed (`findById`, `verifyAccessToken`) for the new controller/service to reuse.
