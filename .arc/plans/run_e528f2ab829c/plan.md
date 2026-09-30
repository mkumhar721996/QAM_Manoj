summary: |
  This repo's only "task management" endpoints (per the parent REST API Surface epic) are the work-item
  CRUD routes added in STORY-082: `POST /projects/:projectId/work-items`, `GET /work-items/:id`,
  `PATCH /work-items/:id`, `DELETE /work-items/:id`, all dispatched from a flat `${method} ${pathname}`
  matcher in `src/app.ts`. Auth (`/auth/*`), cart (`/cart*`), and pizza (`/pizzas/:id`) routes belong to
  separate stories/epics (Login & Session Management, Pizza Customisation) and are explicitly NOT
  "task management" endpoints, so they stay unprefixed and untouched by this plan. This plan enforces a
  `/v1/` prefix on the four work-item routes only: a new tiny, route-agnostic `stripV1Prefix` helper
  (`src/routing.ts`) turns a request path into either `null` (no `/v1` prefix present) or the remainder
  after stripping it, and `src/app.ts`'s two existing work-item route regexes are changed to match
  against that stripped remainder instead of the raw pathname. Because the helper is generic (it knows
  nothing about `/work-items` or `/projects` specifically), any current or future route pattern matched
  against its output is automatically gated behind `/v1/` by construction - satisfying AC3's "any new
  endpoint is only reachable under a `/v1`-prefixed path" without inventing a full router. Omitting the
  prefix on today's four routes now falls through to the existing 404 handler (AC2); using the prefix
  preserves every existing success behaviour unchanged (AC1). No multi-version support or content
  negotiation is added, matching the story description.
