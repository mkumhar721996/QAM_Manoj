summary: |
  This repo currently implements only auth/session (`src/auth`, `src/sessions`, `src/users`) and pizza
  customisation/cart (`src/pizzas`, `src/cart`), all following a repository -> service -> controller
  layering with in-memory `Map`-backed repositories (no DB), snake_case JSON over a hand-rolled
  `node:http` router in `src/app.ts`, and `node:test` + raw `fetch` against an ephemeral
  `startTestServer()`. There is no "project" or "work item" domain anywhere yet. This plan adds both,
  scoped tightly to STORY-082 (create/read/update/delete a work item, with keyed-ID assignment and
  project-level access control) and explicitly NOT the WorkStatus lifecycle, dependency-graph reads, or
  notes/comments mentioned in the parent epic - those are separate stories. A minimal `src/projects/`
  module (a `Project` = id + key + member user ids, static fixture-seeded like `testUsers`/`testPizzas`)
  supplies the `{KEY}` for keyed IDs and the project-membership check that AC8/13/14 require. A new
  `src/workitems/` module (`WorkItem` model + `WorkItemRepository` + `WorkItemService` + controller)
  owns `{KEY}-{KIND}-{NNN}` id assignment (a per-`{key}-{kind}` sequence counter capped at 999),
  CRUD, and delete-blocking via `parentId`/`dependsOnIds` references recorded on the work item itself
  (no separate dependency-graph feature is added - just enough state on the model to make AC7's
  block-list check possible). New routes are wired into `src/app.ts`'s existing flat route dispatcher,
  reusing the existing Bearer/JWT `verifyAccessToken` auth exactly as `cartController.ts` does.
