summary: |
  This adds a No-Show Policy Configuration capability to the existing auth/session Node
  service, following the same layering already used for auth (repository -> service ->
  controller, wired into src/app.ts's route dispatcher). Administrators can configure the
  financial outcome applied when a no-show is detected (no charge, or a fee with a currency
  from a supported list). The policy is stored in-memory and read live on every resolution,
  so an update takes effect on the very next no-show detection with no deploy or restart.
  When no policy has been configured, the system defaults to "no charge" and logs a warning
  so the gap is surfaced to administrators. Only users with role "admin" (the existing Role
  type in src/users/fixtures/testUsers.ts) may read or write the policy; non-admins get a 403
  and the stored policy is left untouched. This service owns policy configuration and
  financial-outcome resolution only; actually notifying Payments & Invoicing is delegated
  elsewhere per the parent epic and is out of scope here.

scope:
  - description: |
      Add the no-show policy domain model: the policy shape, the two supported outcome
      kinds, and the supported currency list.

      New file `src/noShowPolicy/noShowPolicyModel.ts`:
      ```ts
      export type NoShowOutcomeType = "no_charge" | "charge_fee";

      export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP"] as const;
      export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

      export interface NoShowPolicy {
        outcome: NoShowOutcomeType;
        feeAmount?: number;   // present only when outcome === "charge_fee"
        currency?: SupportedCurrency; // present only when outcome === "charge_fee"
        updatedAt: number;
      }

      export interface FinancialOutcome {
        configured: boolean;
        outcome: NoShowOutcomeType;
        feeAmount?: number;
        currency?: SupportedCurrency;
      }
      ```
    files:
      - src/noShowPolicy/noShowPolicyModel.ts
    rationale: |
      Verified `src/sessions/sessionModel.ts` is a plain interface with no behavior. This
      mirrors that split so the new domain follows the established repository/model
      separation instead of inlining types into the repository.

  - description: |
      Add an in-memory repository holding the single current policy, mirroring
      `src/sessions/sessionRepository.ts`'s in-memory `Map`-based style but simpler (one
      record, no map needed).

      New file `src/noShowPolicy/noShowPolicyRepository.ts`:
      ```ts
      import type { NoShowPolicy } from "./noShowPolicyModel.ts";

      export class NoShowPolicyRepository {
        private current: NoShowPolicy | undefined;

        get(): NoShowPolicy | undefined {
          return this.current;
        }

        save(policy: NoShowPolicy): void {
          this.current = policy;
        }
      }
      ```
    files:
      - src/noShowPolicy/noShowPolicyRepository.ts
    rationale: |
      Verified `src/app.ts` already accepts `AppDependencies.sessionRepository?` /
      `userRepository?` as optional constructor-injected fields defaulted with `??`. This
      keeps storage swappable/injectable for tests the same way, e.g. AC9's test needs a
      fresh repository per test run via `startTestServer()`.

  - description: |
      Add the service layer: validation of update requests (AC6/AC7), persisting the
      policy, and resolving the financial outcome to apply for a detected no-show
      (AC1-AC5), including the safe default and the administrator-facing warning when
      unconfigured (AC3/AC4).

      New file `src/noShowPolicy/noShowPolicyService.ts`:
      ```ts
      import { NoShowPolicyRepository } from "./noShowPolicyRepository.ts";
      import { SUPPORTED_CURRENCIES } from "./noShowPolicyModel.ts";
      import type { FinancialOutcome, NoShowPolicy, SupportedCurrency } from "./noShowPolicyModel.ts";

      export class NoShowPolicyValidationError extends Error {}

      export class NoShowPolicyService {
        constructor(private repository: NoShowPolicyRepository) {}

        getPolicy(): NoShowPolicy | undefined {
          return this.repository.get();
        }

        updatePolicy(
          input: { outcome?: unknown; feeAmount?: unknown; currency?: unknown },
          now: number = Date.now(),
        ): NoShowPolicy {
          if (input.outcome !== "no_charge" && input.outcome !== "charge_fee") {
            throw new NoShowPolicyValidationError("outcome must be 'no_charge' or 'charge_fee'");
          }

          if (input.outcome === "no_charge") {
            const policy: NoShowPolicy = { outcome: "no_charge", updatedAt: now };
            this.repository.save(policy);
            return policy;
          }

          if (typeof input.feeAmount !== "number" || !Number.isFinite(input.feeAmount) || input.feeAmount <= 0) {
            throw new NoShowPolicyValidationError("feeAmount must be a positive number");
          }
          if (typeof input.currency !== "string" || !(SUPPORTED_CURRENCIES as readonly string[]).includes(input.currency)) {
            throw new NoShowPolicyValidationError(`currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}`);
          }

          const policy: NoShowPolicy = {
            outcome: "charge_fee",
            feeAmount: input.feeAmount,
            currency: input.currency as SupportedCurrency,
            updatedAt: now,
          };
          this.repository.save(policy);
          return policy;
        }

        resolveFinancialOutcome(): FinancialOutcome {
          const policy = this.repository.get();
          if (!policy) {
            console.warn("no-show detected with no configured no-show policy; applying safe default (no charge)");
            return { configured: false, outcome: "no_charge" };
          }
          if (policy.outcome === "no_charge") {
            return { configured: true, outcome: "no_charge" };
          }
          return { configured: true, outcome: "charge_fee", feeAmount: policy.feeAmount, currency: policy.currency };
        }
      }
      ```
    files:
      - src/noShowPolicy/noShowPolicyService.ts
    rationale: |
      Verified `src/auth/authService.ts` is a plain class taking its repository via
      constructor injection and throwing a dedicated error class (`InvalidCredentialsError`,
      `InvalidRefreshTokenError`) that the controller maps to an HTTP status. This mirrors
      that: `NoShowPolicyValidationError` is thrown for AC7 and mapped to 400 in the
      controller. `resolveFinancialOutcome()` is the function a future no-show-detection
      component would call to learn what to signal to Payments & Invoicing; that outbound
      call itself is out of scope (delegated per the epic).

  - description: |
      Add the HTTP controller: admin-gated GET/PUT for policy configuration, and an
      unauthenticated resolve endpoint standing in for the point where a detected no-show
      asks "what financial outcome applies right now" (the payload returned is what would
      be forwarded to Payments & Invoicing).

      New file `src/noShowPolicy/noShowPolicyController.ts`:
      ```ts
      import type { NoShowPolicyService } from "./noShowPolicyService.ts";
      import { NoShowPolicyValidationError } from "./noShowPolicyService.ts";
      import { verifyAccessToken } from "../auth/tokenService.ts";
      import { asRecord } from "../httpUtils.ts";
      import type { ControllerResponse } from "../auth/authController.ts";

      function requireAdmin(
        authorizationHeader: string | undefined,
        now: number,
      ): { userId: string } | ControllerResponse {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
        if (!token) {
          return { status: 401, body: { error: "missing or malformed authorization header" } };
        }
        const payload = verifyAccessToken(token, now);
        if (!payload) {
          return { status: 401, body: { error: "invalid or expired access token" } };
        }
        if (payload.role !== "admin") {
          return { status: 403, body: { error: "administrator privileges required" } };
        }
        return { userId: payload.userId };
      }

      export function handleGetNoShowPolicy(
        service: NoShowPolicyService,
        authorizationHeader: string | undefined,
        now: number = Date.now(),
      ): ControllerResponse {
        const admin = requireAdmin(authorizationHeader, now);
        if ("status" in admin) return admin;

        const policy = service.getPolicy();
        return { status: 200, body: policy ? { ...policy } : { configured: false } };
      }

      export function handleUpdateNoShowPolicy(
        service: NoShowPolicyService,
        authorizationHeader: string | undefined,
        requestBody: unknown,
        now: number = Date.now(),
      ): ControllerResponse {
        const admin = requireAdmin(authorizationHeader, now);
        if ("status" in admin) return admin;

        try {
          const policy = service.updatePolicy(asRecord(requestBody), now);
          return { status: 200, body: { ...policy } };
        } catch (err) {
          if (err instanceof NoShowPolicyValidationError) {
            return { status: 400, body: { error: err.message } };
          }
          throw err;
        }
      }

      export function handleResolveNoShowOutcome(service: NoShowPolicyService): ControllerResponse {
        return { status: 200, body: { ...service.resolveFinancialOutcome() } };
      }
      ```
    files:
      - src/noShowPolicy/noShowPolicyController.ts
    rationale: |
      Verified `src/auth/authController.ts` exports `ControllerResponse` (`{ status: number;
      body?: Record<string, unknown> }`) and that `handleGetSession` already does exactly
      this bearer-token-extract-then-`verifyAccessToken` dance. This reuses
      `ControllerResponse` by import (not redefining it) and reuses
      `tokenService.verifyAccessToken` exactly as `handleGetSession` does, adding only the
      `role !== "admin"` check on top, since no role-gated endpoint existed before this
      story. Verified `asRecord` in `src/httpUtils.ts` has signature
      `asRecord(value: unknown): Record<string, unknown>`, used the same way `handleLogin`
      uses it.

  - description: |
      Wire the new repository/service/controller into the app, adding three routes.
      Verified the current `src/app.ts` dispatch is a straight-line if/else chain: it
      short-circuits `GET /auth/session` first, then rejects anything that isn't one of the
      three known `POST` routes with 404 *before* reading the body, then reads the body once
      for the remaining mutating routes. The new routes need to slot into that same
      shape: two more no-body short-circuits, and one more body-reading route added to the
      allow-list.

      In `src/app.ts`, add to `AppDependencies`:
      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        noShowPolicyRepository?: NoShowPolicyRepository;
      }
      ```
      and inside `createApp`, alongside the existing `authService` construction:
      ```ts
      const noShowPolicyService = new NoShowPolicyService(
        deps.noShowPolicyRepository ?? new NoShowPolicyRepository(),
      );
      ```
      passing `noShowPolicyService` into `handleRequest` alongside `authService`.

      In `handleRequest`, change:
      ```ts
      if (route === "GET /auth/session") {
        const result = handleGetSession(req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }

      if (route !== "POST /auth/login" && route !== "POST /auth/refresh" && route !== "POST /auth/logout") {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req);
      ```
      to:
      ```ts
      if (route === "GET /auth/session") {
        const result = handleGetSession(req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }

      if (route === "GET /no-show-policy") {
        const result = handleGetNoShowPolicy(noShowPolicyService, req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }

      if (route === "POST /no-show-policy/resolve") {
        const result = handleResolveNoShowOutcome(noShowPolicyService);
        sendJson(res, result.status, result.body);
        return;
      }

      const bodyRoutes = new Set([
        "POST /auth/login",
        "POST /auth/refresh",
        "POST /auth/logout",
        "PUT /no-show-policy",
      ]);
      if (!bodyRoutes.has(route)) {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req);

      if (route === "PUT /no-show-policy") {
        const result = handleUpdateNoShowPolicy(noShowPolicyService, req.headers.authorization, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
      leaving the existing `POST /auth/login` / `POST /auth/refresh` / `POST /auth/logout`
      branches below untouched.
    files:
      - src/app.ts
    rationale: |
      `src/app.ts` is already the single composition point for repositories/services and
      the only place routes are dispatched, so new routes belong there rather than a
      second router. The `bodyRoutes` Set replaces the old `!==`/`!==`/`!==` chain rather
      than extending it, because a fourth `&&`-chained `!==` condition would be harder to
      read than adding one more branch that also needs a request body (`PUT
      /no-show-policy`).

  - description: |
      Add the failing-tests-first integration test file exercising all 9 ACs against a real
      running server, following the exact pattern of `test/login.test.ts` and
      `test/refresh.test.ts` (`node:test` + `node:assert/strict` + `startTestServer` +
      `fetch`). Verified `test/refresh.test.ts` already defines a local
      `login(baseUrl): Promise<{ access_token; refresh_token }>` helper hardcoded to
      `customer1` — there is no shared/exported login helper anywhere in `test/`. The new
      file needs to log in as three different roles (admin1, customer1, provider1), so its
      local helper takes a username parameter instead of hardcoding one:
      ```ts
      async function login(baseUrl: string, username: string): Promise<{ access_token: string }> {
        const res = await fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: TEST_PASSWORD }),
        });
        return (await res.json()) as { access_token: string };
      }
      ```
    files:
      - test/noShowPolicy.test.ts
    rationale: |
      All existing tests (`login.test.ts`, `refresh.test.ts`, `logout.test.ts`) are
      black-box HTTP integration tests against `startTestServer()`; no unit-test-only files
      exist for auth/session, so the new domain follows the same testing convention rather
      than introducing a new style.

tests:
  - |
    AC1 — admin configures an outcome; it is saved and applied to a subsequent detection:
    ```ts
    test("AC1: admin configures a financial outcome and it is applied to a subsequent no-show detection", async () => {
      const server = await startTestServer();
      try {
        const { access_token: adminToken } = await login(server.baseUrl, "admin1");
        const putRes = await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 25, currency: "USD" }),
        });
        assert.equal(putRes.status, 200);

        const resolveRes = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
        const body = (await resolveRes.json()) as { outcome: string; feeAmount: number; currency: string };
        assert.equal(body.outcome, "charge_fee");
        assert.equal(body.feeAmount, 25);
        assert.equal(body.currency, "USD");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 — an updated policy governs the next detection, not a stale one:
    ```ts
    test("AC2: an updated policy governs the next no-show detection", async () => {
      const server = await startTestServer();
      try {
        const { access_token: adminToken } = await login(server.baseUrl, "admin1");
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };

        await fetch(`${server.baseUrl}/no-show-policy`, { method: "PUT", headers, body: JSON.stringify({ outcome: "no_charge" }) });
        await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT", headers,
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 40, currency: "EUR" }),
        });

        const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
        const body = (await res.json()) as { outcome: string; feeAmount: number; currency: string };
        assert.equal(body.outcome, "charge_fee");
        assert.equal(body.feeAmount, 40);
        assert.equal(body.currency, "EUR");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 — no policy configured means a detected no-show defaults to no charge:
    ```ts
    test("AC3: with no policy configured, a detected no-show defaults to no charge", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { outcome: string; configured: boolean };
        assert.equal(body.outcome, "no_charge");
        assert.equal(body.configured, false);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 — absence of policy is surfaced to administrators via a logged warning at
    detection time:
    ```ts
    test("AC4: absence of a configured policy is surfaced to administrators", async () => {
      const server = await startTestServer();
      const warnSpy = mock.method(console, "warn");
      try {
        await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
        const warned = warnSpy.mock.calls.some((call) => /no configured no-show policy/.test(String(call.arguments[0])));
        assert.equal(warned, true);
      } finally {
        warnSpy.mock.restore();
        await server.close();
      }
    });
    ```
  - |
    AC5 — a saved policy update governs the next detection without a restart (i.e. same
    running server process, no deploy):
    ```ts
    test("AC5: a saved policy update governs the next detection without a restart", async () => {
      const server = await startTestServer();
      try {
        const { access_token: adminToken } = await login(server.baseUrl, "admin1");
        await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 10, currency: "GBP" }),
        });

        const res = await fetch(`${server.baseUrl}/no-show-policy/resolve`, { method: "POST" });
        const body = (await res.json()) as { outcome: string; feeAmount: number; currency: string };
        assert.equal(body.outcome, "charge_fee");
        assert.equal(body.feeAmount, 10);
        assert.equal(body.currency, "GBP");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 — a valid fee amount and supported currency are saved as entered:
    ```ts
    test("AC6: a valid fee amount and supported currency are saved", async () => {
      const server = await startTestServer();
      try {
        const { access_token: adminToken } = await login(server.baseUrl, "admin1");
        const putRes = await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 15.5, currency: "EUR" }),
        });
        assert.equal(putRes.status, 200);

        const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
        const body = (await getRes.json()) as { feeAmount: number; currency: string };
        assert.equal(body.feeAmount, 15.5);
        assert.equal(body.currency, "EUR");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 — a non-positive fee amount or unsupported currency is rejected without saving:
    ```ts
    test("AC7: a non-positive fee amount or unsupported currency is rejected without saving", async () => {
      const server = await startTestServer();
      try {
        const { access_token: adminToken } = await login(server.baseUrl, "admin1");
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };
        await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT", headers,
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 20, currency: "USD" }),
        });

        const zeroFeeRes = await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT", headers,
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 0, currency: "USD" }),
        });
        assert.equal(zeroFeeRes.status, 400);

        const badCurrencyRes = await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT", headers,
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 20, currency: "ZZZ" }),
        });
        assert.equal(badCurrencyRes.status, 400);

        const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
        const body = (await getRes.json()) as { feeAmount: number; currency: string };
        assert.equal(body.feeAmount, 20);
        assert.equal(body.currency, "USD");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC8 — a non-administrator is denied access to read or modify the policy:
    ```ts
    test("AC8: a non-administrator is denied access to the no-show policy settings", async () => {
      const server = await startTestServer();
      try {
        const { access_token: customerToken } = await login(server.baseUrl, "customer1");

        const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${customerToken}` } });
        assert.equal(getRes.status, 403);

        const putRes = await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 5, currency: "USD" }),
        });
        assert.equal(putRes.status, 403);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC9 — a denied modification attempt leaves the current policy unchanged:
    ```ts
    test("AC9: a denied modification attempt leaves the current policy unchanged", async () => {
      const server = await startTestServer();
      try {
        const { access_token: adminToken } = await login(server.baseUrl, "admin1");
        await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ outcome: "no_charge" }),
        });

        const { access_token: providerToken } = await login(server.baseUrl, "provider1");
        await fetch(`${server.baseUrl}/no-show-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerToken}` },
          body: JSON.stringify({ outcome: "charge_fee", feeAmount: 99, currency: "USD" }),
        });

        const getRes = await fetch(`${server.baseUrl}/no-show-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
        const body = (await getRes.json()) as { outcome: string };
        assert.equal(body.outcome, "no_charge");
      } finally {
        await server.close();
      }
    });
    ```

assumptions_or_open_questions:
  - |
    There is one global no-show policy (no per-provider/per-business scoping), matching
    the fact that this codebase has no multi-tenant/business model yet. If policies must
    vary per provider/business, the repository/service/routes would need a
    business/provider id key — please confirm this is out of scope for this story.
  - |
    The supported currency list (USD, EUR, GBP) is assumed since the story does not
    specify one. Please confirm the actual list, or confirm these three are acceptable
    placeholders.
  - |
    No no-show-detection component exists yet in this codebase. `POST
    /no-show-policy/resolve` is introduced as the integration point a future detection
    flow would call to learn the financial outcome to apply; its response body stands in
    for the signal that would be forwarded to Payments & Invoicing. Actually
    calling/notifying Payments & Invoicing is delegated per the parent epic and stays out
    of this plan's scope.
  - |
    `POST /no-show-policy/resolve` is left unauthenticated at the HTTP layer, since it
    models a service-to-service call from the (not-yet-built) detection component rather
    than a human admin action — AC8/AC9 only gate "access or modify the no-show policy
    settings". Flagging in case the reviewer wants this endpoint protected by a
    service-to-service credential instead.
  - |
    Authorization error status codes: 401 for a missing/invalid access token, 403 for a
    valid token whose role isn't "admin" — this mirrors the existing 401 pattern in
    `authController.ts` and adds the 403 role-check on top, since no role-gated endpoint
    existed before this story.

package_dependencies: []

notes: |
  No new third-party dependencies are needed — this is plain TypeScript on Node's built-in
  `node:test`/`node:http`, matching the existing service exactly (confirmed via
  `package.json`: `"test": "node --experimental-strip-types --env-file=.env.test --test
  test/**/*.test.ts"`, `"dependencies": {}`).

  The new module deliberately reuses `verifyAccessToken` from `src/auth/tokenService.ts`
  and the `Role` type from `src/users/fixtures/testUsers.ts` rather than inventing a
  parallel auth mechanism, since admin/customer/provider roles and JWT verification already
  exist end-to-end from the login/session story (QAM-MANOJ-STORY-007).

  Verified against current code before finalizing this plan: `src/app.ts`'s route dispatch
  is a straight-line if/else (not a lookup table), `src/auth/authController.ts` exports
  `ControllerResponse` and a `handleGetSession` bearer-token pattern to mirror,
  `src/httpUtils.ts#asRecord` and `src/auth/tokenService.ts#verifyAccessToken` signatures
  match what the controller snippet assumes, and `test/refresh.test.ts` establishes the
  precedent of a locally-defined `login()` test helper (there is no shared helper module in
  `test/`), which the new test file extends to take a `username` parameter.

  ```mermaid
  flowchart TD
    A[app.ts handleRequest] -->|"GET/PUT /no-show-policy; POST /no-show-policy/resolve"| B[noShowPolicyController.ts]
    B -->|role check via verifyAccessToken| C[auth/tokenService.ts]
    B -->|asRecord| G[httpUtils.ts]
    B -->|getPolicy / updatePolicy / resolveFinancialOutcome| D[noShowPolicyService.ts]
    D -->|get / save| E[noShowPolicyRepository.ts]
    D -->|types + SUPPORTED_CURRENCIES| F[noShowPolicyModel.ts]
    A -->|existing GET /auth/session, POST /auth/login etc.| H[authController.ts]

    classDef touched fill:#f96,color:#000
    class A,B,D,E,F touched
  ```
