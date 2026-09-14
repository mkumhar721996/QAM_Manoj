summary: |
  This adds slot availability and time-limited holds for approved providers'
  schedules, on top of the existing login/session service. Nothing in the
  codebase today models providers, slots, or bookings, so this plan introduces
  a minimal in-memory Provider + Slot domain (mirroring the existing
  UserRepository/SessionRepository Map-based style), a SlotService that
  filters availability and places/expires holds, a configurable hold-duration
  setting (default 10 minutes), and two new HTTP endpoints wired into the
  existing `createApp`/`handleRequest` dispatcher: `GET
  /providers/:providerId/slots` to browse availability and `POST
  /providers/:providerId/slots/:slotId/hold` to begin checkout. Hold
  expiry is evaluated lazily against an injected `now`, the same pattern
  `SessionRepository.isValid` already uses, so no background timers are
  introduced. Each acceptance criterion gets its own failing test first.

scope:
  - description: |
      Introduce a minimal Provider domain so slot visibility can be gated on
      approval status (AC8). New files:
      - `src/providers/providerModel.ts`:
        ```ts
        export interface Provider {
          id: string;
          name: string;
          approved: boolean;
        }
        ```
      - `src/providers/fixtures/testProviders.ts` — seed data including one
        approved and one pending provider, mirroring
        `src/users/fixtures/testUsers.ts`:
        ```ts
        export const testProviders: Provider[] = [
          { id: "provider-approved-1", name: "Approved Provider", approved: true },
          { id: "provider-pending-1", name: "Pending Provider", approved: false },
        ];
        ```
      - `src/providers/providerRepository.ts` — same shape as
        `UserRepository`:
        ```ts
        export class ProviderRepository {
          constructor(providers: Provider[] = testProviders) { ... }
          findById(providerId: string): Provider | undefined { ... }
        }
        ```
    files:
      - src/providers/providerModel.ts
      - src/providers/providerRepository.ts
      - src/providers/fixtures/testProviders.ts
    rationale: |
      AC8 requires knowing whether a provider is approved before any slot is
      shown, and no provider concept exists anywhere in the current codebase
      (only `users` with roles `customer | provider | admin` — a `provider`
      user is not the same thing as an "approved provider profile"). Kept as
      small and Map-based as `UserRepository` since that's the established
      convention for reference data in this service.

  - description: |
      Introduce the Slot domain: model, in-memory repository, and fixtures.
      - `src/scheduling/slotModel.ts`:
        ```ts
        export type SlotStatus = "available" | "held" | "confirmed";

        export interface Slot {
          id: string;
          providerId: string;
          startTime: string;
          endTime: string;
          status: SlotStatus;
          heldByCustomerId?: string;
          holdExpiresAt?: number;
        }
        ```
      - `src/scheduling/fixtures/testSlots.ts` — seed slots per provider,
        including one already-`confirmed` slot (for AC1) and slots under the
        pending provider (for AC8):
        ```ts
        export const testSlots: Slot[] = [
          { id: "slot-1", providerId: "provider-approved-1", startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:30:00.000Z", status: "available" },
          { id: "slot-2", providerId: "provider-approved-1", startTime: "2026-09-15T10:00:00.000Z", endTime: "2026-09-15T10:30:00.000Z", status: "available" },
          { id: "slot-3", providerId: "provider-approved-1", startTime: "2026-09-15T11:00:00.000Z", endTime: "2026-09-15T11:30:00.000Z", status: "confirmed" },
          { id: "slot-4", providerId: "provider-pending-1", startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:30:00.000Z", status: "available" },
        ];
        ```
      - `src/scheduling/slotRepository.ts`, mirroring
        `SessionRepository`'s Map-based mutation style (`findById`,
        `findByProviderId`, and in-place mutation of the returned `Slot`
        object to place/clear a hold — no separate `update` method needed
        since objects are stored by reference, exactly like
        `session.revoked = true` in `SessionRepository.revokeByRefreshToken`):
        ```ts
        export class SlotRepository {
          constructor(slots: Slot[] = testSlots) { ... }
          findById(slotId: string): Slot | undefined { ... }
          findByProviderId(providerId: string): Slot[] { ... }
        }
        ```
    files:
      - src/scheduling/slotModel.ts
      - src/scheduling/slotRepository.ts
      - src/scheduling/fixtures/testSlots.ts
    rationale: |
      AC1-AC6 all require persisted, mutable slot state (available / held /
      confirmed, plus who holds it and when the hold expires). Modeling this
      as an explicit `status` field (rather than deriving it from a separate
      bookings/holds table) keeps the first cut small; a real `confirmed`
      booking-completion flow is a separate future story per the parent
      epic, so fixtures simply seed one already-`confirmed` slot to exercise
      the AC1 filter.

  - description: |
      Add a runtime-configurable hold duration, defaulting to 10 minutes,
      with no code change required to alter it (AC7).
      - `src/scheduling/holdConfigRepository.ts`:
        ```ts
        export const DEFAULT_HOLD_DURATION_MS = 10 * 60 * 1000;

        export class HoldConfigRepository {
          private holdDurationMs: number;
          constructor(holdDurationMs: number = DEFAULT_HOLD_DURATION_MS) {
            this.holdDurationMs = holdDurationMs;
          }
          getHoldDurationMs(): number {
            return this.holdDurationMs;
          }
          setHoldDurationMs(ms: number): void {
            this.holdDurationMs = ms;
          }
        }
        ```
    files:
      - src/scheduling/holdConfigRepository.ts
    rationale: |
      AC2 needs a default 10-minute hold; AC7 needs that value changeable at
      runtime and immediately effective for new holds. A small injectable
      repository (constructor-defaulted, like every other repository in this
      codebase) satisfies both without introducing a persistence layer that
      doesn't exist anywhere else in the service yet.

  - description: |
      Add `SlotService`, the business-rule layer used by both endpoints:
      availability filtering (approval + not confirmed + not currently
      held) and hold placement with lazy expiry.
      ```ts
      export const SLOT_UNAVAILABLE_MESSAGE =
        "This slot is no longer available. Please choose a different time.";

      export class SlotUnavailableError extends Error {
        constructor() { super(SLOT_UNAVAILABLE_MESSAGE); }
      }

      export class SlotService {
        constructor(
          private slotRepository: SlotRepository,
          private providerRepository: ProviderRepository,
          private holdConfigRepository: HoldConfigRepository,
        ) {}

        listAvailableSlots(providerId: string, now: number = Date.now()): Slot[] {
          const provider = this.providerRepository.findById(providerId);
          if (!provider || !provider.approved) return [];
          return this.slotRepository
            .findByProviderId(providerId)
            .filter((slot) => this.isAvailable(slot, now));
        }

        holdSlot(providerId: string, slotId: string, customerId: string, now: number = Date.now()): Slot {
          const provider = this.providerRepository.findById(providerId);
          const slot = this.slotRepository.findById(slotId);
          if (!provider || !provider.approved || !slot || slot.providerId !== providerId || !this.isAvailable(slot, now)) {
            throw new SlotUnavailableError();
          }
          slot.status = "held";
          slot.heldByCustomerId = customerId;
          slot.holdExpiresAt = now + this.holdConfigRepository.getHoldDurationMs();
          return slot;
        }

        private isAvailable(slot: Slot, now: number): boolean {
          if (slot.status === "confirmed") return false;
          if (slot.status === "held" && slot.holdExpiresAt !== undefined && slot.holdExpiresAt > now) return false;
          return true;
        }
      }
      ```
    files:
      - src/scheduling/slotService.ts
    rationale: |
      Centralizes the availability rule (AC1, AC3, AC8) and the hold rule
      (AC2, AC4, AC5, AC6, AC7) in one place, mirroring how `AuthService`
      centralizes login/refresh/logout rules and `authController.ts` stays a
      thin HTTP translation layer. Expiry is computed lazily inside
      `isAvailable` by comparing `holdExpiresAt` to the supplied `now` —
      exactly how `SessionRepository.isValid(session, now)` already treats
      refresh-token expiry in this codebase — so no `setInterval`/background
      sweeper is needed to satisfy AC4.

  - description: |
      Add the HTTP controller functions, mirroring `authController.ts`'s
      `ControllerResponse` pattern, including bearer-token auth for the hold
      endpoint (reusing `verifyAccessToken` from `tokenService.ts`):
      ```ts
      export function handleListSlots(slotService: SlotService, providerId: string): ControllerResponse {
        const slots = slotService.listAvailableSlots(providerId);
        return { status: 200, body: { slots } };
      }

      export function handleHoldSlot(
        slotService: SlotService,
        providerId: string,
        slotId: string,
        authorizationHeader: string | undefined,
      ): ControllerResponse {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
        const payload = token ? verifyAccessToken(token) : null;
        if (!payload) {
          return { status: 401, body: { error: "missing or malformed authorization header" } };
        }
        try {
          const slot = slotService.holdSlot(providerId, slotId, payload.userId);
          return { status: 200, body: { slot } };
        } catch (err) {
          if (err instanceof SlotUnavailableError) {
            return { status: 409, body: { error: err.message } };
          }
          throw err;
        }
      }
      ```
    files:
      - src/scheduling/slotController.ts
    rationale: |
      Keeps HTTP concerns (status codes, auth header parsing) out of
      `SlotService`, matching the existing split between `authController.ts`
      and `authService.ts`. Reusing `verifyAccessToken` avoids inventing a
      second auth mechanism for identifying the holding customer.

  - description: |
      Wire the new dependencies and two routes into `createApp`/
      `handleRequest`:
      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        providerRepository?: ProviderRepository;
        slotRepository?: SlotRepository;
        holdConfigRepository?: HoldConfigRepository;
      }
      ```
      and, inside `handleRequest`, before the existing
      `route !== "POST /auth/login" && ...` 404 fallback:
      ```ts
      const slotsMatch = method === "GET" && url.pathname.match(/^\/providers\/([^/]+)\/slots$/);
      if (slotsMatch) {
        const result = handleListSlots(slotService, slotsMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }

      const holdMatch = method === "POST" && url.pathname.match(/^\/providers\/([^/]+)\/slots\/([^/]+)\/hold$/);
      if (holdMatch) {
        const result = handleHoldSlot(slotService, holdMatch[1], holdMatch[2], req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - src/app.ts
    rationale: |
      `handleRequest` currently only does exact string route matching
      (`${method} ${url.pathname}`), which can't express the `:providerId`/
      `:slotId` path parameters these two endpoints need, so this adds
      minimal regex matching for just these two routes ahead of the existing
      auth-route allowlist, without restructuring the rest of the dispatcher.
      `AppDependencies` gains the three new optional repositories so tests
      can inject fresh instances per test, exactly like
      `sessionRepository` is injected today.

  - description: |
      Write the failing tests first (see `tests` below), one file per
      concern to mirror `test/login.test.ts` / `test/refresh.test.ts`:
      `test/slotAvailability.test.ts` (AC1, AC3, AC8) and
      `test/slotHold.test.ts` (AC2, AC4, AC5, AC6, AC7).
    files:
      - test/slotAvailability.test.ts
      - test/slotHold.test.ts
    rationale: |
      TDD: every acceptance criterion must have a test written against the
      not-yet-existing endpoints/service first, run to see it fail, then be
      made to pass with the minimal code from the scope items above.

tests:
  - |
    AC1 (test/slotAvailability.test.ts) — only non-confirmed, non-held slots
    are returned for an approved provider:
    ```ts
    test("AC1: only slots that are not confirmed or held are shown", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as { slots: Array<{ id: string }> };
        assert.deepEqual(body.slots.map((s) => s.id).sort(), ["slot-1", "slot-2"]);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 (test/slotHold.test.ts) — beginning checkout holds the slot for the
    default 10-minute window:
    ```ts
    test("AC2: selecting a slot holds it for the default 10-minute window", async () => {
      const server = await startTestServer();
      try {
        const now = Date.now();
        const token = issueAccessToken({ userId: "user-customer-1", role: "customer" });
        const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { slot: { holdExpiresAt: number } };
        assert.ok(Math.abs(body.slot.holdExpiresAt - (now + 10 * 60 * 1000)) < 1000);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 (test/slotAvailability.test.ts) — a held slot disappears from the
    availability list for other customers:
    ```ts
    test("AC3: a held slot is no longer shown as available", async () => {
      const server = await startTestServer();
      try {
        const token = issueAccessToken({ userId: "user-customer-1", role: "customer" });
        await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots`);
        const body = (await res.json()) as { slots: Array<{ id: string }> };
        assert.equal(body.slots.some((s) => s.id === "slot-1"), false);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 (test/slotHold.test.ts) — an expired hold is automatically released
    back to availability, verified via injected `now` (mirrors
    `SessionRepository.isValid(session, now)`'s lazy-expiry pattern):
    ```ts
    test("AC4: an expired hold automatically releases the slot", () => {
      const slotRepository = new SlotRepository();
      const slotService = new SlotService(slotRepository, new ProviderRepository(), new HoldConfigRepository());
      const now = Date.now();
      slotService.holdSlot("provider-approved-1", "slot-1", "user-customer-1", now);
      const elevenMinutesLater = now + 11 * 60 * 1000;
      const available = slotService.listAvailableSlots("provider-approved-1", elevenMinutesLater);
      assert.ok(available.some((s) => s.id === "slot-1"));
    });
    ```
  - |
    AC5 (test/slotHold.test.ts) — a second customer selecting an
    already-held slot is told it is unavailable:
    ```ts
    test("AC5: a second customer selecting a held slot is told it is unavailable", async () => {
      const server = await startTestServer();
      try {
        const tokenA = issueAccessToken({ userId: "user-customer-1", role: "customer" });
        const tokenB = issueAccessToken({ userId: "user-customer-2", role: "customer" });
        await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert.equal(res.status, 409);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 (test/slotHold.test.ts) — that same 409 response explicitly prompts
    the customer to choose a different time:
    ```ts
    test("AC6: the unavailable response prompts choosing a different time", async () => {
      const server = await startTestServer();
      try {
        const tokenA = issueAccessToken({ userId: "user-customer-1", role: "customer" });
        const tokenB = issueAccessToken({ userId: "user-customer-2", role: "customer" });
        await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenB}` },
        });
        const body = (await res.json()) as { error: string };
        assert.equal(body.error, "This slot is no longer available. Please choose a different time.");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 (test/slotHold.test.ts) — changing the configured hold duration
    applies to new holds without a code change:
    ```ts
    test("AC7: a changed hold duration applies to new holds", async () => {
      const holdConfigRepository = new HoldConfigRepository();
      const server = await startTestServer({ holdConfigRepository });
      try {
        holdConfigRepository.setHoldDurationMs(5 * 60 * 1000);
        const now = Date.now();
        const token = issueAccessToken({ userId: "user-customer-1", role: "customer" });
        const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-2/hold`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json()) as { slot: { holdExpiresAt: number } };
        assert.ok(Math.abs(body.slot.holdExpiresAt - (now + 5 * 60 * 1000)) < 1000);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC8 (test/slotAvailability.test.ts) — an unapproved provider's schedule
    shows no slots at all:
    ```ts
    test("AC8: an unapproved provider's schedule shows no slots", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/providers/provider-pending-1/slots`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as { slots: unknown[] };
        assert.deepEqual(body.slots, []);
      } finally {
        await server.close();
      }
    });
    ```

assumptions_or_open_questions:
  - |
    Viewing a provider's slots (`GET /providers/:providerId/slots`) is
    treated as public/unauthenticated, like browsing a schedule before
    login; only beginning checkout (`POST .../hold`) requires a valid
    bearer access token, reusing the existing JWT scheme from
    `tokenService.ts`. No AC states an auth requirement either way — flag
    for reviewer confirmation.
  - |
    No AC specifies an HTTP endpoint for changing the hold-duration
    business configuration, so this plan only adds
    `HoldConfigRepository.setHoldDurationMs()` as a programmatically
    injectable/settable value (verified directly in tests), not a new
    `/admin/...` route. If an admin-facing config API is expected as part
    of this story, that's additional scope not covered here.
  - |
    "Confirmed" slot status is treated as pre-existing data for this story
    (seeded via fixtures) since no booking-confirmation/checkout-completion
    flow exists yet in the codebase; that flow is assumed to belong to a
    separate future story under the "Booking & Scheduling" epic, per the
    epic description mentioning confirmation as part of the broader
    end-to-end flow.
  - |
    Hold expiry is enforced lazily (checked against an injected `now` at
    read/hold time) rather than via a background sweeper/timer, consistent
    with how `SessionRepository.isValid(session, now)` already handles
    refresh-token expiry in this codebase. This means a slot whose hold has
    expired only becomes visible again the next time someone lists or
    attempts to hold it — there is no proactive "release" event fired at
    exactly T+10min, which should satisfy AC4 as worded but is worth
    reviewer confirmation if a push/notification-style release is expected
    instead.
  - |
    `providerId`/`slotId` route segments are treated as opaque IDs with no
    additional format validation beyond existence lookups, matching how
    `username`/`refresh_token` are handled in the existing auth endpoints.

package_dependencies: []

notes: |
  This is a greenfield feature for this repo: `src/providers/` and
  `src/scheduling/` don't exist yet, so every file listed under `scope` is
  new except `src/app.ts`, which is modified to wire the new
  repositories/service and two routes into the existing dispatcher.

  Route matching today in `app.ts` is exact-string (`${method}
  ${url.pathname}`) with no path-parameter support; this plan adds two
  narrowly-scoped regex checks ahead of the existing auth-route allowlist
  rather than introducing a general router, to keep the change minimal and
  consistent with the file's current size/style.

  ```mermaid
  flowchart TD
    Server[server.ts]
    HttpUtils[httpUtils.ts]
    TokenService[tokenService.ts]
    App[app.ts]:::touched
    SlotController[slotController.ts]:::touched
    SlotService[slotService.ts]:::touched
    SlotRepository[slotRepository.ts]:::touched
    ProviderRepository[providerRepository.ts]:::touched
    HoldConfigRepository[holdConfigRepository.ts]:::touched

    Server --> App
    App -->|"uses sendJson/readJsonBody"| HttpUtils
    App -->|"routes GET/POST /providers/:id/slots*"| SlotController
    SlotController -->|"verifyAccessToken for hold auth"| TokenService
    SlotController -->|"listAvailableSlots / holdSlot"| SlotService
    SlotService -->|"findById / findByProviderId"| SlotRepository
    SlotService -->|"findById (approved check)"| ProviderRepository
    SlotService -->|"getHoldDurationMs"| HoldConfigRepository

    classDef touched fill:#f96,color:#000
    class App,SlotController,SlotService,SlotRepository,ProviderRepository,HoldConfigRepository touched
  ```