scope:
  - description: |
      Write the failing tests first, in two places:

      1. Update the four HTTP helper functions in `test/workItemCrud.test.ts` to target `/v1`-prefixed
         paths. Since `src/app.ts` doesn't understand `/v1` yet, every one of that file's 14 existing
         AC tests will fail (404) until the implementation lands - this is the AC1 regression net.
      2. Add a new `test/urlVersioning.test.ts` covering this story's three ACs directly: an AC1 test
         that all four routes succeed under `/v1`, an AC2 test that all four routes 404 without it, and
         an AC3 test that exercises the routing helper generically (including a path pattern that does
         not correspond to any route implemented today) to prove the gate is prefix-based, not a
         per-route allow-list.

      Before any implementation change, both files fail: the CRUD suite 404s on every request, and the
      new file's AC1 assertions fail (404 instead of 2xx) while its AC2 assertions already pass
      incidentally (nothing to un-do yet) and its AC3 assertions fail because `src/routing.ts` doesn't
      exist.
    files:
      - test/workItemCrud.test.ts
      - test/urlVersioning.test.ts
    rationale: |
      Matches the existing test-first convention in this repo (raw `fetch` against `startTestServer()`,
      one `test()` per AC-labelled behaviour, see `test/workItemCrud.test.ts` itself). Reusing the
      existing CRUD suite as the AC1 regression net avoids duplicating 14 tests' worth of setup, while
      the new file makes this story's three ACs individually greppable and reviewable on their own.
  - description: |
      Add `src/routing.ts`: a small, pure, route-agnostic helper that turns a raw pathname into either
      `null` (no `/v1` prefix) or the path remainder after the prefix. This is the single mechanism both
      today's work-item routes and any future task-management route must be matched through.

      ```ts
      // src/routing.ts
      export const API_VERSION_PREFIX = "/v1";

      export function stripV1Prefix(pathname: string): string | null {
        if (pathname === API_VERSION_PREFIX) {
          return "/";
        }
        if (pathname.startsWith(`${API_VERSION_PREFIX}/`)) {
          return pathname.slice(API_VERSION_PREFIX.length);
        }
        return null;
      }
      ```
    files:
      - src/routing.ts
    rationale: |
      Extracting this as a standalone, unit-testable pure function (rather than inlining a regex in
      `app.ts`) is what makes AC3 testable at all: a test can assert the gate's behaviour for an
      arbitrary/hypothetical path (one that doesn't match any route implemented today) without needing
      to actually add a new endpoint to prove the convention holds going forward.
  - description: |
      Wire the gate into `src/app.ts`'s existing dispatcher. Compute the stripped path once per request,
      then change the two work-item route regexes (currently matched against `url.pathname`) to match
      against the stripped result instead, only when it is non-null. No other line in `handleRequest`
      changes: the existing "route not in allow-list -> 404" fallback, the auth/cart/pizza routes, and
      the create/update body-handling flow are all untouched and stay unprefixed.

      Before (`src/app.ts`, inside `handleRequest`):
      ```ts
      const workItemMatch = url.pathname.match(/^\/work-items\/([^/]+)$/);
      ...
      const createWorkItemMatch = url.pathname.match(/^\/projects\/([^/]+)\/work-items$/);
      ```

      After:
      ```ts
      import { stripV1Prefix } from "./routing.ts";
      ...
      const v1Path = stripV1Prefix(url.pathname);
      ...
      const workItemMatch = v1Path !== null ? v1Path.match(/^\/work-items\/([^/]+)$/) : null;
      ...
      const createWorkItemMatch = v1Path !== null ? v1Path.match(/^\/projects\/([^/]+)\/work-items$/) : null;
      ```
    files:
      - src/app.ts
    rationale: |
      `workItemMatch`/`createWorkItemMatch` already gate every branch that reads, creates, updates, or
      deletes a work item (see the existing `isCreateWorkItem`/`isUpdateWorkItem` derivations and the
      404 allow-list check right after them) - forcing them to `null` whenever `/v1` is absent makes
      every one of those branches naturally fall through to the pre-existing "not found" response with
      no other line of routing logic touched. This is the minimal change that satisfies AC1 (prefixed
      paths behave exactly as before) and AC2 (unprefixed paths now 404) at once.
tests:
  - |
    AC1 - GIVEN any task management endpoint WHEN a caller sends a correctly authenticated request to
    its `/v1/`-prefixed path THEN the API responds with the expected success status and payload.
    ```ts
    test("AC1: all task management endpoints respond successfully under their /v1 prefixed path", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");

        const createRes = await fetch(`${server.baseUrl}/v1/projects/project-apollo/work-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: "TASK", title: "Versioned create" }),
        });
        assert.equal(createRes.status, 201);
        const created = (await createRes.json()) as { id: string };

        const getRes = await fetch(`${server.baseUrl}/v1/work-items/${created.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(getRes.status, 200);

        const patchRes = await fetch(`${server.baseUrl}/v1/work-items/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: "Updated" }),
        });
        assert.equal(patchRes.status, 200);

        const deleteRes = await fetch(`${server.baseUrl}/v1/work-items/${created.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(deleteRes.status, 204);
      } finally {
        await server.close();
      }
    });
    ```
    Additionally, updating `test/workItemCrud.test.ts`'s helpers to use `/v1` paths means all 14 of
    that file's existing AC tests double as an AC1 regression net (full payload/status parity, not just
    the bare-minimum assertions above).
  - |
    AC2 - GIVEN a correctly authenticated request to a task management endpoint WHEN the `/v1/` prefix
    is omitted THEN the API returns 404.
    ```ts
    test("AC2: omitting the /v1 prefix returns 404 for every task management endpoint", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");

        const createRes = await fetch(`${server.baseUrl}/projects/project-apollo/work-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: "TASK", title: "Unversioned create" }),
        });
        assert.equal(createRes.status, 404);

        const getRes = await fetch(`${server.baseUrl}/work-items/APOLLO-TASK-001`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(getRes.status, 404);

        const patchRes = await fetch(`${server.baseUrl}/work-items/APOLLO-TASK-001`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: "nope" }),
        });
        assert.equal(patchRes.status, 404);

        const deleteRes = await fetch(`${server.baseUrl}/work-items/APOLLO-TASK-001`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(deleteRes.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN any new endpoint added to the API WHEN it is registered THEN it is only reachable under
    a `/v1/`-prefixed path. Tested at the routing-gate level (unit test, no server needed) so the
    guarantee covers paths that don't correspond to any route implemented today, not just the four
    current ones.
    ```ts
    import { stripV1Prefix } from "../src/routing.ts";

    test("AC3: the v1 prefix gate is route-agnostic, so any future task management path is only reachable under /v1", () => {
      assert.equal(stripV1Prefix("/work-items/APOLLO-TASK-001"), null);
      assert.equal(stripV1Prefix("/projects/project-apollo/work-items"), null);
      assert.equal(stripV1Prefix("/v1/work-items/APOLLO-TASK-001"), "/work-items/APOLLO-TASK-001");
      assert.equal(stripV1Prefix("/v1/projects/project-apollo/work-items"), "/projects/project-apollo/work-items");

      // a hypothetical future sub-resource that doesn't exist yet - still gated identically
      assert.equal(stripV1Prefix("/work-items/APOLLO-TASK-001/comments"), null);
      assert.equal(stripV1Prefix("/v1/work-items/APOLLO-TASK-001/comments"), "/work-items/APOLLO-TASK-001/comments");
    });
    ```
assumptions_or_open_questions:
  - |
    "Task management endpoint" is scoped to exactly the four work-item CRUD routes added in STORY-082
    (`POST /projects/:id/work-items`, `GET/PATCH/DELETE /work-items/:id`) - the only routes belonging to
    this epic's domain. `/auth/*`, `/cart*`, and `/pizzas/:id` belong to separate stories/epics (Login &
    Session Management, Pizza Customisation) and are deliberately left unprefixed and untouched. Please
    flag if the epic intends the `/v1/` convention to apply repo-wide immediately rather than being
    introduced scoped-to-task-management first.
  - |
    No redirect, deprecation warning, or dual-routing period for the old unprefixed work-item paths is
    added - they simply 404 going forward, per the story description's "without requiring multi-version
    support." If existing external callers depend on the unprefixed paths, a transition period would be
    a separate, explicitly-scoped follow-up.
  - |
    AC3 is verified structurally (a route-agnostic unit test on the prefix-stripping gate) rather than by
    adding a literal new endpoint, since no new endpoint is otherwise in scope for this story. The
    enforced convention going forward is: any future task-management route regex must be matched against
    `stripV1Prefix(url.pathname)`'s result (not `url.pathname` directly) to inherit the guarantee -
    documented here for whoever adds the next task-management route.
package_dependencies: []
notes: |
  Call-graph for the touched/new modules, plus their real existing callers/callees:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: v1 gate wired into work-item route matching)"]
    routing["src/routing.ts (new: stripV1Prefix)"]
    workItemController["src/workitems/workItemController.ts (existing, untouched)"]
    crudTest["test/workItemCrud.test.ts (modified: helpers use /v1 paths)"]
    versioningTest["test/urlVersioning.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"stripV1Prefix(url.pathname) gates workItemMatch/createWorkItemMatch"| routing
    app -->|"unchanged: handleCreateWorkItem/GetWorkItem/UpdateWorkItem/DeleteWorkItem"| workItemController
    crudTest -->|"drives via fetch() against /v1 paths"| app
    crudTest -->|"startTestServer()"| testServer
    versioningTest -->|"drives via fetch() for AC1/AC2"| app
    versioningTest -->|"imports stripV1Prefix directly for AC3"| routing
    versioningTest -->|"startTestServer()"| testServer

    classDef touched fill:#f96,color:#000
    class app,routing,crudTest,versioningTest touched
  ```

  Route dispatch in `src/app.ts` is a flat set of `${method} ${pathname}` comparisons plus two existing
  regex path-param matches (`workItemMatch`, `createWorkItemMatch`) - this plan does not introduce a
  router library or restructure that dispatcher; it only changes what those two regexes are matched
  against, which is the smallest change that makes the four work-item routes prefix-gated without
  touching any auth/cart/pizza route.
review_focus: |
  In scope: gating the four existing work-item routes behind `/v1/` via a new, generic `stripV1Prefix`
  helper, with the old unprefixed paths now 404ing. Out of scope, deliberately: `/auth/*`, `/cart*`, and
  `/pizzas/:id` stay unprefixed - they belong to different stories/epics, not "task management." The
  riskiest spot is the two-line change in `src/app.ts` (`workItemMatch`/`createWorkItemMatch` now
  matched against `v1Path` instead of `url.pathname`) - verify no other branch in `handleRequest` still
  references `url.pathname` for work-item matching (it shouldn't, per the file as read), since a missed
  spot would silently leave one route unprefixed. Also worth confirming: AC3 is satisfied structurally
  (a route-agnostic gate + a unit test proving it holds for a hypothetical future path) rather than by
  adding a literal new endpoint in this story - that's a deliberate interpretation, not an oversight.
