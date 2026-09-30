summary: |
  This repo (`qam-manoj-story-096-bearer-token-authentication-and-tenant-isolation`) currently has
  NO `/v1` route prefix, NO tenant concept anywhere (only `User.role` and per-project
  `memberUserIds`), and per-endpoint ad-hoc bearer-token parsing duplicated across
  `cartController.ts` and `workItemController.ts` (each with its own `extractBearerPayload` +
  inline `{ status: 401, body: { error: "..." } }`), plus one endpoint (`GET /pizzas/:id`) that is
  currently unauthenticated entirely. This plan (1) introduces a `tenantId` on `User` and `Project`
  (propagated onto the access token at login/refresh), (2) moves every route under a `/v1` prefix
  (matching the AC wording "any /v1/ endpoint" and the parent epic's "consistent routing
  conventions"), (3) centralizes bearer-token resolution into one auth gate in `src/app.ts` that
  runs before route dispatch for every `/v1/*` path except the three routes that issue/revoke
  tokens themselves (`login`, `refresh`, `logout`), returning a new `{ error: { code, message } }`
  envelope on 401, (4) extends `WorkItemService.assertAccess` to also require
  `project.tenantId === callerTenantId` (in addition to, not instead of, the existing
  `memberUserIds` check from STORY-082) so a valid token from tenant A can never read/write a
  tenant-B-owned project's work items, and (5) adds one concrete role-based permission rule (the
  `admin` role may authenticate but may not place pizza-cart orders) to make AC6's 403 `FORBIDDEN`
  case real without regressing STORY-082's AC8, which already established that any project member,
  regardless of role, gets uniform work-item CRUD. Existing passing test suites
  (`login.test.ts`/`refresh.test.ts`/`logout.test.ts`/`cartCustomisation.test.ts`/
  `workItemCrud.test.ts`) are updated only mechanically (new `/v1` paths, one token-payload literal
  gaining `tenantId`) - no behavioural change to what they assert.
