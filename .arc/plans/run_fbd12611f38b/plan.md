summary: |
  Introduce a single shared error-envelope shape — `{ error_code, message, details }` — and route
  every failure response in the app (validation, not-found, auth, conflict, payload-too-large,
  and unexpected server faults) through it, so callers can branch on `error_code` instead of
  parsing prose. Today each controller in src/auth, src/cart, and src/workitems builds its own
  ad-hoc `{ error: "..." }` (sometimes with extra top-level fields like `project_id` or
  `blocking_ids`) and src/app.ts's catch-all collapses every uncaught exception — JSON parse
  failures and genuine bugs alike — into a 400. This plan adds one shared module
  (`src/errors/errorEnvelope.ts`) with the envelope constructor and a fixed set of error codes,
  updates every existing error-returning branch to use it, fixes the catch-all in src/app.ts to
  distinguish a bad JSON body (400 VALIDATION_ERROR) from a genuinely unexpected fault
  (500 INTERNAL_ERROR, message only, no stack/detail leak), and updates the two existing tests
  that assert the old `{ error }` field so the suite stays green under the new shape.
scope:
  - description: |
      Add the shared envelope module: the canonical error codes and the constructor every
      controller/catch-all will call.

      New file `src/errors/errorEnvelope.ts`:
      ```ts
      export const ERROR_CODES = {
        VALIDATION_ERROR: "VALIDATION_ERROR",
        UNAUTHORIZED: "UNAUTHORIZED",
        FORBIDDEN: "FORBIDDEN",
        NOT_FOUND: "NOT_FOUND",
        CONFLICT: "CONFLICT",
        PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
        INTERNAL_ERROR: "INTERNAL_ERROR",
      } as const;

      export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

      export interface ErrorEnvelope {
        error_code: string;
        message: string;
        details: Record<string, unknown>;
      }

      export function errorEnvelope(
        errorCode: ErrorCode | string,
        message: string,
        details: Record<string, unknown> = {},
      ): ErrorEnvelope {
        return { error_code: errorCode, message, details };
      }
      ```
      `details` is always present (defaulting to `{}`) rather than optional, specifically so the
      envelope's field set never varies between endpoints (AC6) while still letting individual
      call sites attach context like `project_id` or `blocking_ids` without adding a new
      top-level field.
    files:
      - src/errors/errorEnvelope.ts
    rationale: |
      Centralising the shape in one function is what makes AC6 ("identical shape across all
      endpoints") enforceable — every call site produces the same three keys, and a future new
      failure mode (AC7) automatically inherits the shape by calling this same function instead
      of hand-rolling a body.
  - description: |
      Distinguish "bad JSON body" from "genuinely unexpected fault" in httpUtils so app.ts's
      catch-all can map them to different codes/statuses. Add a dedicated error class and throw
      it instead of a bare `Error` on parse failure.

      In `src/httpUtils.ts`, change:
      ```ts
      } catch {
        reject(new Error("Invalid JSON body"));
      }
      ```
      to:
      ```ts
      } catch {
        reject(new InvalidJsonBodyError());
      }
      ```
      with a new exported class alongside the existing `PayloadTooLargeError`:
      ```ts
      export class InvalidJsonBodyError extends Error {
        constructor() {
          super("Request body must be valid JSON");
        }
      }
      ```
    files:
      - src/httpUtils.ts
    rationale: |
      Today `readJsonBody`'s parse failure and every other uncaught exception both land in
      app.ts's single `catch` block and both get turned into a 400 — that's actually wrong for
      AC4/AC5: a malformed body is a client validation error (400), but an uncaught exception
      from deeper in the stack (e.g. a repository throwing) is a server fault and must become a
      500 without leaking its message. A distinguishable error class is the minimal way to tell
      the two apart in the catch-all without touching every caller of readJsonBody.
  - description: |
      Fix src/app.ts's routing catch-all and top-level catch block to emit the envelope, and to
      correctly separate the three failure kinds it currently conflates.

      Replace the unmatched-route branch:
      ```ts
      sendJson(res, 404, { error: "not found" });
      ```
      with:
      ```ts
      sendJson(res, 404, errorEnvelope(ERROR_CODES.NOT_FOUND, "not found"));
      ```

      Replace the top-level catch block:
      ```ts
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendJson(res, 413, { error: err.message });
          return;
        }
        console.error(`unhandled error for ${route}:`, err);
        sendJson(res, 400, { error: "invalid request" });
      }
      ```
      with:
      ```ts
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendJson(res, 413, errorEnvelope(ERROR_CODES.PAYLOAD_TOO_LARGE, err.message));
          return;
        }
        if (err instanceof InvalidJsonBodyError) {
          sendJson(res, 400, errorEnvelope(ERROR_CODES.VALIDATION_ERROR, err.message));
          return;
        }
        console.error(`unhandled error for ${route}:`, err);
        sendJson(res, 500, errorEnvelope(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred"));
      }
      ```
      Add the two new imports (`errorEnvelope`, `ERROR_CODES` from `./errors/errorEnvelope.ts`;
      `InvalidJsonBodyError` from `./httpUtils.ts`).
    files:
      - src/app.ts
    rationale: |
      This is the single place AC4/AC5 actually get enforced: any exception a controller doesn't
      already catch (a real bug, a repository fault) must surface as 500/INTERNAL_ERROR with a
      generic message — never the raw `err.message`/stack — while a malformed request body must
      still surface as 400/VALIDATION_ERROR. Today both collapse into the same 400, which is the
      core defect this story fixes at the framework level.
  - description: |
      Convert every existing error-returning branch in the auth controller to the envelope.

      In `src/auth/authController.ts`:
      - `handleLogin`: `{ error: "username and password are required" }` (400) ->
        `errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "username and password are required")`;
        the `InvalidCredentialsError` branch (401) ->
        `errorEnvelope(ERROR_CODES.UNAUTHORIZED, err.message)`.
      - `handleRefresh`: missing-token 400 -> VALIDATION_ERROR; `InvalidRefreshTokenError` 401 ->
        UNAUTHORIZED.
      - `handleLogout`: missing-token 400 -> VALIDATION_ERROR.
      - `handleGetSession`: both 401 branches (missing header, invalid/expired token) ->
        UNAUTHORIZED.
    files:
      - src/auth/authController.ts
    rationale: |
      These are the endpoints AC3's "unauthenticated request" scenario exercises directly, and
      AC1's "invalid input" scenario for login/refresh/logout.
  - description: |
      Convert every existing error-returning branch in the cart controller to the envelope.

      In `src/cart/cartController.ts`:
      - `handleGetPizza`: pizza-not-found 404 -> `errorEnvelope(ERROR_CODES.NOT_FOUND, "pizza not found")`.
      - `handleAddToCart`: missing/invalid auth 401 -> UNAUTHORIZED; invalid payload 400 ->
        VALIDATION_ERROR; `PizzaNotFoundError` 404 -> NOT_FOUND; `InvalidCustomisationError` 400
        -> VALIDATION_ERROR.
      - `handleGetCart`: missing/invalid auth 401 -> UNAUTHORIZED.
    files:
      - src/cart/cartController.ts
    rationale: |
      Covers AC1 (invalid pizza customisation, already exercised by
      test/cartCustomisation.test.ts) and AC2/AC3 for the pizza/cart surface.
  - description: |
      Convert every existing error-returning branch in the work item controller to the envelope,
      moving the extra identifying fields each branch currently returns at the top level
      (`project_id`, `blocking_ids`) into `details` so the envelope shape stays identical across
      branches per AC6.

      In `src/workitems/workItemController.ts`:
      - Every `401` (missing/invalid auth, all four handlers) -> UNAUTHORIZED.
      - `handleCreateWorkItem`: invalid payload 400 -> VALIDATION_ERROR;
        `ProjectNotFoundError` 404 -> `errorEnvelope(ERROR_CODES.NOT_FOUND, err.message, { project_id: projectId })`;
        `ProjectAccessDeniedError` 403 -> `errorEnvelope(ERROR_CODES.FORBIDDEN, err.message, { project_id: projectId })`;
        `SequenceCapacityExceededError` 409 -> `errorEnvelope(ERROR_CODES.CONFLICT, err.message)`.
      - `handleGetWorkItem`: item-not-found 404 -> NOT_FOUND; `ProjectAccessDeniedError` 403 ->
        FORBIDDEN.
      - `handleUpdateWorkItem`: invalid payload 400 -> VALIDATION_ERROR; `ProjectAccessDeniedError`
        403 -> FORBIDDEN. (The existing "update a non-existent work item returns 200 with
        `work_item: null`" behaviour, asserted by
        test/workItemCrud.test.ts:248-251, is pre-existing product behaviour from
        QAM-MANOJ-STORY-082, not a failure response, and is intentionally left untouched by this
        story — see assumptions.)
      - `handleDeleteWorkItem`: `WorkItemNotFoundError` 404 -> NOT_FOUND;
        `ProjectAccessDeniedError` 403 -> FORBIDDEN;
        `BlockingDependentsError` 409 -> `errorEnvelope(ERROR_CODES.CONFLICT, err.message, { blocking_ids: err.blockingIds })`.
    files:
      - src/workitems/workItemController.ts
    rationale: |
      This handler set is where every non-2xx status the app currently produces shows up (400,
      401, 403, 404, 409), so it's the main proving ground for AC1-AC3, AC6, and AC7 (409 is the
      "status not explicitly covered by AC1-4" case).
  - description: |
      Add a new end-to-end test file exercising the envelope across every endpoint and failure
      kind, including a deliberately faulty repository to force an uncaught exception for
      AC4/AC5.

      New file `test/errorEnvelope.test.ts`. Shared assertion helper:
      ```ts
      function assertEnvelopeShape(body: Record<string, unknown>, expectedCode: string): void {
        assert.deepEqual(Object.keys(body).sort(), ["details", "error_code", "message"]);
        assert.equal(body.error_code, expectedCode);
        assert.equal(typeof body.message, "string");
        assert.equal(typeof body.details, "object");
      }
      ```
      A faulty repository to trigger AC4/AC5, defined in the same file:
      ```ts
      class FaultyWorkItemRepository extends WorkItemRepository {
        findById(): WorkItem | undefined {
          throw new Error("db connection reset by peer at 10.0.4.12:5432");
        }
      }
      ```
      used via `startTestServer({ workItemRepository: new FaultyWorkItemRepository() })`, then
      calling `GET /work-items/APOLLO-TASK-001` (any id — `findById` throws regardless) with a
      valid bearer token.
    files:
      - test/errorEnvelope.test.ts
    rationale: |
      No existing test currently forces an uncaught, non-domain exception through the stack, so
      AC4/AC5 have no coverage today; subclassing a real repository and overriding one method is
      the smallest fault injection that reuses `AppDependencies` exactly as `test/testServer.ts`
      already supports it.
  - description: |
      Update the two existing tests that assert the old `{ error: "..." }` field so the suite
      stays green under the new envelope; the human-readable text itself is unchanged, only the
      field name.

      In `test/login.test.ts` (both occurrences, lines ~39-40, ~55-56, ~126-127):
      ```ts
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "Invalid username or password");
      ```
      becomes:
      ```ts
      const body = (await res.json()) as { error_code: string; message: string };
      assert.equal(body.error_code, "UNAUTHORIZED");
      assert.equal(body.message, "Invalid username or password");
      ```
      In `test/refresh.test.ts` (line ~62-63), the same substitution with
      `"Invalid or expired refresh token"`.
    files:
      - test/login.test.ts
      - test/refresh.test.ts
    rationale: |
      These are the only two spots in the existing suite that assert on the pre-envelope
      `{ error }` field (confirmed by grepping `test/` for `.error` / `body.error`); every other
      existing test only asserts `res.status`, so nothing else needs to change for the suite to
      stay green.
