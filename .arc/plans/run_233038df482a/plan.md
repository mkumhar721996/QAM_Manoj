summary: |
  This repo currently has no collection/list endpoint anywhere: every existing GET is a
  single-resource read (`GET /work-items/:id`, `GET /pizzas/:id`, `GET /cart` as a per-user
  singleton, `GET /auth/session`). The only place a real "list of resources filtered by a query"
  naturally exists is work items scoped to a project, which today can only be created
  (`POST /projects/:projectId/work-items`) and read one-at-a-time
  (`GET /work-items/:id`) - there is no way to list a project's work items at all. This plan adds
  that missing endpoint, `GET /projects/:projectId/work-items`, and - since the story is about
  establishing a *convention* for the whole API surface, not just this one endpoint - implements
  the `limit`/`offset` parsing and the `{ total, limit, offset, items }` envelope as a small
  shared, reusable module (`src/pagination.ts`) rather than inline in one controller, so every
  future collection endpoint added to this codebase reuses the same function and gets the
  identical shape "for free" (AC4). The work-item repository/service gain a `findByProjectId` /
  `listWorkItems` read path; `workItemController.ts` gains a `handleListWorkItems` handler that
  parses/validates `limit`/`offset` via the shared module, maps a validation failure to
  `400 VALIDATION_ERROR`, and returns the shared envelope; `app.ts` wires the new `GET` route
  alongside the existing `POST` on the same path.