scope:
  - description: |
      Write the failing acceptance tests first, covering AC1-AC6 against the not-yet-existing
      `/v1` prefix, tenant check, and permission rule. Must fail (404 for missing `/v1` prefix,
      wrong status codes for tenant/permission checks) before any implementation exists.
    files:
      - test/authAndTenantIsolation.test.ts
    rationale: |
      Establishes the test-first contract for this story before any production code changes,
      matching the existing `test/*.test.ts` style (raw fetch against `startTestServer()`).
  - description: |
      Add a `tenantId` to the identity/project domain: `User` (fixtures), the JWT access-token
      payload, and `Project` (model + fixtures). Tenant boundaries reuse the existing
      project-membership grouping from STORY-082 (`project-apollo`'s members `user-customer-1`/
      `user-admin-1` become tenant-1; `project-zephyr`'s member `user-provider-1` becomes tenant-2)
      so no existing STORY-082/STORY-007 fixture relationship is broken.

      ```ts
      // src/users/fixtures/testUsers.ts
      export interface User {
        id: string;
        username: string;
        passwordHash: string;
        role: Role;
        tenantId: string;
      }
      const testUserSeeds: Array<Omit<User, "passwordHash">> = [
        { id: "user-customer-1", username: "customer1", role: "customer", tenantId: "tenant-1" },
        { id: "user-provider-1", username: "provider1", role: "provider", tenantId: "tenant-2" },
        { id: "user-admin-1", username: "admin1", role: "admin", tenantId: "tenant-1" },
      ];
      ```

      ```ts
      // src/projects/projectModel.ts
      export interface Project {
        id: string;
        key: string;
        tenantId: string;
        memberUserIds: string[];
      }
      ```

      ```ts
      // src/projects/fixtures/testProjects.ts
      export const testProjects: Project[] = [
        { id: "project-apollo", key: "APOLLO", tenantId: "tenant-1", memberUserIds: ["user-customer-1", "user-admin-1"] },
        { id: "project-zephyr", key: "ZEPHYR", tenantId: "tenant-2", memberUserIds: ["user-provider-1"] },
      ];
      ```

      ```ts
      // src/auth/tokenService.ts
      export interface AccessTokenPayload {
        userId: string;
        role: Role;
        tenantId: string;
        iat: number;
        exp: number;
      }
      export function issueAccessToken(
        payload: { userId: string; role: Role; tenantId: string },
        now: number = Date.now(),
      ): string { /* unchanged body, just a wider payload type */ }
      ```

      `AuthService.login`/`refresh` (`src/auth/authService.ts`) pass `tenantId: user.tenantId` into
      `issueAccessToken`.
    files:
      - src/users/fixtures/testUsers.ts
      - src/projects/projectModel.ts
      - src/projects/fixtures/testProjects.ts
      - src/auth/tokenService.ts
      - src/auth/authService.ts
    rationale: |
      AC3/AC4/AC5 require tenant identity to come from the token itself, not be re-derived from
      per-item ownership - this is the minimal set of fixture/model/token changes that makes a
      caller's tenant a first-class, checkable value at every layer, and it deliberately keeps
      (rather than replaces) STORY-082's `memberUserIds` membership check so that story's AC8 test
      keeps passing unchanged.
  - description: |
      Add a single shared auth-resolution helper and an error-envelope helper, so every controller
      stops duplicating bearer-token parsing.

      ```ts
      // src/auth/requestAuth.ts (new)
      import { verifyAccessToken } from "./tokenService.ts";
      import type { Role } from "../users/fixtures/testUsers.ts";

      export interface AuthContext {
        userId: string;
        role: Role;
        tenantId: string;
      }

      export function resolveAuthContext(
        authorizationHeader: string | undefined,
        now: number = Date.now(),
      ): AuthContext | null {
        const token = authorizationHeader?.startsWith("Bearer ")
          ? authorizationHeader.slice("Bearer ".length)
          : undefined;
        if (!token) {
          return null;
        }
        const payload = verifyAccessToken(token, now);
        if (!payload) {
          return null;
        }
        return { userId: payload.userId, role: payload.role, tenantId: payload.tenantId };
      }
      ```

      ```ts
      // src/httpUtils.ts (addition)
      export function errorEnvelope(code: string, message: string): Record<string, unknown> {
        return { error: { code, message } };
      }
      ```
    files:
      - src/auth/requestAuth.ts
      - src/httpUtils.ts
    rationale: |
      AC1/AC2/AC6 need one authoritative place that produces the `{ error: { code, message } }`
      envelope, and one authoritative place that decides "is this bearer token present and valid" -
      today that logic is copy-pasted (and inconsistent in shape) across `cartController.ts` and
      `workItemController.ts`.
  - description: |
      Rewrite `src/app.ts`'s routing: prefix every route with `/v1`, and add one auth gate that
      runs before route dispatch for any `/v1/*` path except the three token-issuing/revoking
      routes, replacing every per-handler `req.headers.authorization` pass-through with the
      already-resolved `AuthContext`.

      ```ts
      const PUBLIC_ROUTES = new Set(["POST /v1/auth/login", "POST /v1/auth/refresh", "POST /v1/auth/logout"]);

      async function handleRequest(...): Promise<void> {
        const method = req.method ?? "GET";
        const url = new URL(req.url ?? "/", "http://localhost");
        const route = `${method} ${url.pathname}`;

        try {
          let authContext: AuthContext | undefined;
          if (url.pathname.startsWith("/v1/") && !PUBLIC_ROUTES.has(route)) {
            const context = resolveAuthContext(req.headers.authorization);
            if (!context) {
              sendJson(res, 401, errorEnvelope("UNAUTHORIZED", "missing, malformed, or expired bearer token"));
              return;
            }
            authContext = context;
          }

          if (route === "GET /v1/auth/session") {
            const result = handleGetSession(authContext!);
            sendJson(res, result.status, result.body);
            return;
          }
          const pizzaMatch = url.pathname.match(/^\/v1\/pizzas\/([^/]+)$/);
          if (method === "GET" && pizzaMatch) {
            const result = handleGetPizza(pizzaRepository, pizzaMatch[1]);
            sendJson(res, result.status, result.body);
            return;
          }
          if (route === "GET /v1/cart") {
            const result = handleGetCart(cartService, authContext!);
            sendJson(res, result.status, result.body);
            return;
          }
          // ...analogous /v1/-prefixed regex matches for /v1/work-items/:id and
          // /v1/projects/:id/work-items, each now calling handlers with authContext! instead of
          // req.headers.authorization, and the POST /v1/auth/login|refresh|logout branches
          // unchanged except for the /v1 prefix on the route string.
        } catch (err) { /* unchanged */ }
      }
      ```
    files:
      - src/app.ts
    rationale: |
      `createApp`/`handleRequest` is the single composition root and dispatcher today - the auth
      gate belongs there, once, rather than re-implemented per controller, which is exactly what
      AC1 ("every endpoint") and AC2 require and what today's per-handler duplication fails to
      guarantee (e.g. `GET /pizzas/:id` currently has no auth check at all).
  - description: |
      Update `authController.ts`, `cartController.ts`, and `workItemController.ts` to accept the
      resolved `AuthContext` instead of a raw header, deleting their local `extractBearerPayload`
      duplicates, and add the one concrete AC6 permission rule: the `admin` role may authenticate
      but may not place a cart order.

      ```ts
      // src/auth/authController.ts
      export function handleGetSession(authContext: AuthContext): ControllerResponse {
        return { status: 200, body: { user_id: authContext.userId, role: authContext.role } };
      }
      ```

      ```ts
      // src/cart/cartController.ts
      export function handleAddToCart(
        cartService: CartService,
        authContext: AuthContext,
        requestBody: unknown,
      ): ControllerResponse {
        if (authContext.role === "admin") {
          return { status: 403, body: errorEnvelope("FORBIDDEN", "role 'admin' is not permitted to place cart orders") };
        }
        // ...unchanged validation/service-call logic below, using authContext.userId in place of
        // payload.userId.
      }

      export function handleGetCart(cartService: CartService, authContext: AuthContext): ControllerResponse {
        // unchanged body, using authContext.userId in place of payload.userId; no permission
        // restriction on reading one's own cart.
      }
      ```

      ```ts
      // src/workitems/workItemController.ts
      export function handleCreateWorkItem(
        workItemService: WorkItemService,
        authContext: AuthContext,
        projectId: string,
        requestBody: unknown,
      ): ControllerResponse {
        // ...unchanged validation, then:
        const item = workItemService.createWorkItem(projectId, authContext.userId, authContext.tenantId, {
          kind, title, description, parentId, dependsOnIds,
        });
        // ...unchanged error mapping below.
      }
      // handleGetWorkItem/handleUpdateWorkItem/handleDeleteWorkItem: same pattern, each now taking
      // authContext instead of authorizationHeader and passing authContext.tenantId through.
      ```
    files:
      - src/auth/authController.ts
      - src/cart/cartController.ts
      - src/workitems/workItemController.ts
    rationale: |
      Keeps HTTP-shape concerns (status codes, envelope shape) in the controller layer, matching
      the existing convention, while removing the now-redundant per-controller bearer-parsing. The
      `admin`-cannot-order-pizza rule is the one operation in the existing domain that can be
      permission-gated by role without contradicting STORY-082's AC8 (which already requires
      uniform, role-agnostic CRUD for any project member on work items) - see
      `assumptions_or_open_questions` for why this specific rule was chosen.
  - description: |
      Thread `tenantId` through `WorkItemService`'s four public methods and extend
      `assertAccess` to also require the project's tenant to match the caller's.

      ```ts
      // src/workitems/workItemService.ts
      private assertAccess(project: Project | undefined, projectId: string, userId: string, tenantId: string): Project {
        if (!project) {
          throw new ProjectNotFoundError(projectId);
        }
        if (project.tenantId !== tenantId || !this.projectRepository.hasAccess(project, userId)) {
          throw new ProjectAccessDeniedError(projectId);
        }
        return project;
      }

      createWorkItem(projectId: string, userId: string, tenantId: string, input: CreateWorkItemInput, now: number = Date.now()): WorkItem {
        const project = this.assertAccess(this.projectRepository.findById(projectId), projectId, userId, tenantId);
        // ...unchanged below.
      }

      getWorkItem(id: string, userId: string, tenantId: string): WorkItem | undefined { /* assertAccess(..., tenantId) */ }
      updateWorkItem(id: string, userId: string, tenantId: string, patch: UpdateWorkItemInput, now: number = Date.now()): WorkItem | undefined { /* assertAccess(..., tenantId) */ }
      deleteWorkItem(id: string, userId: string, tenantId: string): void { /* assertAccess(..., tenantId) */ }
      ```
    files:
      - src/workitems/workItemService.ts
    rationale: |
      This is the concrete enforcement point for AC3/AC4: a valid token for tenant A can never
      pass `assertAccess` for a project (and therefore a work item) whose `tenantId` differs, even
      if `memberUserIds` were ever misconfigured to include a cross-tenant user id. The check is
      additive (`||`) so it can only make access stricter than STORY-082's existing behaviour,
      never looser.
  - description: |
      Update the five existing test files to call the new `/v1`-prefixed paths and (for the one
      call site that constructs a token payload directly) add the now-required `tenantId` field.
      No assertions change - this is a mechanical path/compile fix so the already-accepted
      STORY-007/STORY-050/STORY-082 behaviour keeps passing under the new routing.

      Concrete required edits:
      - Every `fetch(`${server.baseUrl}/auth/...`)`, `/pizzas/...`, `/cart...`, `/work-items/...`,
        `/projects/.../work-items` call becomes `${server.baseUrl}/v1/...`.
      - `test/cartCustomisation.test.ts`'s first request (`GET /pizzas/pizza-margherita` with no
        Authorization header) must log in first and send `Authorization: Bearer ${accessToken}`,
        since that endpoint is no longer unauthenticated.
      - `test/refresh.test.ts`'s direct `issueAccessToken({ userId: "user-customer-1", role: "customer" }, ...)`
        call becomes `issueAccessToken({ userId: "user-customer-1", role: "customer", tenantId: "tenant-1" }, ...)`.
    files:
      - test/login.test.ts
      - test/refresh.test.ts
      - test/logout.test.ts
      - test/cartCustomisation.test.ts
      - test/workItemCrud.test.ts
    rationale: |
      Moving every route under `/v1` and widening the token payload are breaking changes to the
      literal strings/types these already-merged tests depend on; fixing them is required for the
      suite to compile and pass, not new test coverage.