tests:
  - "AC1 (validation -> 400 + VALIDATION_ERROR): POST /projects/project-apollo/work-items with an empty `title` returns `assert.equal(res.status, 400)` and `assertEnvelopeShape(body, \"VALIDATION_ERROR\")`; also cover POST /cart/items with `size: \"size-xxl\"` the same way, reusing the existing scenario in test/cartCustomisation.test.ts:37-54 but adding the envelope-shape assertion."
  - "AC2 (not found -> 404 + NOT_FOUND): GET /work-items/APOLLO-TASK-999 (nonexistent) and GET /pizzas/does-not-exist both assert `assert.equal(res.status, 404)` and `assertEnvelopeShape(body, \"NOT_FOUND\")`."
  - "AC3 (unauthenticated/unauthorized -> 401/403): GET /work-items/:id with no Authorization header asserts `assert.equal(res.status, 401)` and `assertEnvelopeShape(body, \"UNAUTHORIZED\")`; GET /work-items/:id as a token belonging to a user with no project access (mirroring the existing outsider-token scenario at test/workItemCrud.test.ts:225) asserts `assert.equal(res.status, 403)` and `assertEnvelopeShape(body, \"FORBIDDEN\")`."
  - "AC4 (server fault -> 500 + INTERNAL_ERROR): using `FaultyWorkItemRepository`, `assert.equal(res.status, 500)` and `assertEnvelopeShape(body, \"INTERNAL_ERROR\")`."
  - "AC5 (no internal detail leak): on the same faulty-repository response, `assert.equal(body.message, \"An unexpected error occurred\")` and `assert.ok(!JSON.stringify(body).includes(\"10.0.4.12\"))` (the injected fault's connection detail must not appear anywhere in the serialized body) and `assert.equal(Object.hasOwn(body, \"stack\"), false)`."
  - "AC6 (identical shape everywhere): collect one error body each from the AC1 (400), AC2 (404), AC3 (401), and AC7 (409) scenarios above and assert `assert.deepEqual(new Set(Object.keys(bodyA)), new Set(Object.keys(bodyB)))` pairwise (or equivalently reuse `assertEnvelopeShape` — which already fixes the exact key set — against every one of them)."
  - "AC7 (uncovered status, e.g. 409, still uses the same shape): reuse the existing SequenceCapacityExceededError scenario (test/workItemCrud.test.ts:189, create work items until sequence capacity is exceeded) and the existing BlockingDependentsError scenario (test/workItemCrud.test.ts:266, delete a work item that still has children/dependents), asserting `assert.equal(res.status, 409)` and `assertEnvelopeShape(body, \"CONFLICT\")` for both."