scope:
  - description: |
      Write the failing acceptance tests first in a new file, covering all 14 ACs against the
      not-yet-existing `POST /projects/:projectId/work-items`, `GET /work-items/:id`,
      `PATCH /work-items/:id`, `DELETE /work-items/:id` routes. These must fail (404/import errors)
      before any implementation exists.
    files:
      - "test/workItemCrud.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before any production code exists,
      matching the existing `test/login.test.ts` / `test/cartCustomisation.test.ts` style (raw `fetch`
      against `startTestServer()`, snake_case JSON assertions, one `test()` per AC-labelled behaviour).
  - description: |
      Add a minimal `Project` domain: model, a static in-memory fixture (mirrors
      `src/users/fixtures/testUsers.ts`), and a repository (mirrors `src/pizzas/pizzaRepository.ts`).
      This is the source of `{KEY}` for keyed IDs and of the project-membership check ACs 8/13/14 need.
      No ownership/role fields beyond membership - AC8 explicitly forbids per-item ownership/role checks.

      ```ts
      // src/projects/projectModel.ts
      export interface Project {
        id: string;
        key: string;
        memberUserIds: string[];
      }
      ```

      ```ts
      // src/projects/fixtures/testProjects.ts
      export const testProjects: Project[] = [
        { id: "project-apollo", key: "APOLLO", memberUserIds: ["user-customer-1", "user-admin-1"] },
        { id: "project-zephyr", key: "ZEPHYR", memberUserIds: ["user-provider-1"] },
      ];
      ```

      ```ts
      // src/projects/projectRepository.ts
      export class ProjectRepository {
        private projectsById: Map<string, Project>;
        constructor(projects: Project[] = testProjects) {
          this.projectsById = new Map(projects.map((p) => [p.id, p]));
        }
        findById(projectId: string): Project | undefined {
          return this.projectsById.get(projectId);
        }
        hasAccess(project: Project, userId: string): boolean {
          return project.memberUserIds.includes(userId);
        }
      }
      ```
    files:
      - "src/projects/projectModel.ts"
      - "src/projects/fixtures/testProjects.ts"
      - "src/projects/projectRepository.ts"
    rationale: |
      AC1 needs a `{KEY}` per project; AC8/13/14 need "does this project exist" and "is this caller a
      member of it" checks that are independent of any individual work item. Reusing the existing
      `testUsers` ids (`user-customer-1`, `user-provider-1`, `user-admin-1`) as `memberUserIds` lets
      tests exercise "member of project A but not project B" and "different roles, same project"
      scenarios without inventing a new user fixture.
  - description: |
      Add the `WorkItem` model and an in-memory `WorkItemRepository`. The repository owns two pieces
      of state: the items themselves, and a per-`{key}-{kind}` sequence counter (capped at 999) used
      for AC1/AC12. `parentId`/`dependsOnIds` are plain fields on the item (not a separate graph store)
      - enough for AC7's "children or dependents" block-list check, deliberately not a general
      dependency-graph read API (that belongs to a different story in the epic).

      ```ts
      // src/workitems/workItemModel.ts
      export interface WorkItem {
        id: string;
        projectId: string;
        kind: string;
        title: string;
        description: string | null;
        parentId: string | null;
        dependsOnIds: string[];
        createdAt: number;
        updatedAt: number;
      }

      export interface CreateWorkItemInput {
        kind: string;
        title: string;
        description?: string | null;
        parentId?: string | null;
        dependsOnIds?: string[];
      }

      export interface UpdateWorkItemInput {
        title?: string;
        description?: string | null;
        parentId?: string | null;
        dependsOnIds?: string[];
      }
      ```

      ```ts
      // src/workitems/workItemRepository.ts
      const MAX_SEQUENCE = 999;

      export class WorkItemRepository {
        private itemsById: Map<string, WorkItem>;
        private sequenceByKeyAndKind: Map<string, number>;

        constructor(items: WorkItem[] = [], sequenceOverrides: Map<string, number> = new Map()) {
          this.itemsById = new Map(items.map((i) => [i.id, i]));
          this.sequenceByKeyAndKind = new Map(sequenceOverrides);
        }

        nextSequence(projectKey: string, kind: string): number | null {
          const seqKey = `${projectKey}-${kind}`;
          const current = this.sequenceByKeyAndKind.get(seqKey) ?? 0;
          if (current >= MAX_SEQUENCE) {
            return null;
          }
          const next = current + 1;
          this.sequenceByKeyAndKind.set(seqKey, next);
          return next;
        }

        save(item: WorkItem): void {
          this.itemsById.set(item.id, item);
        }

        findById(id: string): WorkItem | undefined {
          return this.itemsById.get(id);
        }

        delete(id: string): void {
          this.itemsById.delete(id);
        }

        findChildren(parentId: string): WorkItem[] {
          return [...this.itemsById.values()].filter((item) => item.parentId === parentId);
        }

        findDependents(id: string): WorkItem[] {
          return [...this.itemsById.values()].filter((item) => item.dependsOnIds.includes(id));
        }
      }
      ```
    files:
      - "src/workitems/workItemModel.ts"
      - "src/workitems/workItemRepository.ts"
    rationale: |
      Mirrors the existing `CartRepository`/`SessionRepository` constructor-injectable-seed pattern so
      tests can pre-seed a sequence counter near `999` for AC12 without looping 999 real creates, and
      can pre-seed items with `parentId`/`dependsOnIds` relationships for AC7 without a separate
      dependency-graph endpoint.
  - description: |
      Add `WorkItemService`, which owns every business rule that isn't pure HTTP-shape concern:
      project-existence/access checks (shared by create/read/update/delete), keyed-ID assignment,
      the AC10/11 "update on missing id is a no-op success" asymmetry, and the AC6/7 delete-blocking
      check. Mirrors how `AuthService`/`CartService` centralise their rules and throw typed errors for
      the controller to translate into status codes.

      ```ts
      // src/workitems/workItemService.ts
      export class ProjectNotFoundError extends Error {
        constructor(public readonly projectId: string) {
          super(`project not found: ${projectId}`);
        }
      }
      export class ProjectAccessDeniedError extends Error {
        constructor(public readonly projectId: string) {
          super(`access denied to project: ${projectId}`);
        }
      }
      export class SequenceCapacityExceededError extends Error {
        constructor(public readonly keyKindPair: string) {
          super(`sequence capacity exceeded for ${keyKindPair}`);
        }
      }
      export class WorkItemNotFoundError extends Error {
        constructor(public readonly workItemId: string) {
          super(`work item not found: ${workItemId}`);
        }
      }
      export class BlockingDependentsError extends Error {
        constructor(public readonly blockingIds: string[]) {
          super(`cannot delete work item: blocked by ${blockingIds.join(", ")}`);
        }
      }

      export class WorkItemService {
        constructor(
          private projectRepository: ProjectRepository,
          private workItemRepository: WorkItemRepository,
        ) {}

        private assertAccess(project: Project | undefined, projectId: string, userId: string): Project {
          if (!project) throw new ProjectNotFoundError(projectId);
          if (!this.projectRepository.hasAccess(project, userId)) throw new ProjectAccessDeniedError(projectId);
          return project;
        }

        createWorkItem(projectId: string, userId: string, input: CreateWorkItemInput, now = Date.now()): WorkItem {
          const project = this.assertAccess(this.projectRepository.findById(projectId), projectId, userId);
          const sequence = this.workItemRepository.nextSequence(project.key, input.kind);
          if (sequence === null) throw new SequenceCapacityExceededError(`${project.key}-${input.kind}`);
          const id = `${project.key}-${input.kind}-${String(sequence).padStart(3, "0")}`;
          const item: WorkItem = {
            id, projectId, kind: input.kind, title: input.title,
            description: input.description ?? null, parentId: input.parentId ?? null,
            dependsOnIds: input.dependsOnIds ?? [], createdAt: now, updatedAt: now,
          };
          this.workItemRepository.save(item);
          return item;
        }

        getWorkItem(id: string, userId: string): WorkItem | undefined {
          const item = this.workItemRepository.findById(id);
          if (!item) return undefined;
          this.assertAccess(this.projectRepository.findById(item.projectId), item.projectId, userId);
          return item;
        }

        updateWorkItem(id: string, userId: string, patch: UpdateWorkItemInput, now = Date.now()): WorkItem | undefined {
          const existing = this.workItemRepository.findById(id);
          if (!existing) return undefined;
          this.assertAccess(this.projectRepository.findById(existing.projectId), existing.projectId, userId);
          const updated: WorkItem = {
            ...existing,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
            ...(patch.dependsOnIds !== undefined ? { dependsOnIds: patch.dependsOnIds } : {}),
            updatedAt: now,
          };
          this.workItemRepository.save(updated);
          return updated;
        }

        deleteWorkItem(id: string, userId: string): void {
          const existing = this.workItemRepository.findById(id);
          if (!existing) throw new WorkItemNotFoundError(id);
          this.assertAccess(this.projectRepository.findById(existing.projectId), existing.projectId, userId);
          const blockingIds = [
            ...this.workItemRepository.findChildren(id),
            ...this.workItemRepository.findDependents(id),
          ].map((i) => i.id);
          if (blockingIds.length > 0) throw new BlockingDependentsError(blockingIds);
          this.workItemRepository.delete(id);
        }
      }
      ```
    files:
      - "src/workitems/workItemService.ts"
    rationale: |
      Centralising the project-access check in one `assertAccess` helper called from every method is
      how AC8 ("any CRUD operation ... permitted without per-item ownership or role checks") is
      satisfied uniformly rather than re-implemented per-route. `updateWorkItem` deliberately returns
      `undefined` (not a thrown not-found error) for a missing id, and skips the access check entirely
      in that case, so it never attempts a project lookup for state that doesn't exist - matching
      AC10/11 exactly (success + null result, no record created, no incidental 403).
  - description: |
      Add `workItemController.ts` with one handler per route, reusing `verifyAccessToken` (same
      Bearer-extraction as `cartController.ts`) and `asRecord` for body parsing, and mapping the typed
      service errors to status codes.

      ```ts
      // src/workitems/workItemController.ts
      function serializeWorkItem(item: WorkItem): Record<string, unknown> {
        return {
          id: item.id, project_id: item.projectId, kind: item.kind, title: item.title,
          description: item.description, parent_id: item.parentId, depends_on_ids: item.dependsOnIds,
          created_at: item.createdAt, updated_at: item.updatedAt,
        };
      }

      export function handleCreateWorkItem(
        workItemService: WorkItemService,
        authorizationHeader: string | undefined,
        projectId: string,
        requestBody: unknown,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };

        const { kind, title, description, parent_id: parentId, depends_on_ids: dependsOnIds } = asRecord(requestBody);
        if (
          typeof kind !== "string" || kind.length === 0 ||
          typeof title !== "string" || title.length === 0 ||
          (description !== undefined && description !== null && typeof description !== "string") ||
          (parentId !== undefined && parentId !== null && typeof parentId !== "string") ||
          (dependsOnIds !== undefined && (!Array.isArray(dependsOnIds) || !dependsOnIds.every((d) => typeof d === "string")))
        ) {
          return { status: 400, body: { error: "invalid work item payload" } };
        }

        try {
          const item = workItemService.createWorkItem(projectId, payload.userId, {
            kind, title,
            description: description as string | null | undefined,
            parentId: parentId as string | undefined,
            dependsOnIds: dependsOnIds as string[] | undefined,
          });
          return { status: 201, body: serializeWorkItem(item) };
        } catch (err) {
          if (err instanceof ProjectNotFoundError) return { status: 404, body: { error: err.message, project_id: projectId } };
          if (err instanceof ProjectAccessDeniedError) return { status: 403, body: { error: err.message, project_id: projectId } };
          if (err instanceof SequenceCapacityExceededError) return { status: 409, body: { error: err.message } };
          throw err;
        }
      }

      export function handleGetWorkItem(
        workItemService: WorkItemService,
        authorizationHeader: string | undefined,
        workItemId: string,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        try {
          const item = workItemService.getWorkItem(workItemId, payload.userId);
          if (!item) return { status: 404, body: { error: `work item not found: ${workItemId}` } };
          return { status: 200, body: serializeWorkItem(item) };
        } catch (err) {
          if (err instanceof ProjectAccessDeniedError) return { status: 403, body: { error: err.message } };
          throw err;
        }
      }

      export function handleUpdateWorkItem(
        workItemService: WorkItemService,
        authorizationHeader: string | undefined,
        workItemId: string,
        requestBody: unknown,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };

        const { title, description, parent_id: parentId, depends_on_ids: dependsOnIds } = asRecord(requestBody);
        if (
          (title !== undefined && typeof title !== "string") ||
          (description !== undefined && description !== null && typeof description !== "string") ||
          (parentId !== undefined && parentId !== null && typeof parentId !== "string") ||
          (dependsOnIds !== undefined && (!Array.isArray(dependsOnIds) || !dependsOnIds.every((d) => typeof d === "string")))
        ) {
          return { status: 400, body: { error: "invalid work item payload" } };
        }

        try {
          const item = workItemService.updateWorkItem(workItemId, payload.userId, {
            title: title as string | undefined,
            description: description as string | null | undefined,
            parentId: parentId as string | null | undefined,
            dependsOnIds: dependsOnIds as string[] | undefined,
          });
          return { status: 200, body: { work_item: item ? serializeWorkItem(item) : null } };
        } catch (err) {
          if (err instanceof ProjectAccessDeniedError) return { status: 403, body: { error: err.message } };
          throw err;
        }
      }

      export function handleDeleteWorkItem(
        workItemService: WorkItemService,
        authorizationHeader: string | undefined,
        workItemId: string,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        try {
          workItemService.deleteWorkItem(workItemId, payload.userId);
          return { status: 204 };
        } catch (err) {
          if (err instanceof WorkItemNotFoundError) return { status: 404, body: { error: err.message } };
          if (err instanceof ProjectAccessDeniedError) return { status: 403, body: { error: err.message } };
          if (err instanceof BlockingDependentsError) return { status: 409, body: { error: err.message, blocking_ids: err.blockingIds } };
          throw err;
        }
      }
      ```
    files:
      - "src/workitems/workItemController.ts"
    rationale: |
      Keeps HTTP-shape concerns (snake_case body, status codes, Bearer-token parsing) in the
      controller only, exactly like `authController.ts`/`cartController.ts`, so `WorkItemService`
      stays framework/HTTP-agnostic. `handleUpdateWorkItem` never maps a missing item to 404 - it
      passes the service's `undefined` straight through as `{ work_item: null }` at 200, per AC10/11.
  - description: |
      Wire the new routes into `src/app.ts`: instantiate `ProjectRepository`/`WorkItemRepository`/
      `WorkItemService`, extend `AppDependencies` so tests can inject them, and add route matching for
      `POST /projects/:projectId/work-items`, `GET /work-items/:id`, `PATCH /work-items/:id`,
      `DELETE /work-items/:id`.

      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
        projectRepository?: ProjectRepository;
        workItemRepository?: WorkItemRepository;
      }
      ```

      Routing additions inside `handleRequest` (path-param routes, matching the existing
      `/pizzas/:id` regex-match precedent rather than the exact-string routes):

      ```ts
      const workItemMatch = url.pathname.match(/^\/work-items\/([^/]+)$/);
      if (method === "GET" && workItemMatch) {
        const result = handleGetWorkItem(workItemService, req.headers.authorization, workItemMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }
      if (method === "DELETE" && workItemMatch) {
        const result = handleDeleteWorkItem(workItemService, req.headers.authorization, workItemMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }

      const createWorkItemMatch = url.pathname.match(/^\/projects\/([^/]+)\/work-items$/);
      const isCreateWorkItem = method === "POST" && createWorkItemMatch !== null;
      const isUpdateWorkItem = method === "PATCH" && workItemMatch !== null;
      // ... isCreateWorkItem / isUpdateWorkItem join the existing "does this route need a body"
      // allow-list check, then after readJsonBody():
      if (isCreateWorkItem) {
        const result = handleCreateWorkItem(workItemService, req.headers.authorization, createWorkItemMatch![1], body);
        sendJson(res, result.status, result.body);
        return;
      }
      if (isUpdateWorkItem) {
        const result = handleUpdateWorkItem(workItemService, req.headers.authorization, workItemMatch![1], body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - "src/app.ts"
    rationale: |
      `createApp` is the single composition root today (constructs every repository/service and
      dispatches on `${method} ${pathname}`) - the new modules must be composed and routed the same
      way. `GET/DELETE /work-items/:id` need no request body so they're handled before the body-read
      gate (like `GET /cart`); `POST .../work-items` and `PATCH /work-items/:id` need a body so they
      join the existing allow-list of routes that fall through to `readJsonBody()`.
  - description: |
      Write the full acceptance test suite (this is the file drafted first in the scope item above;
      listed again here as the concrete final content once implementation makes it pass). Covers
      login-as-different-users, project/work-item HTTP helpers, and one test per AC (several ACs share
      a test where the behaviours are tightly coupled, e.g. AC10+AC11).
    files:
      - "test/workItemCrud.test.ts"
    rationale: |
      Same file as the first scope item; called out separately only to make clear the test file is
      both the first artifact written (red) and the last one touched (once everything is green).
tests:
  - |
    AC1 - GIVEN a valid project context WHEN a caller creates a work item THEN the response includes a
    unique keyed ID in the {KEY}-{KIND}-{NNN} format.
    ```ts
    test("AC1: creating a work item returns a unique keyed ID in {KEY}-{KIND}-{NNN} format", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "Set up CI" });
        assert.equal(res.status, 201);
        const body = (await res.json()) as { id: string };
        assert.equal(body.id, "APOLLO-TASK-001");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - GIVEN an existing work item WHEN a caller reads it by its keyed ID THEN the full work item
    record is returned.
    ```ts
    test("AC2: reading a work item by its keyed ID returns the full record", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const created = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "TASK", title: "Set up CI", description: "initial",
        })).json() as Record<string, unknown>;

        const res = await getWorkItem(server.baseUrl, token, created.id as string);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body, created);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN an existing work item WHEN a caller updates one or more fields THEN the response
    includes the updated field values.
    ```ts
    test("AC3: updating fields returns the updated values in the response", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const created = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "TASK", title: "Old title",
        })).json() as { id: string };

        const res = await updateWorkItem(server.baseUrl, token, created.id, { title: "New title", description: "New description" });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { work_item: { title: string; description: string } };
        assert.equal(body.work_item.title, "New title");
        assert.equal(body.work_item.description, "New description");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN a work item that was just updated WHEN a caller reads it afterward THEN the returned
    record reflects the updated values.
    ```ts
    test("AC4: a subsequent read reflects the previously updated values", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const created = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "TASK", title: "Old title",
        })).json() as { id: string };
        await updateWorkItem(server.baseUrl, token, created.id, { title: "New title" });

        const res = await getWorkItem(server.baseUrl, token, created.id);
        const body = (await res.json()) as { title: string };
        assert.equal(body.title, "New title");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 - GIVEN two concurrent update requests targeting the same work item WHEN both requests are
    processed THEN the field values from the update that completes last are persisted (not an
    interleaved mix of both payloads).
    ```ts
    test("AC5: of two concurrent updates, the final state matches exactly one full update payload", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const created = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "TASK", title: "Old title",
        })).json() as { id: string };

        const [resA, resB] = await Promise.all([
          updateWorkItem(server.baseUrl, token, created.id, { title: "Title A", description: "Description A" }),
          updateWorkItem(server.baseUrl, token, created.id, { title: "Title B", description: "Description B" }),
        ]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);

        const finalBody = (await (await getWorkItem(server.baseUrl, token, created.id)).json()) as {
          title: string; description: string;
        };
        const matchesA = finalBody.title === "Title A" && finalBody.description === "Description A";
        const matchesB = finalBody.title === "Title B" && finalBody.description === "Description B";
        assert.ok(matchesA || matchesB, `expected a clean overwrite by A or B, got ${JSON.stringify(finalBody)}`);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 - GIVEN a work item with no dependents or children WHEN a caller deletes it by its keyed ID
    THEN the item is immediately and permanently removed.
    ```ts
    test("AC6: deleting a work item with no dependents removes it immediately", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const created = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "TASK", title: "Disposable",
        })).json() as { id: string };

        const deleteRes = await deleteWorkItem(server.baseUrl, token, created.id);
        assert.equal(deleteRes.status, 204);

        const getRes = await getWorkItem(server.baseUrl, token, created.id);
        assert.equal(getRes.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 - GIVEN a work item that has at least one dependent or child WHEN a caller attempts to delete
    it THEN the request is rejected with a clear error that lists the blocking item IDs.
    ```ts
    test("AC7: deleting a work item with a child is rejected and lists the blocking id", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const parent = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "STORY", title: "Parent",
        })).json() as { id: string };
        const child = await (await createWorkItem(server.baseUrl, token, "project-apollo", {
          kind: "TASK", title: "Child", parent_id: parent.id,
        })).json() as { id: string };

        const res = await deleteWorkItem(server.baseUrl, token, parent.id);
        assert.equal(res.status, 409);
        const body = (await res.json()) as { blocking_ids: string[] };
        assert.ok(body.blocking_ids.includes(child.id));
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC8 - GIVEN an authenticated caller with access to the project WHEN performing any CRUD operation
    on a work item in that project THEN the operation is permitted without per-item ownership or role
    checks; a caller without project access is rejected on every operation.
    ```ts
    test("AC8: any project member can read/update/delete a work item created by a different member/role", async () => {
      const server = await startTestServer();
      try {
        const creatorToken = await loginAs(server.baseUrl, "customer1");
        const otherMemberToken = await loginAs(server.baseUrl, "admin1"); // also a member of project-apollo, different role
        const created = await (await createWorkItem(server.baseUrl, creatorToken, "project-apollo", {
          kind: "TASK", title: "Owned by customer1",
        })).json() as { id: string };

        const updateRes = await updateWorkItem(server.baseUrl, otherMemberToken, created.id, { title: "Edited by admin1" });
        assert.equal(updateRes.status, 200);

        const deleteRes = await deleteWorkItem(server.baseUrl, otherMemberToken, created.id);
        assert.equal(deleteRes.status, 204);
      } finally {
        await server.close();
      }
    });

    test("AC8: a caller with no access to the item's project is rejected on read/update/delete", async () => {
      const server = await startTestServer();
      try {
        const memberToken = await loginAs(server.baseUrl, "customer1");
        const outsiderToken = await loginAs(server.baseUrl, "provider1"); // not a member of project-apollo
        const created = await (await createWorkItem(server.baseUrl, memberToken, "project-apollo", {
          kind: "TASK", title: "Members only",
        })).json() as { id: string };

        assert.equal((await getWorkItem(server.baseUrl, outsiderToken, created.id)).status, 403);
        assert.equal((await updateWorkItem(server.baseUrl, outsiderToken, created.id, { title: "nope" })).status, 403);
        assert.equal((await deleteWorkItem(server.baseUrl, outsiderToken, created.id)).status, 403);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC9 - GIVEN a work item ID that does not exist WHEN a caller reads or deletes it THEN the response
    is a 404 not-found error.
    ```ts
    test("AC9: reading or deleting a non-existent work item id returns 404", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        assert.equal((await getWorkItem(server.baseUrl, token, "APOLLO-TASK-999")).status, 404);
        assert.equal((await deleteWorkItem(server.baseUrl, token, "APOLLO-TASK-999")).status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC10/AC11 - GIVEN a work item ID that does not exist WHEN a caller updates it THEN the response is
    a success with an empty/null result, AND no record is created.
    ```ts
    test("AC10/AC11: updating a non-existent work item id succeeds with a null result and creates nothing", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await updateWorkItem(server.baseUrl, token, "APOLLO-TASK-999", { title: "ghost" });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { work_item: unknown };
        assert.equal(body.work_item, null);

        const getRes = await getWorkItem(server.baseUrl, token, "APOLLO-TASK-999");
        assert.equal(getRes.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC12 - GIVEN the sequence counter for a {KEY}-{KIND} pair is already at its maximum NNN value (999)
    WHEN a caller creates another work item under that same {KEY}-{KIND} pair THEN the request is
    rejected with a capacity-exceeded error.
    ```ts
    test("AC12: creating past sequence 999 for the same KEY-KIND pair is rejected", async () => {
      const workItemRepository = new WorkItemRepository([], new Map([["APOLLO-TASK", 999]]));
      const server = await startTestServer({ workItemRepository });
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await createWorkItem(server.baseUrl, token, "project-apollo", { kind: "TASK", title: "One too many" });
        assert.equal(res.status, 409);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC13 - GIVEN a project ID that does not exist WHEN a caller attempts to create a work item under
    that project ID THEN the response is a 404 error naming the project ID.
    ```ts
    test("AC13: creating under a non-existent project id returns 404 naming the project id", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1");
        const res = await createWorkItem(server.baseUrl, token, "project-does-not-exist", { kind: "TASK", title: "x" });
        assert.equal(res.status, 404);
        const body = (await res.json()) as { project_id: string };
        assert.equal(body.project_id, "project-does-not-exist");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC14 - GIVEN a project ID that the caller lacks access to WHEN a caller attempts to create a work
    item under that project ID THEN the response is a 403 error naming the project ID.
    ```ts
    test("AC14: creating under a project the caller lacks access to returns 403 naming the project id", async () => {
      const server = await startTestServer();
      try {
        const token = await loginAs(server.baseUrl, "customer1"); // not a member of project-zephyr
        const res = await createWorkItem(server.baseUrl, token, "project-zephyr", { kind: "TASK", title: "x" });
        assert.equal(res.status, 403);
        const body = (await res.json()) as { project_id: string };
        assert.equal(body.project_id, "project-zephyr");
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - |
    No "project" domain exists anywhere in this codebase today. This plan adds the smallest possible
    `Project` (id + key + member user ids, static fixture-seeded) purely to supply the keyed-ID `{KEY}`
    and the AC8/13/14 access check. If a real project-management story elsewhere in the epic/product
    already defines (or will define) a richer `Project` shape or a real creation/membership API,
    please point to it - this plan assumes fixture-only projects are acceptable for this story, same as
    `testUsers`/`testPizzas` are fixture-only today.
  - |
    `kind` (the `{KIND}` segment of the keyed id) is accepted as any non-empty string the caller
    supplies verbatim (e.g. `"TASK"`, `"BUG"`), with no enum/allow-list and no case transformation,
    since no AC constrains its value. Please confirm, or provide the actual set of valid kinds.
  - |
    AC5's "the update that completes last is persisted" is tested as "the final state exactly matches
    one full update payload, never an interleaved mix" rather than literally controlling which of two
    concurrently-fired HTTP requests physically completes last (that ordering isn't controllable from
    a test without an artificial delay hook, and asserting a specific winner would be flaky). This is
    sound by construction here: `updateWorkItem` does a single synchronous `Map` read-modify-write with
    no `await` in between, so Node's single-threaded event loop can never interleave two updates -
    whichever one's synchronous block runs second always fully overwrites the first. Flag if a
    stronger/different guarantee (e.g. optimistic-locking version conflicts) was intended instead.
  - |
    `parentId`/`dependsOnIds` are accepted as plain optional fields on create/update (`parent_id`,
    `depends_on_ids` in the wire format) so AC7's block-list check is testable, but no read API for the
    dependency graph itself is added (e.g. "list an item's dependents") - that's assumed to belong to
    the separate "read-only dependency graph" story called out in the parent epic.
  - |
    Both "capacity exceeded" (AC12) and "blocked by dependents/children" (AC7) are mapped to HTTP 409
    Conflict. No status code is specified in either AC; 409 was chosen as the closest standard fit for
    "the current state of the resource/sequence prevents this request." Please confirm or specify
    otherwise.
  - |
    The update response envelope (`{ "work_item": {...} | null }`) differs from the flat/unwrapped
    shape used for create and read responses (`{ id, project_id, ... }` at top level). This is
    deliberate so AC10's "null result" has an unambiguous place to live without changing create/read's
    existing flat shape; happy to make update flat too (with e.g. a distinct 200-with-empty-body) if
    the reviewer prefers strict symmetry across all three response shapes.
  - |
    Deleting a work item is a hard, permanent removal from the in-memory store (AC6 says "immediately
    and permanently removed") - there is no soft-delete/tombstone, matching the fact that nothing else
    in this codebase soft-deletes.
package_dependencies: []
notes: |
  Layering/call-graph for the touched and newly-added modules, plus the existing modules they plug
  into (all read while planning):

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: routes + composition root)"]
    workItemController["src/workitems/workItemController.ts (new)"]
    workItemService["src/workitems/workItemService.ts (new)"]
    workItemRepository["src/workitems/workItemRepository.ts (new)"]
    projectRepository["src/projects/projectRepository.ts (new)"]
    projectFixtures["src/projects/fixtures/testProjects.ts (new)"]
    tokenService["src/auth/tokenService.ts (existing, untouched)"]
    httpUtils["src/httpUtils.ts (existing, untouched)"]
    testFile["test/workItemCrud.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes POST /projects/:id/work-items, GET|PATCH|DELETE /work-items/:id"| workItemController
    workItemController -->|"verifyAccessToken() to identify the caller"| tokenService
    workItemController -->|"asRecord()/body parsing"| httpUtils
    workItemController -->|"createWorkItem(), getWorkItem(), updateWorkItem(), deleteWorkItem()"| workItemService
    workItemService -->|"findById(), hasAccess() for every op"| projectRepository
    workItemService -->|"nextSequence(), save(), findById(), delete(), findChildren(), findDependents()"| workItemRepository
    projectRepository -->|"seeds from"| projectFixtures
    testFile -->|"drives via fetch()"| app
    testFile -->|"startTestServer()"| testServer
    testFile -->|"seeds sequence overrides for AC12"| workItemRepository

    classDef touched fill:#f96,color:#000
    class app,workItemController,workItemService,workItemRepository,projectRepository,projectFixtures,testFile touched
  ```

  Route dispatch in `src/app.ts` today is a flat set of exact `${method} ${pathname}` string
  comparisons, with one existing precedent for a path-param route (`GET /pizzas/:id`, matched via
  regex). This plan follows that precedent for `/work-items/:id` and `/projects/:id/work-items` rather
  than introducing a router library - no new dependency is needed.

  Directory naming follows the existing all-lowercase single-word convention (`auth`, `cart`,
  `pizzas`, `sessions`, `users`): `src/projects/` and `src/workitems/` (not `workItems/`), with
  camelCase file names inside (`workItemModel.ts`, `workItemService.ts`) matching e.g.
  `src/cart/cartModel.ts`.