scope:
  - description: |
      Write the failing acceptance tests first in a new file, covering all 6 ACs against the
      not-yet-existing `GET /projects/:projectId/work-items` route. These must fail
      (404/import errors) before any implementation exists.
    files:
      - test/workItemPagination.test.ts
    rationale: |
      Establishes the test-first contract before any production code exists, matching the
      existing `test/workItemCrud.test.ts` style (raw `fetch` against `startTestServer()`,
      snake_case JSON assertions, one `test()` per AC-labelled behaviour).
  - description: |
      Add a new shared pagination module, independent of any single domain, so every current and
      future collection endpoint calls the same functions and therefore produces the identical
      envelope shape (AC4) and identical validation behaviour (AC3/AC5) by construction rather
      than by convention alone.

      ```ts
      // src/pagination.ts
      export const DEFAULT_LIMIT = 20;
      export const DEFAULT_OFFSET = 0;
      export const MAX_LIMIT = 100;

      export class PaginationValidationError extends Error {}

      export interface PaginationParams {
        limit: number;
        offset: number;
      }

      export function parsePaginationParams(searchParams: URLSearchParams): PaginationParams {
        const rawLimit = searchParams.get("limit");
        const rawOffset = searchParams.get("offset");
        const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
        const offset = rawOffset === null ? DEFAULT_OFFSET : Number(rawOffset);

        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
          throw new PaginationValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
        }
        if (!Number.isInteger(offset) || offset < 0) {
          throw new PaginationValidationError("offset must be a non-negative integer");
        }
        return { limit, offset };
      }

      export function paginateArray<T>(all: T[], limit: number, offset: number): T[] {
        return all.slice(offset, offset + limit);
      }

      export function buildPaginationEnvelope<T>(
        items: T[],
        total: number,
        limit: number,
        offset: number,
      ): { total: number; limit: number; offset: number; items: T[] } {
        return { total, limit, offset, items };
      }
      ```
    files:
      - src/pagination.ts
    rationale: |
      Centralising parsing/validation/envelope-building in one module - rather than repeating it
      per controller - is what makes AC4 ("no endpoint uses a different field name or structure")
      true by construction: there is only one place that can produce this shape.
  - description: |
      Add a project-scoped read path to `WorkItemRepository` and `WorkItemService`. The repository
      returns the full (unpaginated, deterministically ordered) list for a project; pagination
      slicing happens one layer up via the shared `src/pagination.ts`, keeping the repository a
      dumb store like its existing methods.

      ```ts
      // src/workitems/workItemRepository.ts (add method)
      findByProjectId(projectId: string): WorkItem[] {
        return [...this.itemsById.values()]
          .filter((item) => item.projectId === projectId)
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      }
      ```

      ```ts
      // src/workitems/workItemService.ts (add method)
      listWorkItems(projectId: string, userId: string): WorkItem[] {
        const project = this.assertAccess(this.projectRepository.findById(projectId), projectId, userId);
        return this.workItemRepository.findByProjectId(project.id);
      }
      ```
    files:
      - src/workitems/workItemRepository.ts
      - src/workitems/workItemService.ts
    rationale: |
      Reuses the existing `assertAccess` helper so listing gets the same project-existence/
      membership checks (404/403) as create/read/update/delete, instead of re-implementing access
      control for the new read path.
  - description: |
      Add `handleListWorkItems` to `workItemController.ts`: authenticates via the existing
      `extractBearerPayload`, parses/validates pagination via `src/pagination.ts`, maps a
      `PaginationValidationError` to `400 VALIDATION_ERROR`, calls `WorkItemService.listWorkItems`,
      slices the page, and serializes it through the existing `serializeWorkItem`.

      ```ts
      // src/workitems/workItemController.ts (add)
      export function handleListWorkItems(
        workItemService: WorkItemService,
        authorizationHeader: string | undefined,
        projectId: string,
        searchParams: URLSearchParams,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) {
          return { status: 401, body: { error: "missing or invalid authorization" } };
        }

        let pagination: PaginationParams;
        try {
          pagination = parsePaginationParams(searchParams);
        } catch (err) {
          if (err instanceof PaginationValidationError) {
            return { status: 400, body: { error_code: "VALIDATION_ERROR", message: err.message } };
          }
          throw err;
        }

        try {
          const allItems = workItemService.listWorkItems(projectId, payload.userId);
          const page = paginateArray(allItems, pagination.limit, pagination.offset);
          return {
            status: 200,
            body: buildPaginationEnvelope(page.map(serializeWorkItem), allItems.length, pagination.limit, pagination.offset),
          };
        } catch (err) {
          if (err instanceof ProjectNotFoundError) {
            return { status: 404, body: { error: err.message, project_id: projectId } };
          }
          if (err instanceof ProjectAccessDeniedError) {
            return { status: 403, body: { error: err.message, project_id: projectId } };
          }
          throw err;
        }
      }
      ```
    files:
      - src/workitems/workItemController.ts
    rationale: |
      Mirrors the error-mapping pattern already used by `handleCreateWorkItem` (typed service
      errors -> status codes) and keeps the pagination-specific validation error mapping isolated
      to this one handler rather than adding a new branch to the shared catch-all in `app.ts`.
  - description: |
      Wire `GET /projects/:projectId/work-items` into `src/app.ts`, reusing the existing
      `createWorkItemMatch` regex (already matches this exact path for the `POST` route) with a
      `GET` method check, placed alongside the other body-less GET routes so it returns before the
      `readJsonBody`/allow-list gate.

      ```ts
      // src/app.ts (inside handleRequest, near the other early GET matches)
      if (method === "GET" && createWorkItemMatch) {
        const result = handleListWorkItems(workItemService, req.headers.authorization, createWorkItemMatch[1], url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      ```

      Note `createWorkItemMatch` is currently computed further down in `handleRequest` (used only
      for the `POST` branch); it must be hoisted above this new early-return block so both the new
      `GET` check and the existing `POST` check can reference it.
    files:
      - src/app.ts
    rationale: |
      Follows the existing precedent of one regex match reused for multiple methods on the same
      path (`workItemMatch` is already reused for both `GET` and `DELETE /work-items/:id`) rather
      than introducing a router library or duplicating the regex.
