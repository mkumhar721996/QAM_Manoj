summary: |
  This adds a No-Show Policy Configuration capability to the existing auth/session Node service,
  following the same layering already used for auth (repository -> service -> controller,
  wired into src/app.ts's route dispatcher). Administrators can configure the financial outcome
  applied when a no-show is detected (no charge, or a fee with a currency from a supported list).
  The policy is stored in-memory and read live on every resolution, so an update takes effect on
  the very next no-show detection with no deploy or restart. When no policy has been configured,
  the system defaults to "no charge" and logs a warning so the gap is surfaced to administrators.
  Only users with role "admin" (the existing Role type in src/users/fixtures/testUsers.ts) may
  read or write the policy; non-admins get a 403 and the stored policy is left untouched. This
  service owns policy configuration and financial-outcome resolution only; actually notifying
  Payments & Invoicing is delegated elsewhere per the parent epic and is out of scope here.

scope:
  - description: |
      Add the no-show policy domain model: the policy shape, the two supported outcome kinds,
      and the supported currency list.

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
      Mirrors src/sessions/sessionModel.ts (plain interface, no behavior) so the new domain
      follows the established repository/model split instead of inlining types into the repo.

  - description: |
      Add an in-memory repository holding the single current policy, mirroring
      src/sessions/sessionRepository.ts's in-memory Map-based style but simpler (one record).

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
      Keeps storage swappable/injectable for tests, exactly like SessionRepository and
      UserRepository are injected via AppDependencies in src/app.ts.

  - description: |
      Add the service layer: validation of update requests (AC6/AC7), persisting the policy,
      and resolving the financial outcome to apply for a detected no-show (AC1-AC5), including
      the safe default and the administrator-facing warning when unconfigured (AC3/AC4).

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

        updatePolicy(input: { outcome?: unknown; feeAmount?: unknown; currency?: unknown }, now: number = Date.now()): NoShowPolicy {
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
      Mirrors src/auth/authService.ts: a plain class taking its repository via constructor
      injection, throwing a dedicated error class the controller maps to an HTTP status (like
      InvalidCredentialsError is mapped in authController.ts). resolveFinancialOutcome() is the
      function a future no-show-detection component would call to learn what to signal to
      Payments & Invoicing; that outbound call itself is out of scope (delegated per the epic).

  - description: |
      Add the HTTP controller: admin-gated GET/PUT for policy configuration, and an
      unauthenticated resolve endpoint standing in for the point where a detected no-show asks
      "what financial outcome applies right now" (the payload returned is what would be
      forwarded to Payments & Invoicing).

      New file `src/noShowPolicy/noShowPolicyController.ts`:
      ```ts
      import type { NoShowPolicyService } from "./noShowPolicyService.ts";
      import { NoShowPolicyValidationError } from "./noShowPolicyService.ts";
      import { verifyAccessToken } from "../auth/tokenService.ts";
      import { asRecord } from "../httpUtils.ts";
      import type { ControllerResponse } from "../auth/authController.ts";

      function requireAdmin(authorizationHeader: string | undefined, now: number): { userId: string } | ControllerResponse {
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
      - src/auth/authController.ts
    rationale: |
      Mirrors handleLogin/handleRefresh in src/auth/authController.ts (thin controller functions
      returning `{status, body}`, catching a domain-specific error). `ControllerResponse` is
      already exported from authController.ts, so it's imported rather than redefined. Admin
      gating reuses tokenService.verifyAccessToken exactly as handleGetSession does, so role
      enforcement follows the same JWT contract already established by the login/session story.

  - description: |
      Wire the new repository/service/controller into the app, adding three routes.

      In `src/app.ts`, add to `AppDependencies`:
      ```ts
      noShowPolicyRepository?: NoShowPolicyRepository;
      ```
      Construct `const noShowPolicyService = new NoShowPolicyService(deps.noShowPolicyRepository ?? new NoShowPolicyRepository());`
      alongside the existing `authService` construction, and pass it into `handleRequest`.

      Add routes in `handleRequest`'s dispatch:
      ```ts
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
      ```
      and include `PUT /no-show-policy` in the set of routes that read a JSON body before
      dispatching to `handleUpdateNoShowPolicy(noShowPolicyService, req.headers.authorization, body)`.
    files:
      - src/app.ts
    rationale: |
      src/app.ts is already the single composition point for repositories/services and the only
      place routes are dispatched (see existing GET /auth/session, POST /auth/login etc.), so new
      routes belong there rather than a second router.

  - description: |
      Add the failing-tests-first integration test file exercising all 9 ACs against a real
      running server, following the exact pattern of test/login.test.ts and test/refresh.test.ts
      (node:test + node:assert/strict + startTestServer + fetch).
    files:
      - test/noShowPolicy.test.ts
    rationale: |
      All existing tests (login.test.ts, refresh.test.ts, logout.test.ts) are black-box HTTP
      integration tests against startTestServer(); no unit-test-only files exist for
      auth/session, so the new domain follows the same testing convention rather than
      introducing a new style.

tests:
  - |
    AC1 (admin configures an outcome; it is saved and applied to subsequent detections):
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
    AC2 (an updated policy governs the next detection, not a stale one):
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
    AC3 (no policy configured -> safe default of no charge):
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
    AC4 (absence of policy is surfaced to administrators, via a logged warning at detection time):
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
    AC5 (saved update governs the next detection with no deploy/restart, i.e. same running process):
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
    AC6 (valid fee amount + supported currency is saved as entered):
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
    AC7 (invalid fee amount or unsupported currency is rejected and not saved):
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
    AC8 (non-administrator denied access to read or modify the policy):
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
    AC9 (a denied modification attempt leaves the current policy unchanged):
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
    There is one global no-show policy (no per-provider/per-business scoping), matching the fact
    that this codebase has no multi-tenant/business model yet. If policies must vary per
    provider/business, the repository/service/routes would need a business/provider id key -
    please confirm this is out of scope for this story.
  - |
    The supported currency list (USD, EUR, GBP) is assumed since the story does not specify one.
    Please confirm the actual list, or confirm these three are acceptable placeholders.
  - |
    No no-show-detection component exists yet in this codebase. `POST /no-show-policy/resolve`
    is introduced as the integration point a future detection flow would call to learn the
    financial outcome to apply; its response body stands in for the signal that would be
    forwarded to Payments & Invoicing. Actually calling/notifying Payments & Invoicing is
    delegated per the parent epic and stays out of this plan's scope.
  - |
    `POST /no-show-policy/resolve` is left unauthenticated at the HTTP layer, since it models a
    service-to-service call from the (not-yet-built) detection component rather than a human
    admin action - AC8/AC9 only gate "access or modify the no-show policy settings". Flagging in
    case the reviewer wants this endpoint protected by a service-to-service credential instead.
  - |
    Authorization error status codes: 401 for a missing/invalid access token, 403 for a valid
    token whose role isn't "admin" - this mirrors the existing 401 pattern in authController.ts
    and adds the 403 role-check on top, since no role-gated endpoint existed before this story.

package_dependencies: []

notes: |
  No new third-party dependencies are needed - this is plain TypeScript on Node's built-in
  `node:test`/`node:http`, matching the existing service exactly.

  The new module deliberately reuses `verifyAccessToken` from `src/auth/tokenService.ts` and the
  `Role` type from `src/users/fixtures/testUsers.ts` rather than inventing a parallel auth
  mechanism, since admin/customer/provider roles and JWT verification already exist end-to-end
  from the login/session story (QAM-MANOJ-STORY-007).

  ```mermaid
  flowchart TD
    A[app.ts requestListener/handleRequest] -->|GET, PUT /no-show-policy; POST /no-show-policy/resolve| B[noShowPolicyController.ts]
    B -->|role check via verifyAccessToken| C[auth/tokenService.ts]
    B -->|getPolicy / updatePolicy / resolveFinancialOutcome| D[noShowPolicyService.ts]
    D -->|get / save| E[noShowPolicyRepository.ts]
    D -->|types + SUPPORTED_CURRENCIES| F[noShowPolicyModel.ts]

    classDef touched fill:#f96,color:#000
    class A,B,D,E,F touched
  ```
