summary: |
  Add a Cancellation Policy Configuration capability as a new `src/cancellationPolicy/`
  module, following the exact layering already established by the auth/session code
  (model -> in-memory repository -> service -> HTTP controller, wired into `createApp` in
  `src/app.ts`). Administrators (role `admin`, using the JWT already issued by the Login &
  Session Management story) can define, add, and remove cancellation policy tiers, each
  expressed as a half-open "hours before appointment" window with an outcome
  (`full_refund` | `partial_refund` | `no_refund`). The service always evaluates a
  cancellation against the repository's *current* tier set (no snapshotting at booking
  time), defaults to a full refund when no tier matches, rejects saves that would create
  overlapping windows, and lets administrators view whether a policy is configured at all.
  Actual refund/fee execution is explicitly out of scope per the parent epic ("delegated to
  Payments & Invoicing") — this story only determines which outcome applies.

scope:
  - description: |
      Define the tier data shape and the half-open-interval overlap predicate that both
      the service's save-time validation and its evaluation-time matching rely on.

      ```ts
      export type CancellationOutcome = "full_refund" | "partial_refund" | "no_refund";

      export interface CancellationPolicyTier {
        id: string;
        label: string;
        minHoursBeforeAppointment: number;
        maxHoursBeforeAppointment: number | null; // null = unbounded (no upper limit)
        outcome: CancellationOutcome;
        refundPercentage?: number; // only meaningful for "partial_refund"
      }

      export type CancellationPolicyTierInput = Omit<CancellationPolicyTier, "id">;

      export function tiersOverlap(
        a: Pick<CancellationPolicyTier, "minHoursBeforeAppointment" | "maxHoursBeforeAppointment">,
        b: Pick<CancellationPolicyTier, "minHoursBeforeAppointment" | "maxHoursBeforeAppointment">,
      ): boolean {
        const aMax = a.maxHoursBeforeAppointment ?? Infinity;
        const bMax = b.maxHoursBeforeAppointment ?? Infinity;
        return a.minHoursBeforeAppointment < bMax && b.minHoursBeforeAppointment < aMax;
      }
      ```
    files:
      - src/cancellationPolicy/cancellationPolicyModel.ts
    rationale: |
      A single shared definition of "what a window is" and "when two windows overlap"
      prevents the save-time overlap check (AC7/AC8) and the evaluate-time tier match
      (AC2/AC3/AC4) from silently using different boundary rules.

  - description: |
      In-memory repository for the current tier set, mirroring `SessionRepository`'s
      Map-backed, constructor-injectable style (`src/sessions/sessionRepository.ts`) so
      tests can inject a fresh instance per test the same way `test/login.test.ts` injects
      a fresh `SessionRepository`.

      ```ts
      export class CancellationPolicyRepository {
        private tiersById: Map<string, CancellationPolicyTier> = new Map();

        getAll(): CancellationPolicyTier[] { return [...this.tiersById.values()]; }
        addTiers(tiers: CancellationPolicyTier[]): void { for (const t of tiers) this.tiersById.set(t.id, t); }
        remove(id: string): boolean { return this.tiersById.delete(id); }
      }
      ```
    files:
      - src/cancellationPolicy/cancellationPolicyRepository.ts
    rationale: |
      No database exists anywhere in this codebase yet; an in-memory Map matches the
      existing `SessionRepository`/`UserRepository` convention exactly and keeps the module
      trivially testable without new infrastructure.

  - description: |
      `CancellationPolicyService` — the business-rule layer. `evaluateCancellation` always
      reads the repository's live state, so an updated threshold governs immediately (AC2)
      with nothing to keep in sync at booking time.

      ```ts
      export class OverlappingTierWindowError extends Error {}

      export class CancellationPolicyService {
        constructor(private repository: CancellationPolicyRepository) {}

        getPolicy(): { tiers: CancellationPolicyTier[]; configured: boolean } {
          const tiers = this.repository.getAll();
          return { tiers, configured: tiers.length > 0 };
        }

        addTiers(inputs: CancellationPolicyTierInput[]): CancellationPolicyTier[] {
          const existing = this.repository.getAll();
          const candidates = inputs.map((input) => ({ id: crypto.randomUUID(), ...input }));
          const all = [...existing, ...candidates];
          for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
              if (tiersOverlap(all[i], all[j])) {
                throw new OverlappingTierWindowError("cancellation policy tier windows overlap");
              }
            }
          }
          this.repository.addTiers(candidates);
          return candidates;
        }

        removeTier(id: string): boolean { return this.repository.remove(id); }

        evaluateCancellation(
          appointmentTimeMs: number,
          cancellationTimeMs: number,
        ): { outcome: CancellationOutcome; tierId: string | null; refundPercentage?: number } {
          const hoursBefore = Math.max(0, (appointmentTimeMs - cancellationTimeMs) / (60 * 60 * 1000));
          const tier = this.repository
            .getAll()
            .find((t) => hoursBefore >= t.minHoursBeforeAppointment && hoursBefore < (t.maxHoursBeforeAppointment ?? Infinity));
          if (!tier) return { outcome: "full_refund", tierId: null };
          return { outcome: tier.outcome, tierId: tier.id, refundPercentage: tier.refundPercentage };
        }
      }
      ```
    files:
      - src/cancellationPolicy/cancellationPolicyService.ts
    rationale: |
      Validating all pairwise overlaps (existing + candidates) before calling
      `repository.addTiers` at all makes the reject-and-don't-persist behavior in AC7
      atomic — either every new tier is added or none are.

  - description: |
      HTTP controller: `handleGetCancellationPolicy`, `handleAddCancellationPolicyTiers`,
      `handleRemoveCancellationPolicyTier`, each gated to `role === "admin"` by reusing
      `verifyAccessToken` from `src/auth/tokenService.ts` (same Bearer-token pattern as
      `handleGetSession` in `src/auth/authController.ts`), and returning the same
      `{ status, body }` `ControllerResponse` shape used by the auth controller.

      ```ts
      function requireAdmin(
        authorizationHeader: string | undefined,
        now: number,
      ): { ok: true; payload: AccessTokenPayload } | { ok: false; response: ControllerResponse } {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
        if (!token) return { ok: false, response: { status: 401, body: { error: "missing or malformed authorization header" } } };
        const payload = verifyAccessToken(token, now);
        if (!payload) return { ok: false, response: { status: 401, body: { error: "invalid or expired access token" } } };
        if (payload.role !== "admin") return { ok: false, response: { status: 403, body: { error: "administrator role required" } } };
        return { ok: true, payload };
      }
      ```
    files:
      - src/cancellationPolicy/cancellationPolicyController.ts
    rationale: |
      Every AC in this story is framed as "an administrator ..."; reusing the JWT `role`
      claim already issued by the Login & Session Management story is the minimal way to
      enforce that without inventing a second auth mechanism.

  - description: |
      Wire the three new routes and the repository/service into `createApp`, following the
      existing dependency-injection pattern (`deps.sessionRepository ?? new SessionRepository()`
      in `src/app.ts`) and extending the `AppDependencies` interface and the
      `route = \`${method} ${url.pathname}\`` dispatch already used there.

      ```ts
      // GET    /cancellation-policy
      // POST   /cancellation-policy/tiers
      // DELETE /cancellation-policy/tiers/:id
      ```
    files:
      - src/app.ts
    rationale: |
      `app.ts` is the single place today's routes and dependencies are constructed and
      matched (`${method} ${pathname}`); the DELETE route needs a `pathname.startsWith(...)`
      check instead of exact string equality since the existing router has no path-param
      support yet.

tests:
  - |
    AC1 (threshold saved and applied to subsequent evaluations) — `test/cancellationPolicy.test.ts`:
    ```ts
    test("AC1: a saved threshold is applied to subsequent cancellation evaluations", async () => {
      const cancellationPolicyRepository = new CancellationPolicyRepository();
      const server = await startTestServer({ cancellationPolicyRepository });
      const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
      const res = await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          tiers: [{ label: "Free cancellation", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: null, outcome: "full_refund" }],
        }),
      });
      assert.equal(res.status, 201);

      const service = new CancellationPolicyService(cancellationPolicyRepository);
      const appointmentTime = Date.parse("2026-01-10T12:00:00Z");
      const cancellationTime = Date.parse("2026-01-09T10:00:00Z"); // 26h before
      assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "full_refund");
    });
    ```
    Minimal code to pass: the model, repository, service, controller, and route wiring described in `scope` above.

  - |
    AC2 (an updated threshold governs, not the one in place at booking time) — `test/cancellationPolicyService.test.ts`:
    ```ts
    test("AC2: an updated threshold governs evaluation, not the threshold at booking time", () => {
      const service = new CancellationPolicyService(new CancellationPolicyRepository());
      service.addTiers([
        { label: "Free", minHoursBeforeAppointment: 48, maxHoursBeforeAppointment: null, outcome: "full_refund" },
        { label: "Late", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 48, outcome: "no_refund" },
      ]);
      const appointmentTime = Date.parse("2026-01-10T12:00:00Z");
      const cancellationTime = Date.parse("2026-01-09T12:00:00Z"); // 24h before

      assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "no_refund");

      for (const tier of service.getPolicy().tiers) service.removeTier(tier.id);
      service.addTiers([
        { label: "Free", minHoursBeforeAppointment: 12, maxHoursBeforeAppointment: null, outcome: "full_refund" },
        { label: "Late", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 12, outcome: "no_refund" },
      ]);

      assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "full_refund");
    });
    ```
    Minimal code to pass: `evaluateCancellation` reads `repository.getAll()` fresh on every call rather than caching/snapshotting.

  - |
    AC3 (the tier whose window matches the cancellation timing is applied) — `test/cancellationPolicyService.test.ts`:
    ```ts
    test("AC3: the tier whose window matches the cancellation timing is applied", () => {
      const service = new CancellationPolicyService(new CancellationPolicyRepository());
      service.addTiers([
        { label: "Full", minHoursBeforeAppointment: 72, maxHoursBeforeAppointment: null, outcome: "full_refund" },
        { label: "Partial", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: 72, outcome: "partial_refund", refundPercentage: 50 },
        { label: "None", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 24, outcome: "no_refund" },
      ]);
      const appointmentTime = Date.parse("2026-01-10T12:00:00Z");

      assert.equal(service.evaluateCancellation(appointmentTime, Date.parse("2026-01-06T12:00:00Z")).outcome, "full_refund");
      const partial = service.evaluateCancellation(appointmentTime, Date.parse("2026-01-09T00:00:00Z"));
      assert.equal(partial.outcome, "partial_refund");
      assert.equal(partial.refundPercentage, 50);
      assert.equal(service.evaluateCancellation(appointmentTime, Date.parse("2026-01-10T06:00:00Z")).outcome, "no_refund");
    });
    ```
    Minimal code to pass: the `find` predicate in `evaluateCancellation` using `hoursBefore >= min && hoursBefore < (max ?? Infinity)`.

  - |
    AC4 (no policy configured defaults to full refund) — `test/cancellationPolicyService.test.ts`:
    ```ts
    test("AC4: an unconfigured policy defaults to a full refund on evaluation", () => {
      const service = new CancellationPolicyService(new CancellationPolicyRepository());
      const result = service.evaluateCancellation(Date.parse("2026-01-10T12:00:00Z"), Date.parse("2026-01-10T06:00:00Z"));
      assert.equal(result.outcome, "full_refund");
      assert.equal(result.tierId, null);
    });
    ```
    Minimal code to pass: the `if (!tier) return { outcome: "full_refund", tierId: null };` fallback.

  - |
    AC5 (absence of a configured policy is surfaced to the administrator) — `test/cancellationPolicy.test.ts`:
    ```ts
    test("AC5: an unconfigured policy is surfaced to the administrator viewing settings", async () => {
      const server = await startTestServer();
      const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
      const res = await fetch(`${server.baseUrl}/cancellation-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { configured: boolean; tiers: unknown[] };
      assert.equal(body.configured, false);
      assert.deepEqual(body.tiers, []);
    });
    ```
    Minimal code to pass: `handleGetCancellationPolicy` returning `service.getPolicy()` as the JSON body.

  - |
    AC6 (a removed tier no longer governs evaluation) — `test/cancellationPolicy.test.ts`:
    ```ts
    test("AC6: a removed tier no longer governs evaluation after removal", async () => {
      const repo = new CancellationPolicyRepository();
      const server = await startTestServer({ cancellationPolicyRepository: repo });
      const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
      await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ tiers: [{ label: "None", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 24, outcome: "no_refund" }] }),
      });
      const tierId = repo.getAll()[0].id;
      const service = new CancellationPolicyService(repo);
      const appointmentTime = Date.parse("2026-01-10T12:00:00Z");
      const cancellationTime = Date.parse("2026-01-10T06:00:00Z"); // 6h before

      assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "no_refund");

      const deleteRes = await fetch(`${server.baseUrl}/cancellation-policy/tiers/${tierId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(deleteRes.status, 204);
      assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "full_refund");
    });
    ```
    Minimal code to pass: `handleRemoveCancellationPolicyTier` calling `service.removeTier(id)` and the DELETE route match in `app.ts`.

  - |
    AC7 (overlapping tier windows rejected and not persisted) — `test/cancellationPolicy.test.ts`:
    ```ts
    test("AC7: overlapping tier windows are rejected and not persisted", async () => {
      const repo = new CancellationPolicyRepository();
      const server = await startTestServer({ cancellationPolicyRepository: repo });
      const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
      await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ tiers: [{ label: "Full", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: null, outcome: "full_refund" }] }),
      });

      const res = await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ tiers: [{ label: "Partial", minHoursBeforeAppointment: 12, maxHoursBeforeAppointment: 36, outcome: "partial_refund", refundPercentage: 50 }] }),
      });
      assert.equal(res.status, 409);
      assert.match(((await res.json()) as { error: string }).error, /overlap/i);
      assert.equal(repo.getAll().length, 1);
    });
    ```
    Minimal code to pass: `CancellationPolicyService.addTiers` validating all pairwise overlaps before calling `repository.addTiers`, and the controller mapping `OverlappingTierWindowError` to HTTP 409.

  - |
    AC8 (non-overlapping tier windows saved successfully) — `test/cancellationPolicy.test.ts`:
    ```ts
    test("AC8: non-overlapping tier windows are saved successfully", async () => {
      const repo = new CancellationPolicyRepository();
      const server = await startTestServer({ cancellationPolicyRepository: repo });
      const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
      await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ tiers: [{ label: "Full", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: null, outcome: "full_refund" }] }),
      });
      const res = await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ tiers: [{ label: "None", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 24, outcome: "no_refund" }] }),
      });
      assert.equal(res.status, 201);
      assert.equal(repo.getAll().length, 2);
    });
    ```
    Minimal code to pass: the same `addTiers` path as AC7, taking the non-overlapping branch (no error thrown, both tiers persisted).

assumptions_or_open_questions:
  - |
    A cancellation whose timing falls in a *gap* between configured tiers (not overlapping,
    just uncovered — e.g. tiers cover 0-24h and 72h+ but not 24-72h) defaults to
    `full_refund`, the same fallback as "no policy configured" (AC4). No AC addresses this
    case directly; full refund was chosen as the safer default for an unspecified rule.
  - |
    A cancellation timestamp at or after the appointment time is clamped to 0 hours-before
    (rather than going negative), so it falls into whichever tier covers `0`. No AC
    addresses cancelling after the appointment.
  - |
    There is no booking/appointment domain anywhere in this codebase yet (only auth/session
    exists, confirmed via `src/` glob). `evaluateCancellation` therefore takes raw
    `appointmentTimeMs`/`cancellationTimeMs` timestamps directly rather than a booking ID,
    and is exposed only as an importable service method — not a new HTTP endpoint — for a
    future Booking module to call. Actual refund/fee processing is out of scope per the
    parent epic ("delegated to Payments & Invoicing"); this story only determines the outcome.
  - |
    Cancellation-policy admin endpoints are restricted to `role === "admin"` by reusing the
    JWT `role` claim already issued by the Login & Session Management story
    (`src/auth/tokenService.ts`, confirmed `Role` includes `"admin"` in
    `src/users/fixtures/testUsers.ts`). No new authorization mechanism is introduced, and no
    dedicated "non-admin is rejected" test is added since no AC calls for it directly — the
    guard itself is implemented because every AC is framed as "an administrator ...".
  - |
    Editing an existing tier's window is done via DELETE then POST (remove + re-add) rather
    than a dedicated PATCH/PUT-by-id endpoint, since no AC distinguishes "edit" from
    "remove one tier, add a replacement".
  - |
    Tier windows use a half-open interval `[minHoursBeforeAppointment, maxHoursBeforeAppointment)`
    so two tiers that share a boundary (one ending at 24h, the next starting at 24h) are
    treated as adjacent, not overlapping — this determines the exact pass/fail line for
    AC7 vs AC8.

package_dependencies: []

notes: |
  This mirrors the existing `src/auth/` and `src/sessions/` modules' layering exactly
  (model type -> in-memory `Map`-backed repository, constructor-injectable -> service class
  holding business rules -> controller functions returning `{ status, body }` -> routes
  matched by exact `${method} ${pathname}` string in `app.ts`, with one exception: the
  DELETE route needs a `pathname.startsWith(...)` check for the `:id` path param, since
  today's router has no path-param support). `AppDependencies` in `src/app.ts` gains an
  optional `cancellationPolicyRepository`, following the same optional-injection pattern
  already used for `userRepository`/`sessionRepository`. Verified against the current
  codebase: `src/app.ts`, `src/auth/authController.ts`, `src/auth/tokenService.ts`,
  `src/sessions/sessionRepository.ts`, `src/httpUtils.ts`, `test/testServer.ts`, and
  `test/login.test.ts` all still exist with the signatures referenced above, and no
  cancellation-policy or booking module exists yet, so this is purely additive.

  ```mermaid
  flowchart TD
    classDef touched fill:#f96,color:#000
    classDef context fill:#eee,color:#000

    app["src/app.ts<br/>createApp / handleRequest"]:::touched
    controller["cancellationPolicyController.ts<br/>handle* + requireAdmin"]:::touched
    service["cancellationPolicyService.ts<br/>CancellationPolicyService"]:::touched
    repo["cancellationPolicyRepository.ts<br/>CancellationPolicyRepository"]:::touched
    model["cancellationPolicyModel.ts<br/>tiersOverlap + types"]:::touched
    token["src/auth/tokenService.ts<br/>verifyAccessToken"]:::context
    httpUtils["src/httpUtils.ts<br/>asRecord / sendJson"]:::context

    app -->|"routes GET/POST/DELETE /cancellation-policy*"| controller
    controller -->|"admin-only guard reuses existing JWT role claim"| token
    controller -->|"parses/serializes request+response bodies"| httpUtils
    controller -->|"getPolicy / addTiers / removeTier / evaluateCancellation"| service
    service -->|"getAll / addTiers / remove"| repo
    service -->|"tiersOverlap for save-time validation & window matching for evaluation"| model
    repo -->|"tier shape"| model
  ```