assumptions_or_open_questions:
  - "The story's ACs refer to \"/v1/ endpoint\" generically, but no route in this codebase is version-prefixed (all routes are bare, e.g. `/auth/login`, `/work-items/:id`) and there is no other use of `v1` anywhere in src/. I've treated \"/v1/ endpoint\" as shorthand for \"any API endpoint\" and have NOT introduced a `/v1` prefix or any routing/versioning change — that would be a distinct, much larger change belonging to the parent epic's \"routing conventions\" work, not this error-envelope story."
  - "`handleUpdateWorkItem` returning `200 { work_item: null }` for a non-existent work item (test/workItemCrud.test.ts:248-251) is left as-is. It predates this story (STORY-082) and is a success response, not a failure response, so AC2 doesn't apply to it; changing it to a 404 would be an unrelated behavioural change and would break an already-accepted test."
  - "AC7 mentions 405 (Method Not Allowed) and 429 (Too Many Requests) as examples of uncovered statuses, but neither currently exists anywhere in this codebase (there's no method-not-allowed detection — a wrong verb on a known path currently just falls through to the generic 404 — and no rate limiting). Adding those failure modes would be new feature work outside an error-envelope story's scope. AC7 is satisfied structurally: every call site funnels through the single `errorEnvelope()` constructor, so any status/code this codebase already produces (400/401/403/404/409/413/500) gets the identical shape, and a future 405/429 addition would automatically inherit it by calling the same function."
  - "`details` is always an object (defaulting to `{}`) rather than an optional field, so that AC6's \"identical shape\" holds literally (same key set and same value *type* on every response) rather than only holding for responses that happen to carry extra context."
