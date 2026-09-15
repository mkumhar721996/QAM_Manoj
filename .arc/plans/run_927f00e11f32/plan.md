summary: |
  This codebase currently has no booking/scheduling domain at all — it is a login/session
  service with a pizza-ordering cart bolted on (src/auth, src/sessions, src/users, src/pizzas,
  src/cart, wired together by a single manual router in src/app.ts). There is no Booking
  model, repository, service, controller, or route. This plan adds the minimal booking domain
  needed to satisfy STORY-038: an append-only in-memory booking store seeded with fixture
  bookings (mirroring the existing pizzas/testUsers fixture pattern), a service that always
  scopes reads by the requester's own id, and plain `handle*` route-handler functions wired
  into the existing router in src/app.ts, following the exact Repository -> Service ->
  handler layering and bearer-token auth pattern already used by auth and cart
  (src/cart/cartController.ts, src/auth/authController.ts). The goal is strictly retention
  (no code path can ever remove a booking record) and correctly scoped read access for the
  owning customer and provider — no booking creation, cancellation, or completion workflow is
  added, since the parent epic assigns that to other stories in "Booking & Scheduling".

scope:
  - description: |
      Add the Booking domain type and seed fixture data, and extend the existing test-user
      fixtures with a second customer/provider pair so AC5 (cross-tenant visibility) has a
      genuine "someone else's booking" to assert against.

      `src/bookings/bookingModel.ts`:
      ```ts
      export type BookingStatus = "completed" | "cancelled";

      export interface Booking {
        id: string;
        customerId: string;
        providerId: string;
        status: BookingStatus;
        appointmentTime: number; // epoch ms
      }
      ```

      `src/bookings/fixtures/testBookings.ts`:
      ```ts
      import type { Booking } from "../bookingModel.ts";

      export const testBookings: Booking[] = [
        {
          id: "booking-1",
          customerId: "user-customer-1",
          providerId: "user-provider-1",
          status: "completed",
          appointmentTime: Date.parse("2024-03-10T14:00:00Z"),
        },
        {
          id: "booking-2",
          customerId: "user-customer-1",
          providerId: "user-provider-1",
          status: "cancelled",
          appointmentTime: Date.parse("2024-04-01T09:30:00Z"),
        },
        {
          id: "booking-old",
          customerId: "user-customer-1",
          providerId: "user-provider-1",
          status: "completed",
          appointmentTime: Date.now() - 5 * 365 * 24 * 60 * 60 * 1000,
        },
        {
          id: "booking-3",
          customerId: "user-customer-2",
          providerId: "user-provider-2",
          status: "completed",
          appointmentTime: Date.parse("2024-05-20T11:00:00Z"),
        },
      ];
      ```

      `src/users/fixtures/testUsers.ts` gains two more seeds appended to the existing
      `testUserSeeds` array:
      ```ts
      { id: "user-customer-2", username: "customer2", role: "customer" },
      { id: "user-provider-2", username: "provider2", role: "provider" },
      ```
    files:
      - src/bookings/bookingModel.ts
      - src/bookings/fixtures/testBookings.ts
      - src/users/fixtures/testUsers.ts
    rationale: |
      No booking concept exists anywhere in the repo today (confirmed: `src/**/*.ts` has no
      `booking*` file). Fixtures follow the same pattern as
      `src/pizzas/fixtures/pizzaCatalog.ts` (`export const testPizzas: Pizza[] = [...]`) and
      `src/users/fixtures/testUsers.ts` (a plain seed array the repository maps by id). Two
      independent customer/provider pairs are needed because every existing seed user
      (customer1/provider1/admin1) belongs to the same tenant pairing, so there is currently
      no fixture data that lets a test prove one customer cannot see another's booking.

  - description: |
      Add `BookingRepository` as an append-only in-memory store: lookups by id/customerId/
      providerId, and no method that can ever remove an entry from the map.

      ```ts
      import type { Booking } from "./bookingModel.ts";
      import { testBookings } from "./fixtures/testBookings.ts";

      export class BookingDeletionNotAllowedError extends Error {}

      export class BookingRepository {
        private bookingsById: Map<string, Booking>;

        constructor(bookings: Booking[] = testBookings) {
          this.bookingsById = new Map(bookings.map((b) => [b.id, b]));
        }

        findById(bookingId: string): Booking | undefined {
          return this.bookingsById.get(bookingId);
        }

        listByCustomerId(customerId: string): Booking[] {
          return [...this.bookingsById.values()].filter((b) => b.customerId === customerId);
        }

        listByProviderId(providerId: string): Booking[] {
          return [...this.bookingsById.values()].filter((b) => b.providerId === providerId);
        }

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
      AC4 is enforced structurally rather than by a runtime permission check: the only
      "delete" method that exists on the store unconditionally throws, so no caller —
      present or future — has a code path that removes a record from `bookingsById`. This
      mirrors the error-class style already used in the codebase (`PizzaNotFoundError`,
      `InvalidCustomisationError` in `src/cart/cartService.ts` — plain `class Foo extends
      Error {}`, no custom constructor).

  - description: |
      Add `BookingService`, which joins a booking with its counterparty's user details (via
      the existing `UserRepository`) and always scopes queries by the requester's own id.

      ```ts
      import type { UserRepository } from "../users/userRepository.ts";
      import type { BookingRepository } from "./bookingRepository.ts";
      import type { Booking, BookingStatus } from "./bookingModel.ts";

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

        getCustomerHistory(customerId: string): BookingHistoryEntry[] {
          return this.bookingRepository
            .listByCustomerId(customerId)
            .map((b) => this.toEntry(b, b.providerId));
        }

        getProviderHistory(providerId: string): BookingHistoryEntry[] {
          return this.bookingRepository
            .listByProviderId(providerId)
            .map((b) => this.toEntry(b, b.customerId));
        }

        getBookingForRequester(requesterId: string, bookingId: string): BookingHistoryEntry | undefined {
          const booking = this.bookingRepository.findById(bookingId);
          if (!booking) return undefined;
          if (booking.customerId !== requesterId && booking.providerId !== requesterId) return undefined;
          const counterpartyId = booking.customerId === requesterId ? booking.providerId : booking.customerId;
          return this.toEntry(booking, counterpartyId);
        }

        deleteBooking(bookingId: string): never {
          return this.bookingRepository.delete(bookingId);
        }

        private toEntry(booking: Booking, counterpartyId: string): BookingHistoryEntry {
          const counterparty = this.userRepository.findById(counterpartyId);
          return {
            id: booking.id,
            status: booking.status,
            appointmentTime: booking.appointmentTime,
            counterparty: { id: counterpartyId, username: counterparty?.username ?? "" },
          };
        }
      }
      ```
    files:
      - src/bookings/bookingService.ts
    rationale: |
      Scoping every read by requesterId (rather than filtering a broader result afterward)
      is what makes AC5 hold by construction: `getBookingForRequester` returns `undefined`
      for a booking that isn't the requester's regardless of role, so the controller maps
      "not mine" and "doesn't exist" to the identical 404 response, never leaking existence.
      Confirmed `UserRepository.findById(userId: string): User | undefined` already exposes
      exactly what's needed (`src/users/userRepository.ts:17`).

  - description: |
      Add booking route handlers as plain exported functions and wire four routes into the
      existing manual router in `src/app.ts`. This deliberately mirrors
      `src/cart/cartController.ts`, which exports plain functions (`handleGetPizza`,
      `handleAddToCart`, `handleGetCart`) rather than a class — the existing codebase has no
      controller *classes* anywhere, so `src/bookings/bookingController.ts` follows suit
      instead of introducing a new pattern.

      ```ts
      import type { ControllerResponse } from "../auth/authController.ts";
      import { verifyAccessToken } from "../auth/tokenService.ts";
      import { BookingDeletionNotAllowedError } from "./bookingRepository.ts";
      import type { BookingService, BookingHistoryEntry } from "./bookingService.ts";

      function extractBearerPayload(authorizationHeader: string | undefined) {
        const token = authorizationHeader?.startsWith("Bearer ")
          ? authorizationHeader.slice("Bearer ".length)
          : undefined;
        return token ? verifyAccessToken(token) : null;
      }

      function toJson(entry: BookingHistoryEntry, counterpartyKey: "provider" | "customer") {
        return {
          id: entry.id,
          status: entry.status,
          appointment_time: entry.appointmentTime,
          [counterpartyKey]: entry.counterparty,
        };
      }

      export function handleGetCustomerBookingHistory(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        if (payload.role !== "customer") return { status: 403, body: { error: "customer role required" } };
        const bookings = bookingService.getCustomerHistory(payload.userId).map((e) => toJson(e, "provider"));
        return { status: 200, body: { bookings } };
      }

      export function handleGetProviderBookingHistory(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        if (payload.role !== "provider") return { status: 403, body: { error: "provider role required" } };
        const bookings = bookingService.getProviderHistory(payload.userId).map((e) => toJson(e, "customer"));
        return { status: 200, body: { bookings } };
      }

      export function handleGetBooking(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
        bookingId: string,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        const entry = bookingService.getBookingForRequester(payload.userId, bookingId);
        if (!entry) return { status: 404, body: { error: "booking not found" } };
        const counterpartyKey = payload.role === "provider" ? "customer" : "provider";
        return { status: 200, body: toJson(entry, counterpartyKey) };
      }

      export function handleDeleteBooking(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
        bookingId: string,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        try {
          bookingService.deleteBooking(bookingId);
        } catch (err) {
          if (err instanceof BookingDeletionNotAllowedError) {
            return { status: 405, body: { error: err.message } };
          }
          throw err;
        }
        return { status: 200 };
      }
      ```

      Routes added to `src/app.ts` (same string-matched `${method} ${pathname}` dispatch plus
      one regex match, mirroring the existing `/pizzas/:id` handling at `src/app.ts:56-61`):
      - `GET /bookings/customer/history`
      - `GET /bookings/provider/history`
      - `GET /bookings/:id` matched via `url.pathname.match(/^\/bookings\/([^/]+)$/)`
      - `DELETE /bookings/:id` matched via the same regex, gated on `method === "DELETE"`

      `createApp` gains `bookingRepository`/`bookingService` construction alongside the
      existing `cartRepository`/`cartService` lines, and an optional `bookingRepository` on
      `AppDependencies` for test injection, matching the existing `pizzaRepository`/
      `cartRepository` optional-override pattern.
    files:
      - src/bookings/bookingController.ts
      - src/app.ts
    rationale: |
      Confirmed in `src/app.ts` (read in full): all routing is one hand-written
      `handleRequest` function with string route matching plus a single regex match for
      `/pizzas/:id`; there is no router library to register handlers with, so the new
      `/bookings/*` routes are added as additional `if` branches in the same function, in the
      same style. Confirmed `ControllerResponse { status: number; body?: Record<string,
      unknown> }` is already exported from `src/auth/authController.ts:6-9` and reused as-is
      by `cartController.ts`, so no new response-shape type is introduced.

  - description: |
      Add the failing-tests-first integration suite exercising all five ACs end-to-end
      through the HTTP server, matching the style of `test/cartCustomisation.test.ts`
      (drives the app via `startTestServer()` + `fetch()`, not direct controller calls).
    files:
      - test/bookingHistory.test.ts
    rationale: |
      Every existing test file (`test/login.test.ts`, `test/refresh.test.ts`,
      `test/logout.test.ts`, `test/cartCustomisation.test.ts`) drives the app through
      `startTestServer()` + `fetch()` rather than unit-testing controllers directly, so this
      plan follows that convention for consistency and to genuinely exercise the routing
      added in `src/app.ts`.

tests:
  - |
    Repository-level unit assertion, written first because it pins the structural AC4
    guarantee directly and needs no server:
    ```ts
    import { BookingRepository, BookingDeletionNotAllowedError } from "../src/bookings/bookingRepository.ts";

    test("BookingRepository.delete always throws and never removes a record", () => {
      const repo = new BookingRepository();
      assert.throws(() => repo.delete("booking-1"), BookingDeletionNotAllowedError);
      assert.ok(repo.findById("booking-1"), "booking-1 must still exist after the rejected delete");
    });
    ```
    Fails first because `src/bookings/bookingRepository.ts` does not exist yet.

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
        assert.equal(completed?.appointment_time, Date.parse("2024-03-10T14:00:00Z"));
        assert.deepEqual(completed?.provider, { id: "user-provider-1", username: "provider1" });
      } finally {
        await server.close();
      }
    });
    ```
    Fails first: `GET /bookings/customer/history` returns 404 from the current catch-all in
    `src/app.ts`.

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
    Relies on the `booking-old` fixture (`appointmentTime: Date.now() - 5 * 365 * 24 * 60 *
    60 * 1000`) added in scope item 1.

  - |
    AC4 — deletion/purge of a cancelled or completed booking is rejected, and the record
    still exists afterward:
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
    Fails first because `DELETE /bookings/:id` does not exist yet (falls into the 404
    catch-all).

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
    Requires the `customer2`/`provider2` fixture users and the `booking-3` fixture booking
    added in scope item 1. The local `login(baseUrl, username)` helper in
    `test/bookingHistory.test.ts` takes a username parameter (the existing helper in
    `test/cartCustomisation.test.ts` hardcodes `"customer1"`, so this file defines its own
    rather than modifying that one).

assumptions_or_open_questions:
  - |
    No booking creation, cancellation, or completion workflow exists in this codebase, and
    the parent epic explicitly assigns slot selection/confirmation/rescheduling/cancellation
    to the rest of the "Booking & Scheduling" epic. This plan therefore only adds retention +
    scoped read access on top of seeded fixture bookings that are already in a terminal state
    (cancelled/completed); it does not add any endpoint to create or transition a booking.
  - |
    Chosen HTTP status codes (not specified by the ACs): 405 for the delete/purge rejection
    (the operation is structurally unsupported, not caller-specific), and 404 — not 403 —
    when a customer/provider requests a booking that isn't theirs, so the response doesn't
    confirm that a booking with that id exists at all.
  - |
    `/bookings/customer/history` requires the token's role to be exactly `"customer"` and
    `/bookings/provider/history` requires exactly `"provider"` (403 otherwise); there is no
    admin-override view, since none of the ACs mention one.
  - |
    Two additional seed users (`customer2`/`provider2`) are added to
    `src/users/fixtures/testUsers.ts` purely so AC5 has a second, independent customer/
    provider pair to log in as and test against — this file is test-only fixture data, so the
    addition is additive and doesn't change any existing test's behavior.
  - |
    "Appointment time" is modeled as a single epoch-ms instant (no separate start/end), since
    the ACs only ever refer to "appointment time" in the singular.
  - |
    `GET /bookings/:id` (the single-booking lookup used by AC4/AC5) returns a generic
    `counterparty`-shaped key (`provider` or `customer`, chosen from the requester's role) —
    the ACs don't specify a response shape for this endpoint beyond "not visible", so the
    exact key name here is a judgment call, not a hard requirement.

package_dependencies: []

notes: |
  Every route in this plan is added to the single manual router in `src/app.ts` (confirmed by
  reading the file in full — there is no framework/router library in this project; routing is
  string-matched `${method} ${pathname}` plus one regex match already used for `/pizzas/:id`
  at `src/app.ts:56-61`). The new `/bookings/:id` routes follow that same regex-match
  precedent and do not collide with `/bookings/customer/history` or
  `/bookings/provider/history`, since those paths have an extra segment that the single-
  segment regex `^\/bookings\/([^/]+)$` does not match.

  ```mermaid
  flowchart TD
    appTs["app.ts (router)"]
    bookingController["bookingController.ts\n(new: handle* functions)"]
    bookingService["bookingService.ts\n(new)"]
    bookingRepository["bookingRepository.ts\n(new, append-only)"]
    userRepository["userRepository.ts\n(existing, read-only reuse)"]
    tokenService["tokenService.ts\n(existing, read-only reuse)"]
    testBookingsFixture["fixtures/testBookings.ts\n(new)"]
    testUsersFixture["fixtures/testUsers.ts\n(+customer2/provider2)"]

    appTs -->|"routes GET/DELETE /bookings/*"| bookingController
    bookingController -->|"verifyAccessToken"| tokenService
    bookingController -->|"getCustomerHistory / getProviderHistory / getBookingForRequester / deleteBooking"| bookingService
    bookingService -->|"listByCustomerId / listByProviderId / findById / delete (always throws)"| bookingRepository
    bookingService -->|"findById, for counterparty username"| userRepository
    bookingRepository -->|"seeds"| testBookingsFixture
    userRepository -->|"seeds"| testUsersFixture

    classDef touched fill:#f96,color:#000
    class appTs,bookingController,bookingService,bookingRepository,testBookingsFixture,testUsersFixture touched
  ```

  `userRepository.ts` and `tokenService.ts` are read but not modified — both already expose
  exactly what's needed (`findById`, `verifyAccessToken`) for the new service/controller to
  reuse. Verified against the current code (not just the earlier draft): `src/app.ts`,
  `src/users/userRepository.ts`, `src/users/fixtures/testUsers.ts`,
  `src/auth/tokenService.ts`, `src/auth/authController.ts`, `src/cart/cartController.ts`,
  `src/cart/cartService.ts`, `src/pizzas/fixtures/pizzaCatalog.ts`, and
  `test/cartCustomisation.test.ts` were all re-read for this pass; all file paths and
  exported symbols referenced above still exist and match the described shapes. One
  correction from the earlier draft: controllers in this codebase are plain exported
  functions (`handleGetPizza`, `handleAddToCart`, `handleGetCart`), not a class — so
  `bookingController.ts` is specified here as `handleGetCustomerBookingHistory` /
  `handleGetProviderBookingHistory` / `handleGetBooking` / `handleDeleteBooking` functions
  rather than a `BookingController` class, to match the codebase's actual convention.
