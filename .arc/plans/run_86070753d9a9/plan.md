summary: |
  Implement booking confirmation: a customer with a held slot completes a confirmation step that
  creates a confirmed booking record, marks the underlying slot as booked, and makes that booking
  visible both to the customer (with provider name/date/time/status) and to the provider (with
  customer name/date/time/status). If the customer's hold has expired, confirmation is rejected,
  the slot is released back to availability, and the customer is told to pick a new slot. The
  codebase currently has no slot/hold/booking domain at all (only auth/session/user code exists),
  so this plan introduces the minimal Slot, Hold, and Booking models/repositories needed to make
  confirmation observable and testable, following the exact in-memory Map-repository pattern
  already used by `SessionRepository`/`UserRepository`.

scope:
  - description: |
      Add minimal domain models for the three entities this story needs: `Slot`, `Hold`, and
      `Booking`. These mirror the existing `Session`/`User` model style (plain interfaces, no
      class behavior).

      ```ts
      // src/bookings/slotModel.ts
      export type SlotStatus = "available" | "held" | "booked";
      export interface Slot {
        id: string;
        providerId: string;
        providerName: string;
        date: string; // e.g. "2026-09-20"
        time: string; // e.g. "10:00"
        status: SlotStatus;
      }

      // src/bookings/holdModel.ts
      export interface Hold {
        id: string;
        slotId: string;
        customerId: string;
        createdAt: number;
        expiresAt: number;
      }

      // src/bookings/bookingModel.ts
      export interface Booking {
        id: string;
        slotId: string;
        customerId: string;
        customerName: string;
        providerId: string;
        providerName: string;
        date: string;
        time: string;
        status: "confirmed";
      }
      ```
    files:
      - src/bookings/slotModel.ts
      - src/bookings/holdModel.ts
      - src/bookings/bookingModel.ts
    rationale: |
      There is no prior "slot selection / hold" story in this codebase, so these types don't
      exist yet. Confirmation can't be expressed or tested without a Slot to mark booked and a
      Hold to validate/expire.

  - description: |
      Add in-memory repositories for the three entities, matching `SessionRepository`'s
      constructor-less, `Map`-backed style.

      ```ts
      // src/bookings/slotRepository.ts
      export class SlotRepository {
        create(slot: Slot): Slot { ... }
        findById(id: string): Slot | undefined { ... }
        markBooked(id: string): void { ... }
        release(id: string): void { ... } // sets status back to "available"
      }

      // src/bookings/holdRepository.ts
      export class HoldRepository {
        create(slotId: string, customerId: string, ttlMs: number, now: number = Date.now()): Hold { ... }
        findById(id: string): Hold | undefined { ... }
        remove(id: string): void { ... }
        isValid(hold: Hold, now: number = Date.now()): boolean {
          return hold.expiresAt > now;
        }
      }

      // src/bookings/bookingRepository.ts
      export class BookingRepository {
        create(booking: Omit<Booking, "id" | "status">): Booking { ... } // assigns id via crypto.randomUUID(), status: "confirmed"
        findByCustomerId(customerId: string): Booking[] { ... }
        findByProviderId(providerId: string): Booking[] { ... }
      }
      ```
    files:
      - src/bookings/slotRepository.ts
      - src/bookings/holdRepository.ts
      - src/bookings/bookingRepository.ts
    rationale: |
      Mirrors `SessionRepository`'s `isValid(session, now)` pattern exactly (see
      `src/sessions/sessionRepository.ts:49`), so expiry logic reads consistently across the
      codebase. Tests seed slots/holds directly via these repositories' `create()` methods,
      the same way `refresh.test.ts` calls `sessionRepository.create(...)` directly to set up an
      expired session.

  - description: |
      Add `BookingService` with the confirmation business logic and the two read paths.

      ```ts
      // src/bookings/bookingService.ts
      export class HoldNotFoundError extends Error {
        constructor() { super("Hold not found"); }
      }
      export class HoldExpiredError extends Error {
        constructor() { super("Your hold has expired. Please select a new slot."); }
      }

      export class BookingService {
        constructor(
          private slotRepository: SlotRepository,
          private holdRepository: HoldRepository,
          private bookingRepository: BookingRepository,
          private userRepository: UserRepository,
        ) {}

        confirmHold(holdId: string, now: number = Date.now()): Booking {
          const hold = this.holdRepository.findById(holdId);
          const slot = hold ? this.slotRepository.findById(hold.slotId) : undefined;
          if (!hold || !slot) throw new HoldNotFoundError();

          if (!this.holdRepository.isValid(hold, now)) {
            this.slotRepository.release(slot.id);
            this.holdRepository.remove(hold.id);
            throw new HoldExpiredError();
          }

          const customer = this.userRepository.findById(hold.customerId);
          const booking = this.bookingRepository.create({
            slotId: slot.id,
            customerId: hold.customerId,
            customerName: customer?.username ?? hold.customerId,
            providerId: slot.providerId,
            providerName: slot.providerName,
            date: slot.date,
            time: slot.time,
          });

          this.slotRepository.markBooked(slot.id);
          this.holdRepository.remove(hold.id);
          return booking;
        }

        getBookingsForCustomer(customerId: string): Booking[] {
          return this.bookingRepository.findByCustomerId(customerId);
        }

        getScheduleForProvider(providerId: string): Booking[] {
          return this.bookingRepository.findByProviderId(providerId);
        }
      }
      ```
    files:
      - src/bookings/bookingService.ts
    rationale: |
      Keeps all booking business rules (expiry check, slot release, booking creation) in one
      service, matching how `AuthService` centralizes login/refresh/logout rules rather than
      spreading them across the controller.

  - description: |
      Add a small shared helper to extract a bearer token from an `Authorization` header, and
      reuse it from both the existing `authController.handleGetSession` and the new booking
      controller, instead of duplicating the `"Bearer "` prefix check.

      ```ts
      // src/httpUtils.ts (add)
      export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
        return authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
      }
      ```

      `authController.ts:79` currently inlines this check; replace that line with a call to
      `extractBearerToken(authorizationHeader)`.
    files:
      - src/httpUtils.ts
      - src/auth/authController.ts
    rationale: |
      `handleGetCustomerBookings` and `handleGetProviderSchedule` need the exact same
      Bearer-token parsing `handleGetSession` already does; extracting it avoids a second copy of
      the same one-liner rather than inventing a new auth layer.

  - description: |
      Add `bookingController.ts` with three handlers: confirming a hold, listing the
      authenticated customer's bookings, and listing the authenticated provider's schedule.

      ```ts
      // src/bookings/bookingController.ts
      export async function handleConfirmBooking(
        bookingService: BookingService,
        requestBody: unknown,
      ): Promise<ControllerResponse> {
        const { hold_id: holdId } = asRecord(requestBody);
        if (typeof holdId !== "string") {
          return { status: 400, body: { error: "hold_id is required" } };
        }
        try {
          const booking = bookingService.confirmHold(holdId);
          return { status: 201, body: { booking: toBookingResponse(booking) } };
        } catch (err) {
          if (err instanceof HoldExpiredError) {
            return { status: 409, body: { error: err.message } };
          }
          if (err instanceof HoldNotFoundError) {
            return { status: 404, body: { error: err.message } };
          }
          throw err;
        }
      }

      export function handleGetCustomerBookings(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
        now: number = Date.now(),
      ): ControllerResponse {
        const payload = verifyAccessToken(extractBearerToken(authorizationHeader) ?? "", now);
        if (!payload) return { status: 401, body: { error: "missing or invalid access token" } };
        const bookings = bookingService.getBookingsForCustomer(payload.userId);
        return { status: 200, body: { bookings: bookings.map(toBookingResponse) } };
      }

      export function handleGetProviderSchedule(
        bookingService: BookingService,
        authorizationHeader: string | undefined,
        now: number = Date.now(),
      ): ControllerResponse {
        const payload = verifyAccessToken(extractBearerToken(authorizationHeader) ?? "", now);
        if (!payload) return { status: 401, body: { error: "missing or invalid access token" } };
        const bookings = bookingService.getScheduleForProvider(payload.userId);
        return { status: 200, body: { bookings: bookings.map(toBookingResponse) } };
      }

      function toBookingResponse(booking: Booking) {
        return {
          id: booking.id,
          provider_name: booking.providerName,
          customer_name: booking.customerName,
          date: booking.date,
          time: booking.time,
          status: booking.status,
        };
      }
      ```
    files:
      - src/bookings/bookingController.ts
    rationale: |
      Matches the existing `authController.ts` shape exactly: thin handlers returning
      `{ status, body }`, request-shape validation via `asRecord`, domain errors mapped to HTTP
      status codes in a try/catch.

  - description: |
      Wire the new repositories, service, and routes into `createApp`/`handleRequest`.

      ```ts
      // src/app.ts (AppDependencies, add)
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        slotRepository?: SlotRepository;
        holdRepository?: HoldRepository;
        bookingRepository?: BookingRepository;
      }
      ```

      Routes added to `handleRequest`'s routing:
      - `POST /bookings/confirm` -> `handleConfirmBooking(bookingService, body)`
      - `GET /bookings/mine` -> `handleGetCustomerBookings(bookingService, req.headers.authorization)`
      - `GET /schedule/mine` -> `handleGetProviderSchedule(bookingService, req.headers.authorization)`
    files:
      - src/app.ts
    rationale: |
      Same dependency-injection pattern already used for `userRepository`/`sessionRepository`,
      so tests can seed `SlotRepository`/`HoldRepository`/`BookingRepository` via
      `startTestServer({...})` exactly like existing tests seed `SessionRepository`.

  - description: |
      Add the failing tests first, one file for the confirmation flow (AC1, AC2, AC5, AC6, AC7)
      and one for the two read views (AC3, AC4), following the existing `test/*.test.ts` style
      (Node's built-in `test`/`assert`, real HTTP calls via `fetch` against `startTestServer`).
    files:
      - test/bookingConfirmation.test.ts
      - test/bookingViews.test.ts
    rationale: |
      Matches how `login.test.ts`/`refresh.test.ts`/`logout.test.ts` are split by flow rather
      than by file-per-endpoint, and reuses `startTestServer`/dependency-injection instead of a
      new test harness.

tests:
  - |
    AC1 (confirmed booking record is created): in `test/bookingConfirmation.test.ts`, seed a
    `Slot` (status `"held"`) and a valid `Hold` directly via the repositories, `POST
    /bookings/confirm` with `{ hold_id }`, then assert:
    ```ts
    assert.equal(res.status, 201);
    const body = (await res.json()) as { booking: { status: string } };
    assert.equal(body.booking.status, "confirmed");
    assert.equal(bookingRepository.findByCustomerId("user-customer-1").length, 1);
    ```
  - |
    AC2 (slot is marked booked): in the same test as AC1, after confirming, assert:
    ```ts
    assert.equal(slotRepository.findById(slot.id)!.status, "booked");
    ```
  - |
    AC3 (customer sees the confirmed booking with provider name, date, time, status): in
    `test/bookingViews.test.ts`, confirm a hold, log in as `customer1` to get an access token,
    `GET /bookings/mine` with `Authorization: Bearer <token>`, then assert:
    ```ts
    assert.equal(res.status, 200);
    const [booking] = body.bookings;
    assert.equal(booking.provider_name, "provider1");
    assert.equal(booking.date, "2026-09-21");
    assert.equal(booking.time, "09:00");
    assert.equal(booking.status, "confirmed");
    ```
  - |
    AC4 (provider sees the confirmed booking with customer name, date, time, status): same setup
    as AC3, log in as `provider1`, `GET /schedule/mine`, then assert:
    ```ts
    assert.equal(res.status, 200);
    const [booking] = body.bookings;
    assert.equal(booking.customer_name, "customer1");
    assert.equal(booking.date, "2026-09-21");
    assert.equal(booking.time, "09:00");
    assert.equal(booking.status, "confirmed");
    ```
  - |
    AC5 (expired hold's confirmation is rejected): in `test/bookingConfirmation.test.ts`, seed a
    `Hold` whose `expiresAt` is already in the past (e.g. created 11 minutes ago with a 10-minute
    TTL), `POST /bookings/confirm`, then assert:
    ```ts
    assert.equal(res.status, 409);
    assert.equal(bookingRepository.findByCustomerId("user-customer-1").length, 0);
    ```
  - |
    AC6 (slot is released when the hold has expired): in the same test as AC5, after the
    rejected confirmation, assert:
    ```ts
    assert.equal(slotRepository.findById(slot.id)!.status, "available");
    ```
  - |
    AC7 (customer is told to pick a new slot): in the same test as AC5/AC6, assert the error
    message content:
    ```ts
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /select a new slot/i);
    ```

assumptions_or_open_questions:
  - |
    No Slot/Hold domain exists yet anywhere in this codebase (only auth/session/user code is
    present) — there is no prior "slot selection / hold" story implemented. This plan introduces
    the minimal `Slot`/`Hold` models and repositories needed to make confirmation observable, and
    tests seed slots/holds directly via `SlotRepository`/`HoldRepository` (the same way
    `refresh.test.ts` calls `sessionRepository.create(...)` directly), not through a public API,
    since creating a hold is out of scope for this story.
  - |
    "Provider name" / "customer name" are taken from `User.username` (the existing
    `testUsers.ts` fixture has no separate display-name field). Assumed username doubles as the
    display name shown to the other party; revisit if a real `name` field is added later.
  - |
    `POST /bookings/confirm` does NOT require a bearer token — the confirming customer's identity
    comes from `hold.customerId` on the hold record itself, since none of AC1/2/5/6/7 mention
    authentication for this step. `GET /bookings/mine` and `GET /schedule/mine` DO require a
    valid bearer token (reusing `verifyAccessToken`) because "their bookings" / "their schedule"
    implies scoping strictly to the authenticated caller.
  - |
    Confirming a hold ID that doesn't exist returns `404` — defensive handling required for the
    code to behave sensibly, though no AC explicitly covers this case, so no test is written for
    it in this plan.
  - |
    HTTP status codes are a judgment call not specified by the ACs: `201` for a newly created
    booking, `409 Conflict` for an expired-hold rejection. Open question for the reviewer: does
    product/API convention prefer `410 Gone` for the expired-hold case instead?
  - |
    Slot/Hold/Booking data is in-memory only (`Map`-backed repositories), matching the existing
    `SessionRepository`/`UserRepository` pattern — there is no persistence layer anywhere in this
    codebase yet.
  - |
    `date`/`time` are opaque strings on `Slot`/`Booking` (e.g. `"2026-09-20"` / `"10:00"`) with no
    timezone handling, since no AC specifies a format.

package_dependencies: []

notes: |
  This story is the first booking-domain code in the repo — everything under `src/bookings/` is
  new. Kept entirely dependency-free (in-memory `Map` repositories, Node's built-in `node:test` /
  `node:assert`), matching the zero-dependency style already established by `package.json` and
  the auth/session code.

  ```mermaid
  flowchart TD
    appTs["app.ts"]
    bookingControllerTs["bookingController.ts"]
    bookingServiceTs["bookingService.ts"]
    slotRepositoryTs["slotRepository.ts"]
    holdRepositoryTs["holdRepository.ts"]
    bookingRepositoryTs["bookingRepository.ts"]
    httpUtilsTs["httpUtils.ts"]
    authControllerTs["authController.ts"]
    userRepositoryTs["userRepository.ts (existing)"]
    tokenServiceTs["tokenService.ts (existing)"]

    appTs -->|"routes POST /bookings/confirm, GET /bookings/mine, GET /schedule/mine"| bookingControllerTs
    bookingControllerTs -->|"confirmHold / getBookingsForCustomer / getScheduleForProvider"| bookingServiceTs
    bookingServiceTs -->|"find slot, markBooked, release"| slotRepositoryTs
    bookingServiceTs -->|"find/remove hold, isValid"| holdRepositoryTs
    bookingServiceTs -->|"create booking, find by customer/provider"| bookingRepositoryTs
    bookingServiceTs -->|"look up customer display name"| userRepositoryTs
    bookingControllerTs -->|"extractBearerToken"| httpUtilsTs
    bookingControllerTs -->|"verifyAccessToken"| tokenServiceTs
    authControllerTs -->|"reuses extractBearerToken (dedupe)"| httpUtilsTs

    classDef touched fill:#f96,color:#000
    class appTs,bookingControllerTs,bookingServiceTs,slotRepositoryTs,holdRepositoryTs,bookingRepositoryTs,httpUtilsTs,authControllerTs touched
  ```