package_dependencies: []
notes: |
  Existing behaviour worth flagging explicitly: `src/app.ts`'s current catch-all maps *every*
  uncaught exception (JSON parse failure, or any other bug in a service/repository) to a plain
  400 `{ error: "invalid request" }`. That's the concrete defect behind AC4/AC5 — a genuine
  server fault currently looks identical to a bad request, and would additionally leak
  `err.message` if a controller ever did `{ error: err.message }` on an uncaught path (none
  currently do, but nothing stopped it). This plan fixes that at the one chokepoint
  (`src/app.ts`'s catch block) rather than auditing every call site for message-leakage, which is
  both sufficient and matches the existing "controllers catch known domain errors, app.ts catches
  everything else" structure already in place.

  ```mermaid
  flowchart TD
    app["src/app.ts (route dispatch + catch-all)"]
    envelope["src/errors/errorEnvelope.ts (new)"]
    httpUtils["src/httpUtils.ts (readJsonBody)"]
    authCtrl["src/auth/authController.ts"]
    cartCtrl["src/cart/cartController.ts"]
    workCtrl["src/workitems/workItemController.ts"]
    authSvc["src/auth/authService.ts"]
    cartSvc["src/cart/cartService.ts"]
    workSvc["src/workitems/workItemService.ts"]

    app -->|"catches InvalidJsonBodyError/PayloadTooLargeError, else 500"| httpUtils
    app --> authCtrl
    app --> cartCtrl
    app --> workCtrl
    authCtrl -->|"throws InvalidCredentialsError etc, caught -> envelope"| authSvc
    cartCtrl -->|"throws PizzaNotFoundError etc, caught -> envelope"| cartSvc
    workCtrl -->|"throws ProjectNotFoundError etc, caught -> envelope"| workSvc
    authCtrl -.->|"builds body via"| envelope
    cartCtrl -.->|"builds body via"| envelope
    workCtrl -.->|"builds body via"| envelope
    app -.->|"builds 404/500 body via"| envelope

    classDef touched fill:#f96,color:#000
    class app,envelope,httpUtils,authCtrl,cartCtrl,workCtrl touched
  ```
review_focus: |
  In scope: replacing every existing `{ error: "..." }` (and app.ts's 400-catch-all-for-anything)
  with the shared `errorEnvelope()` shape, and fixing app.ts to actually distinguish a bad JSON
  body (400) from an unexpected fault (500) — it currently doesn't. Out of scope, deliberately:
  no `/v1` route prefix/versioning, no new failure modes (405/429), and no change to
  `handleUpdateWorkItem`'s existing 200-with-null behaviour for a missing work item (that's
  pre-existing STORY-082 behaviour, not an error response). The riskiest part of this change is
  the app.ts catch-all rewrite: it changes what status code *unexpected* exceptions produce (400
  -> 500), which is correct per AC4 but is a behavioural change on a path with no prior direct
  test coverage — the new `FaultyWorkItemRepository`-based test is the only thing exercising it,
  so scrutinise that test as much as the implementation. Also worth checking: `details` is always
  an object (never omitted) specifically to satisfy AC6's "identical shape" literally — don't
  flag inconsistent extra top-level fields, since none should exist anymore.