tests:
  - |
    AC1 - GIVEN a request with no Authorization header WHEN any /v1/ endpoint is called THEN the
    API returns 401 with an error envelope containing error code 'UNAUTHORIZED' and a human
    readable message.
    ```ts
    test("AC1: missing Authorization header returns 401 UNAUTHORIZED on any /v1/ endpoint", async () => {
      const server = await startTestServer();
      try {
        for (const path of ["/v1/auth/session", "/v1/pizzas/pizza-margherita"]) {
          const res = await fetch(`${server.baseUrl}${path}`);
          assert.equal(res.status, 401);
          const body = (await res.json()) as { error: { code: string; message: string } };
          assert.equal(body.error.code, "UNAUTHORIZED");
          assert.ok(body.error.message.length > 0);
        }
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - GIVEN a request with a malformed or expired bearer token WHEN any /v1/ endpoint is
    called THEN the API returns 401 with error code 'UNAUTHORIZED'.
    ```ts
    test("AC2: malformed or expired bearer token returns 401 UNAUTHORIZED", async () => {
      const server = await startTestServer();
      try {
        const malformedRes = await fetch(`${server.baseUrl}/v1/auth/session`, {
          headers: { Authorization: "Bearer not-a-real-token" },
        });
        assert.equal(malformedRes.status, 401);
        assert.equal(((await malformedRes.json()) as { error: { code: string } }).error.code, "UNAUTHORIZED");

        const expiredToken = issueAccessToken(
          { userId: "user-customer-1", role: "customer", tenantId: "tenant-1" },
          Date.now() - 16 * 60 * 1000,
        );
        const expiredRes = await fetch(`${server.baseUrl}/v1/auth/session`, {
          headers: { Authorization: `Bearer ${expiredToken}` },
        });
        assert.equal(expiredRes.status, 401);
        assert.equal(((await expiredRes.json()) as { error: { code: string } }).error.code, "UNAUTHORIZED");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN a valid bearer token belonging to tenant A WHEN a resource owned by tenant B is
    requested THEN the API returns a 4xx error response.
    ```ts
    test("AC3: tenant A token requesting a tenant B work item gets a 4xx response", async () => {
      const server = await startTestServer();
      try {
        const tenantBToken = await loginAs(server.baseUrl, "provider1");
        const created = (await (
          await createWorkItem(server.baseUrl, tenantBToken, "project-zephyr", { kind: "TASK", title: "Zephyr Secret Plan" })
        ).json()) as { id: string };

        const tenantAToken = await loginAs(server.baseUrl, "customer1");
        const res = await getWorkItem(server.baseUrl, tenantAToken, created.id);
        assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN a valid bearer token belonging to tenant A WHEN a resource owned by tenant B is
    requested THEN the response body does not contain tenant B's resource data.
    ```ts
    test("AC4: the 4xx response body never contains tenant B's resource data", async () => {
      const server = await startTestServer();
      try {
        const tenantBToken = await loginAs(server.baseUrl, "provider1");
        const created = (await (
          await createWorkItem(server.baseUrl, tenantBToken, "project-zephyr", { kind: "TASK", title: "Zephyr Secret Plan" })
        ).json()) as { id: string };

        const tenantAToken = await loginAs(server.baseUrl, "customer1");
        const res = await getWorkItem(server.baseUrl, tenantAToken, created.id);
        const bodyText = await res.text();
        assert.ok(!bodyText.includes("Zephyr Secret Plan"));
        assert.ok(!bodyText.includes(created.id));
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 - GIVEN a valid bearer token for tenant A WHEN any /v1/ endpoint returning tenant-scoped
    data is called THEN the response contains only resources belonging to tenant A.
    ```ts
    test("AC5: GET /v1/cart for tenant A never returns tenant B's cart items", async () => {
      const server = await startTestServer();
      try {
        const tenantBToken = await loginAs(server.baseUrl, "provider1");
        await postCartItem(server.baseUrl, tenantBToken, {
          pizza_id: "pizza-margherita", size: "size-medium", crust: "crust-thin",
          toppings: ["topping-mushroom"], quantity: 1,
        });

        const tenantAToken = await loginAs(server.baseUrl, "customer1");
        await postCartItem(server.baseUrl, tenantAToken, {
          pizza_id: "pizza-margherita", size: "size-large", crust: "crust-thick",
          toppings: ["topping-olives"], quantity: 2,
        });

        const cartRes = await fetch(`${server.baseUrl}/v1/cart`, { headers: { Authorization: `Bearer ${tenantAToken}` } });
        const cartBody = (await cartRes.json()) as { items: Array<{ size: string }> };
        assert.equal(cartBody.items.length, 1);
        assert.equal(cartBody.items[0].size, "size-large");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 - GIVEN a valid bearer token with insufficient permissions for a specific operation WHEN
    that operation is attempted THEN the API returns 403 with error code 'FORBIDDEN'.
    ```ts
    test("AC6: a role without permission for an operation gets 403 FORBIDDEN", async () => {
      const server = await startTestServer();
      try {
        const adminToken = await loginAs(server.baseUrl, "admin1");
        const res = await postCartItem(server.baseUrl, adminToken, {
          pizza_id: "pizza-margherita", size: "size-medium", crust: "crust-thin",
          toppings: ["topping-mushroom"], quantity: 1,
        });
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error: { code: string; message: string } };
        assert.equal(body.error.code, "FORBIDDEN");
        assert.ok(body.error.message.length > 0);
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - |
    `POST /v1/auth/login`, `POST /v1/auth/refresh`, and `POST /v1/auth/logout` are exempted from
    the bearer-auth gate even though they live under `/v1/` - they are how a caller obtains/revokes
    a token in the first place, so requiring a bearer token on them would be a chicken-and-egg
    problem. Please confirm this reading of "any /v1/ endpoint" in AC1/AC2, or point to a different
    intended mechanism (e.g. an API key on these three routes specifically).
  - |
    `GET /pizzas/:id` had no authentication at all before this story; moving it under `/v1/` and
    behind the new auth gate is a behaviour change (previously public, now requires a valid bearer
    token) required by AC1's "any /v1/ endpoint" wording. Flag if the pizza catalog was intended to
    stay public.
  - |
    AC6 doesn't specify which operation/role combination needs permission-gating. This plan
    instantiates it as: the `admin` role may authenticate and browse but may not place a pizza-cart
    order (`POST /v1/cart/items`). This was chosen specifically because it's the only
    role/operation pair in the existing domain that can be restricted without contradicting
    STORY-082's already-accepted AC8 (any project member, any role, gets uniform work-item CRUD -
    restricting a role there would be a regression, not a new permission rule). Please confirm this
    instantiation or specify the actual intended permission rule.
  - |
    Tenant assignment reuses STORY-082's existing project-membership grouping exactly:
    `user-customer-1`/`user-admin-1`/`project-apollo` -> `tenant-1`, and `user-provider-1`/
    `project-zephyr` -> `tenant-2`. No new fixture users/projects are introduced.
  - |
    There is no dedicated "list all of tenant A's resources" endpoint in this codebase (work items
    and projects are only fetched one-at-a-time by id). `GET /v1/cart` is the only endpoint that
    returns a list, so it's used as the concrete case for AC5. If a real list endpoint is intended
    elsewhere in the "REST API Surface" epic, AC5 should be re-tested against that endpoint once it
    exists.
  - |
    The new `{ error: { code, message } }` envelope is applied only to the 401 responses from the
    new central auth gate (AC1/AC2) and the new 403 permission-denial response (AC6). Pre-existing
    4xx shapes - 400 validation errors, 404 not-found, 409 conflict, and the STORY-082
    `ProjectAccessDeniedError` 403 (`{ error: string, project_id }`) - are left untouched since no
    AC in this story requires changing them, and workItemCrud.test.ts already asserts their current
    flat shape.
  - |
    AC3 only requires "a 4xx error response" with no specific status code or error code mandated,
    so the existing STORY-082 `ProjectAccessDeniedError` -> 403 (`{ error: string, project_id }`) is
    reused as-is for the tenant-mismatch case rather than introducing a new status/code.
package_dependencies: []
notes: |
  Layering/call-graph for every touched module, plus the existing callers/callees read while
  planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: /v1 prefix + central auth gate)"]
    requestAuth["src/auth/requestAuth.ts (new: resolveAuthContext)"]
    tokenService["src/auth/tokenService.ts (modified: tenantId on payload)"]
    authService["src/auth/authService.ts (modified: issues tenantId)"]
    authController["src/auth/authController.ts (modified: handleGetSession takes AuthContext)"]
    cartController["src/cart/cartController.ts (modified: AuthContext param + admin permission check)"]
    workItemController["src/workitems/workItemController.ts (modified: AuthContext param)"]
    workItemService["src/workitems/workItemService.ts (modified: tenantId threaded into assertAccess)"]
    httpUtils["src/httpUtils.ts (modified: errorEnvelope helper)"]
    testUsers["src/users/fixtures/testUsers.ts (modified: tenantId per user)"]
    projectFixtures["src/projects/projectModel.ts + fixtures/testProjects.ts (modified: tenantId per project)"]
    newTest["test/authAndTenantIsolation.test.ts (new)"]
    existingTests["existing test/*.test.ts (modified: /v1 paths + tenantId literal)"]

    app -->|"resolves caller identity before dispatch"| requestAuth
    requestAuth -->|"verifyAccessToken()"| tokenService
    app -->|"401 UNAUTHORIZED envelope on gate failure"| httpUtils
    app -->|"authContext instead of raw header"| authController
    app -->|"authContext instead of raw header"| cartController
    app -->|"authContext instead of raw header"| workItemController
    authService -->|"issueAccessToken({userId,role,tenantId})"| tokenService
    authService -->|"reads user.tenantId"| testUsers
    cartController -->|"403 FORBIDDEN if role===admin"| httpUtils
    workItemController -->|"authContext.tenantId"| workItemService
    workItemService -->|"project.tenantId check in assertAccess"| projectFixtures
    newTest -->|"drives via fetch()"| app
    existingTests -->|"drives via fetch(), now against /v1 paths"| app

    classDef touched fill:#f96,color:#000
    class app,requestAuth,tokenService,authService,authController,cartController,workItemController,workItemService,httpUtils,testUsers,projectFixtures,newTest,existingTests touched
  ```

  Route dispatch in `src/app.ts` today is a flat set of exact `${method} ${pathname}` string
  comparisons plus a small number of regex path-param matches (`GET /pizzas/:id`,
  `/work-items/:id`, `/projects/:id/work-items`) - this plan keeps that exact style, just with
  every literal/pattern re-prefixed with `/v1`, rather than introducing a router library.
review_focus: |
  In scope: a `/v1` route prefix on every existing endpoint, a centralized bearer-auth gate in
  `app.ts` (replacing the three duplicated per-controller checks) emitting a new
  `{ error: { code, message } }` envelope for 401/403(permission), a `tenantId` on
  users/projects/tokens, an additive tenant check in `WorkItemService.assertAccess`, and one
  concrete AC6 permission rule (`admin` cannot place cart orders). Out of scope: changing the
  shape of pre-existing 400/404/409/403(project-access) error bodies, adding any new list/tenant
  endpoint, and touching STORY-082's `memberUserIds` membership semantics (the tenant check is
  additive via `||`, never a replacement). The riskiest area is the auth-gate placement in
  `app.ts`: it must run before route dispatch for every `/v1/*` path except the three
  token-issuing/revoking routes, and a reviewer should double check the `PUBLIC_ROUTES` exemption
  list is exhaustive and exact-match (not prefix-match) so no protected route is accidentally
  exempted. The `admin`-cannot-order-pizza permission rule and the "`GET /v1/cart` as the AC5 list
  case" choice are both deliberate scope decisions to work around gaps in the existing domain
  (documented in `assumptions_or_open_questions`), not oversights - flag if either should instead
  be redirected to a real endpoint/rule elsewhere in the epic.