tests:
  - |
    AC1 - GIVEN a collection endpoint WHEN called with `limit` and `offset` THEN the envelope
    contains `total`, `limit`, `offset`, `items`.
    ```ts
    test("AC1: listing work items with limit/offset returns the full pagination envelope", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "One" });
        await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Two" });

        const res = await listWorkItems(server.baseUrl, token, "project-apollo", { limit: 1, offset: 0 });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { total: number; limit: number; offset: number; items: unknown[] };
        assert.deepEqual(Object.keys(body).sort(), ["items", "limit", "offset", "total"]);
        assert.equal(body.limit, 1);
        assert.equal(body.offset, 0);
        assert.equal(body.total, 2);
        assert.equal(body.items.length, 1);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - GIVEN a collection endpoint called without `limit`/`offset` THEN the envelope's
    `limit`/`offset` reflect the applied defaults.
    ```ts
    test("AC2: listing without limit/offset applies the default values", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Only one" });

        const res = await listWorkItems(server.baseUrl, token, "project-apollo", {});
        assert.equal(res.status, 200);
        const body = (await res.json()) as { limit: number; offset: number };
        assert.equal(body.limit, DEFAULT_LIMIT);
        assert.equal(body.offset, DEFAULT_OFFSET);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN a `limit` exceeding the maximum allowed THEN 400 with `error_code`
    `VALIDATION_ERROR` and a message indicating the allowed range.
    ```ts
    test("AC3: a limit above the maximum is rejected with VALIDATION_ERROR", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await listWorkItems(server.baseUrl, token, "project-apollo", { limit: MAX_LIMIT + 1 });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error_code: string; message: string };
        assert.equal(body.error_code, "VALIDATION_ERROR");
        assert.match(body.message, new RegExp(String(MAX_LIMIT)));
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN all collection endpoints WHEN compared THEN the envelope shape is identical - no
    endpoint uses a different field name or structure. Operationalised as: the shared envelope
    builder always produces exactly these four keys, and the (only) collection endpoint in this
    codebase returns exactly that shape with no extra/renamed fields.
    ```ts
    test("AC4: buildPaginationEnvelope always produces the same four-key shape", () => {
      const envelope = buildPaginationEnvelope(["x"], 5, 10, 0);
      assert.deepEqual(Object.keys(envelope).sort(), ["items", "limit", "offset", "total"]);
    });

    test("AC4: the work-items collection endpoint response has exactly the canonical envelope keys", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await listWorkItems(server.baseUrl, token, "project-apollo", {});
        const body = (await res.json()) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ["items", "limit", "offset", "total"]);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 - GIVEN a `limit` equal to the maximum allowed THEN 200 with the envelope's `limit` set to
    that value.
    ```ts
    test("AC5: a limit exactly at the maximum is accepted", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await listWorkItems(server.baseUrl, token, "project-apollo", { limit: MAX_LIMIT });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { limit: number };
        assert.equal(body.limit, MAX_LIMIT);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 - GIVEN an `offset` greater than the total matching records THEN 200 with an empty `items`
    array and `total` reflecting the actual count.
    ```ts
    test("AC6: an offset past the end returns an empty items array and the real total", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Only one" });

        const res = await listWorkItems(server.baseUrl, token, "project-apollo", { offset: 50 });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { total: number; items: unknown[] };
        assert.equal(body.total, 1);
        assert.deepEqual(body.items, []);
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - |
    No collection/list endpoint exists anywhere in the current codebase - every existing GET is a
    single-resource or per-user-singleton read. This plan therefore introduces the first one,
    `GET /projects/:projectId/work-items`, as the natural missing complement to the existing
    work-item CRUD, and builds `src/pagination.ts` as a shared module so AC4 ("identical across
    all collection endpoints") holds by construction for this and any future collection endpoint.
    Please flag if a different or additional existing GET was actually intended as "the" collection
    endpoint(s) this story should retrofit.
  - |
    `GET /cart` (a per-authenticated-user singleton cart with an `items` array) was deliberately
    NOT treated as a collection endpoint and NOT retrofitted with `limit`/`offset`: it has no
    query/filter semantics (there is exactly one cart per caller, not a searchable set), and
    retrofitting it would change the response shape `test/cartCustomisation.test.ts` already
    asserts on. Flag if the reviewer wants it included in this story instead.
  - |
    Defaults/limits are not specified by the ACs, so this plan picks `DEFAULT_LIMIT = 20`,
    `DEFAULT_OFFSET = 0`, `MAX_LIMIT = 100`. Please confirm or provide the actual intended values.
  - |
    The `{ error_code, message }` shape used for the AC3 validation error is new to this codebase
    (every existing error response uses `{ error: "..." }`). It is introduced only for this new
    validation error, exactly as AC3 specifies, and is NOT retrofitted onto any existing error
    response in this plan - a codebase-wide error-envelope migration would be a separate, larger
    change. Flag if that migration was actually intended as part of this story.
  - |
    A non-integer or negative `offset`, and a non-integer, zero, or negative `limit`, are all
    treated as validation errors (400 `VALIDATION_ERROR`) via the same `parsePaginationParams`
    path as an over-the-max `limit`, since the ACs only explicitly cover the over-max case but a
    consistent validation convention implies the rest of the invalid-input space should be
    rejected the same way rather than silently coerced.
  - |
    Work items within a project are ordered deterministically by `createdAt` ascending (tie-broken
    by `id`) for stable offset-based pagination, since no ordering is specified by the ACs.
package_dependencies: []
notes: |
  Layering/call-graph for the touched and newly-added modules, plus the existing modules they plug
  into (all read while planning):

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: new GET route)"]
    workItemController["src/workitems/workItemController.ts (modified: handleListWorkItems)"]
    workItemService["src/workitems/workItemService.ts (modified: listWorkItems)"]
    workItemRepository["src/workitems/workItemRepository.ts (modified: findByProjectId)"]
    pagination["src/pagination.ts (new, shared)"]
    projectRepository["src/projects/projectRepository.ts (existing, untouched)"]
    tokenService["src/auth/tokenService.ts (existing, untouched)"]
    testFile["test/workItemPagination.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes GET /projects/:id/work-items"| workItemController
    workItemController -->|"verifyAccessToken() to identify caller"| tokenService
    workItemController -->|"parsePaginationParams(), paginateArray(), buildPaginationEnvelope()"| pagination
    workItemController -->|"listWorkItems()"| workItemService
    workItemService -->|"assertAccess() reuses existing project checks"| projectRepository
    workItemService -->|"findByProjectId()"| workItemRepository
    testFile -->|"drives via fetch()"| app
    testFile -->|"startTestServer()"| testServer
    testFile -->|"unit-tests buildPaginationEnvelope() directly"| pagination

    classDef touched fill:#f96,color:#000
    class app,workItemController,workItemService,workItemRepository,pagination,testFile touched
  ```

  Route dispatch in `src/app.ts` is a flat set of exact `${method} ${pathname}` string comparisons
  plus a few regex path-param matches (`workItemMatch`, `createWorkItemMatch`). This plan reuses
  the existing `createWorkItemMatch` regex for a second method (`GET`) rather than adding a new
  regex, following the same reuse-for-multiple-methods precedent already established by
  `workItemMatch` (used for both `GET` and `DELETE /work-items/:id`).
review_focus: |
  In scope: a new shared `src/pagination.ts` module (parsing/validation/envelope-building) and
  exactly one new endpoint, `GET /projects/:projectId/work-items`, that uses it. Out of scope:
  retrofitting `GET /cart` or any other existing endpoint, and any change to existing error
  response shapes beyond the new `VALIDATION_ERROR` case. The riskiest area is AC4 ("identical
  envelope shape across all collection endpoints"): since this codebase only has one real
  collection endpoint today, that guarantee is enforced by construction (single shared builder
  function) rather than by literally diffing two live endpoints - a reviewer should not expect a
  second existing endpoint to have been changed to prove this. Also note the deliberate choice to
  reject non-integer/negative `offset` and out-of-range `limit` through the same
  `PaginationValidationError` path, even though only the over-max case is explicitly named in the
  ACs.
