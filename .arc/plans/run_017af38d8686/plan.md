summary: |
  Add self-service profile management for approved providers to this backend-only auth
  service: an authenticated provider can view and edit their own business name, description,
  and contact details (email/phone), changes are validated and persisted immediately with no
  moderation step, and the same data is exposed on a public read endpoint so "reflected on
  their profile" (AC3/AC13) is independently observable. Access is denied with an explicit
  message when the provider's application is pending/rejected (AC9), and cross-provider
  access returns a bare 403 with no profile data disclosed (AC10). This introduces a new
  domain concept — `ProviderApplicationStatus` and a per-provider profile record — since the
  current codebase (a plain Node `http` auth/session service with in-memory repositories) has
  no notion of a provider application or approval status yet; it only has a `provider` user
  role. The plan is scoped to what is actually testable in this repository: it is a backend
  HTTP service with no UI/frontend code at all, so ACs 6, 7, 8, 14 and 15 (keyboard
  navigation, screen-reader compatibility, WCAG contrast, Cancel-discards-edits, and the
  navigate-away confirmation dialog) cannot be implemented or verified here — see
  `assumptions_or_open_questions`.

scope:
  - description: |
      Extend the user fixtures with three more `provider`-role test users so the ownership
      (AC10) and approval-status (AC9) tests have concrete pending/rejected/second-approved
      accounts to log in as, mirroring how `testUsers.ts` already seeds `provider1`.
      Add the seeds:
      ```ts
      { id: "user-provider-2", username: "provider2", role: "provider" },
      { id: "user-provider-3", username: "provider3", role: "provider" },
      { id: "user-provider-4", username: "provider4", role: "provider" },
      ```
    files:
      - src/users/fixtures/testUsers.ts
    rationale: |
      AC9 needs a pending provider and a rejected provider to log in as; AC10 needs a second
      *approved* provider distinct from provider1 so the cross-provider-access test is
      meaningful (both accounts must be genuinely approved, otherwise a 403 could be
      misattributed to the approval check rather than the ownership check).

  - description: |
      New domain model for a provider's business profile plus its approval status, since
      nothing like this exists in the codebase today.
      ```ts
      export type ProviderApplicationStatus = "pending" | "approved" | "rejected";

      export interface ProviderProfile {
        providerId: string;
        status: ProviderApplicationStatus;
        businessName: string;
        description: string;
        contactEmail: string;
        contactPhone: string;
        updatedAt: number;
      }
      ```
    files:
      - src/providers/providerProfileModel.ts
    rationale: |
      Mirrors the existing `src/sessions/sessionModel.ts` pattern (plain interface, no
      class) so the new provider module matches established conventions.

  - description: |
      Fixture data seeding one `ProviderProfile` per provider test user: `user-provider-1`
      (approved), `user-provider-2` (approved, for the AC10 cross-provider test),
      `user-provider-3` (pending, for AC9), `user-provider-4` (rejected, for AC9).
    files:
      - src/providers/fixtures/testProviderProfiles.ts
    rationale: |
      Mirrors `src/users/fixtures/testUsers.ts`; keeps default in-memory state
      deterministic and test-server-overridable, same as `testUsers`/`SessionRepository`.

  - description: |
      In-memory repository keyed by `providerId`, mirroring `SessionRepository`'s
      constructor-injectable-seed pattern:
      ```ts
      export class ProviderProfileRepository {
        constructor(profiles: ProviderProfile[] = testProviderProfiles) { ... }
        findByProviderId(providerId: string): ProviderProfile | undefined { ... }
        update(providerId: string, updates: ProviderProfileInput, now: number = Date.now()): ProviderProfile { ... }
      }
      ```
      `update` throws `ProviderNotFoundError` if `providerId` has no existing profile (should
      not happen once the service layer's authorization check has already run, but keeps the
      repository safe to call directly in future tests).
    files:
      - src/providers/providerProfileRepository.ts
    rationale: |
      Keeps persistence isolated from HTTP/validation concerns, matching the existing
      Repository/Service/Controller layering used for sessions and auth.

  - description: |
      Business rules and validation, as a new `ProviderProfileService`:
      ```ts
      export interface ProviderProfileInput {
        businessName: string;
        description: string;
        contactEmail: string;
        contactPhone: string;
      }

      export class ForbiddenProfileAccessError extends Error {}
      export class ProviderApprovalRequiredError extends Error {
        constructor() {
          super("Your provider application must be approved before you can access profile management.");
        }
      }
      export class ProviderProfileValidationError extends Error {
        constructor(public readonly fieldErrors: Record<string, string>) { super("Validation failed"); }
      }
      export class ProviderNotFoundError extends Error {}

      export class ProviderProfileService {
        getManagedProfile(requestingUserId: string, targetProviderId: string): ProviderProfile
        updateManagedProfile(requestingUserId: string, targetProviderId: string, input: ProviderProfileInput): ProviderProfile
        getPublicProfile(targetProviderId: string): Omit<ProviderProfile, "status">
      }
      ```
      Authorization order (both read and write funnel through one private helper,
      `authorizeManagedAccess`): (1) `requestingUserId !== targetProviderId` throws
      `ForbiddenProfileAccessError` *before* the target's status is even looked at, so a
      non-owner can never learn whether the target exists or is approved (AC10). (2) if
      owner but `status !== "approved"`, throws `ProviderApprovalRequiredError` (AC9). (3)
      on update only, field validation runs last and throws
      `ProviderProfileValidationError` with all failing fields *before* calling
      `repository.update`, so nothing is persisted on invalid input (AC5/AC12).
      Validation regexes:
      ```ts
      const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/; // loose E.164-style, see open questions
      ```
      `getPublicProfile` returns the profile without `status` only when
      `status === "approved"`; otherwise throws `ProviderNotFoundError` (mapped to 404 by the
      controller) so a pending/rejected provider's data is never publicly disclosed.
    files:
      - src/providers/providerProfileService.ts
    rationale: |
      Centralizes the ownership/approval/validation rules the ACs specify, independent of
      HTTP concerns, and keeps the "check ownership before disclosing approval status"
      ordering (needed for AC10's "no profile data disclosed") in one place instead of
      duplicated across GET/PUT controller handlers.

  - description: |
      HTTP-layer controller functions, following the existing `authController.ts` pattern
      (snake_case wire fields, a shared `ControllerResponse` shape, plain functions taking
      the service as a parameter):
      ```ts
      export function handleGetProviderProfile(service: ProviderProfileService, authorizationHeader: string | undefined, providerId: string): ControllerResponse
      export function handleUpdateProviderProfile(service: ProviderProfileService, authorizationHeader: string | undefined, providerId: string, requestBody: unknown): ControllerResponse
      export function handleGetPublicProviderProfile(service: ProviderProfileService, providerId: string): ControllerResponse
      ```
      Auth parsing reuses `verifyAccessToken` from `src/auth/tokenService.ts` (same
      `Authorization: Bearer <token>` convention as `handleGetSession`). Request bodies map
      `business_name`/`description`/`contact_email`/`contact_phone` to the service's
      camelCase `ProviderProfileInput`; responses map back to snake_case, e.g.
      `{ provider_id, business_name, description, contact_email, contact_phone, status }`
      for the managed view and the same shape minus `status` for the public view. Error
      mapping: `ForbiddenProfileAccessError` -> `403 { error: "Forbidden" }`;
      `ProviderApprovalRequiredError` -> `403 { error: err.message }`;
      `ProviderProfileValidationError` -> `400 { errors: { business_name?, description?,
      contact_email?, contact_phone? } }`; `ProviderNotFoundError` -> `404 { error: "Provider
      not found" }`.
    files:
      - src/providers/providerProfileController.ts
    rationale: |
      Keeps the same three-layer split (repository/service/controller) as the existing auth
      code, so routing in `app.ts` stays a thin dispatcher.

  - description: |
      Wire the three new routes into the existing manual dispatcher in `handleRequest`, and
      make the new repository test-overridable the same way `sessionRepository` already is:
      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        providerProfileRepository?: ProviderProfileRepository; // new
      }
      ```
      New routes (matched with a regex since `app.ts` currently only does exact string
      matches on `${method} ${pathname}`):
      ```ts
      const manageMatch = url.pathname.match(/^\/providers\/([^/]+)\/profile$/);
      const publicMatch = url.pathname.match(/^\/providers\/([^/]+)\/public-profile$/);
      // GET  manageMatch  -> handleGetProviderProfile
      // PUT  manageMatch  -> handleUpdateProviderProfile (reads JSON body via readJsonBody)
      // GET  publicMatch  -> handleGetPublicProviderProfile (no auth, no body)
      ```
    files:
      - src/app.ts
    rationale: |
      `app.ts` is the single place that owns routing and dependency construction today;
      adding provider-profile routes here (rather than a second HTTP listener) matches how
      auth/session routes are already wired.

  - description: |
      Failing-first integration tests against the real HTTP server, in the same style as
      `test/login.test.ts` / `test/refresh.test.ts` (a small local `login(baseUrl, username)`
      helper, `startTestServer()`, `fetch`, `node:assert/strict`). Covers AC1-5 and AC9-13
      (see `tests` for the concrete assertions per AC).
    files:
      - test/providerProfile.test.ts
    rationale: |
      Follows the project's existing integration-test convention (real server + `fetch`,
      no mocking of internals) rather than introducing a new test style.

tests:
  - |
    AC1 (view/edit access for an approved provider): log in as `provider1` (seeded
    `approved`), then `GET /providers/user-provider-1/profile` with the bearer token.
    ```ts
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.business_name, "Provider One Services");
    assert.equal(body.contact_email, "contact@providerone.example");
    ```
  - |
    AC2 (valid save is persisted): `PUT /providers/user-provider-1/profile` with a full
    valid body as `provider1`, assert `200`, then `GET` the same endpoint again and assert
    the new values come back (proves persistence, not just an echoed response):
    ```ts
    assert.equal(putRes.status, 200);
    const getBody = await (await fetch(manageUrl, { headers: authHeader })).json();
    assert.equal(getBody.business_name, "Provider One Home Services");
    ```
  - |
    AC3 (valid save is reflected on their profile): immediately after the same successful
    `PUT` above, `GET /providers/user-provider-1/public-profile` (no auth) and assert the
    new values are visible there too:
    ```ts
    const publicBody = await (await fetch(`${server.baseUrl}/providers/user-provider-1/public-profile`)).json();
    assert.equal(publicBody.business_name, "Provider One Home Services");
    ```
  - |
    AC4 (invalid/empty required field shows inline error): `PUT` with `business_name: ""`,
    assert `400` and a field-specific message:
    ```ts
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.errors.business_name, "Business name is required.");
    ```
  - |
    AC5 (invalid save is not persisted): immediately after the AC4 request, `GET` the
    profile again and assert the original seeded value is unchanged:
    ```ts
    const getBody = await (await fetch(manageUrl, { headers: authHeader })).json();
    assert.equal(getBody.business_name, "Provider One Services");
    ```
  - |
    AC6 (keyboard-navigable form fields/labels/errors): NOT TESTABLE IN THIS REPOSITORY.
    This codebase is a plain Node `http` backend service with no HTML/CSS/JS UI of any
    kind (confirmed: no framework, no templates, no client code anywhere under `src/` or
    elsewhere). There is no form to navigate. See `assumptions_or_open_questions` — this
    needs a frontend work item with its own test (e.g. Testing Library `userEvent.tab()`
    assertions on focus order) before it can be verified.
  - |
    AC7 (screen-reader-compatible fields/labels/errors): NOT TESTABLE IN THIS REPOSITORY,
    same reason as AC6 — no UI exists here to attach ARIA roles/labels to or to assert
    against with something like `@testing-library/jest-dom`'s `toHaveAccessibleName`. See
    `assumptions_or_open_questions`.
  - |
    AC8 (WCAG 2.1 AA colour contrast): NOT TESTABLE IN THIS REPOSITORY, same reason as
    AC6/AC7 — no rendered styles exist to run an automated contrast check (e.g. `axe-core`)
    against. See `assumptions_or_open_questions`.
  - |
    AC9 (pending/rejected access denied with explicit message): two tests. Log in as
    `provider3` (seeded `pending`) and as `provider4` (seeded `rejected`), `GET` each own
    profile, assert both get the same explicit message:
    ```ts
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Your provider application must be approved before you can access profile management.");
    ```
  - |
    AC10 (cross-provider access forbidden, no data disclosed): log in as `provider1`
    (approved), attempt `GET` and `PUT` on `user-provider-2`'s (also approved) profile, and
    assert a bare error body with no profile fields present:
    ```ts
    assert.equal(getRes.status, 403);
    assert.deepEqual(await getRes.json(), { error: "Forbidden" });
    assert.equal(putRes.status, 403);
    assert.deepEqual(await putRes.json(), { error: "Forbidden" });
    ```
  - |
    AC11 (invalid contact email/phone format shows inline error): `PUT` with
    `contact_email: "not-an-email"` and `contact_phone: "abc123"`, assert `400` with both
    field errors present:
    ```ts
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.errors.contact_email, "Enter a valid email address.");
    assert.equal(body.errors.contact_phone, "Enter a valid phone number, e.g. +15551234567.");
    ```
  - |
    AC12 (invalid contact format is not saved): immediately after the AC11 request, `GET`
    the profile again and assert the original seeded contact values are unchanged:
    ```ts
    const getBody = await (await fetch(manageUrl, { headers: authHeader })).json();
    assert.equal(getBody.contact_email, "contact@providerone.example");
    ```
  - |
    AC13 (public visibility is immediate, no moderation step): after a valid `PUT`,
    `GET /providers/user-provider-1/public-profile` in the same test (no separate approval
    call in between) and assert the new values are already visible and no `status`/review
    field is present on the public shape:
    ```ts
    const publicBody = await (await fetch(publicUrl)).json();
    assert.equal(publicBody.business_name, "Freshly Updated Name");
    assert.equal("status" in publicBody, false);
    ```
  - |
    AC14 (Cancel discards edits, form reverts to last-saved values): NOT TESTABLE IN THIS
    REPOSITORY — "Cancel" and form state are client-side UI behavior and no frontend exists
    here to hold that state. Backend-wise this plan already guarantees the precondition
    Cancel relies on (a rejected/aborted edit never reaches the server, per AC5/AC12), but
    the discard-and-revert interaction itself needs a frontend work item and its own test
    (e.g. a component test asserting the input's value reverts on Cancel-click without a
    network call). See `assumptions_or_open_questions`.
  - |
    AC15 (navigate-away confirmation dialog for unsaved edits): NOT TESTABLE IN THIS
    REPOSITORY, same reason as AC14 — there is no router/navigation and no
    `beforeunload`/route-guard mechanism in this backend service. Needs a frontend work item
    and its own test (e.g. asserting a route-change is blocked/confirmed when a dirty-form
    flag is set). See `assumptions_or_open_questions`.

assumptions_or_open_questions:
  - |
    This repository contains only a backend Node `http` auth/session service — there is no
    frontend/UI code anywhere in it. ACs 6, 7, 8, 14 and 15 describe browser/UI behavior
    (keyboard navigation, screen-reader compatibility, colour contrast, a Cancel button, and
    a navigate-away confirmation dialog) that cannot be built or tested in this codebase.
    This plan implements the backend API those UI behaviors would call (view/save/validate),
    and explicitly leaves those five ACs as out-of-scope pending a separate frontend work
    item — please confirm whether that frontend already exists elsewhere so this can be
    tracked as a dependency rather than dropped.
  - |
    There is no existing "provider application/approval" model in the codebase — only a
    `provider` user role. This plan introduces `ProviderApplicationStatus` and
    `ProviderProfile` as new, minimal domain concepts sufficient for these ACs. If a real
    provider-application/onboarding entity is being built in a sibling work item under the
    "Provider Profiles & Onboarding" epic, its shape should be reconciled with this one
    rather than having two parallel "is this provider approved" sources of truth.
  - |
    "any other public-facing profile fields" (AC1) is left as just the four explicitly named
    fields — business name, description, contact email, contact phone — since no other
    fields were specified anywhere in the story; nothing speculative was added.
  - |
    The phone format is assumed to be a loose E.164-style pattern (`+` optional, 8-15
    digits, no leading zero) since no exact format was specified. Please confirm the actual
    required format (e.g. must it require the `+` and country code, or allow local formats
    with dashes/spaces/parentheses?).
  - |
    Admins are not given a bypass of the ownership check in this plan — an admin hitting
    `GET/PUT /providers/:id/profile` for someone else's profile gets the same `403
    Forbidden` a peer provider would, since no AC describes an admin-oversight path here.
    Given the parent epic mentions "manual admin approval," an admin view/edit capability
    may be expected eventually but is out of scope for this story's ACs — flagging so it
    isn't accidentally assumed to already exist.
  - |
    Chose new routes `GET/PUT /providers/:id/profile` (authenticated, owner-only) and
    `GET /providers/:id/public-profile` (unauthenticated) since no route naming was
    specified and none of this existed before. Open to renaming if there's a convention from
    another service in this system not visible in this repo.

package_dependencies: []

notes: |
  No new third-party packages are needed — validation is two plain regexes and the existing
  `node:crypto`/`node:http`/`node:test` stack already used throughout the repo covers
  everything else.

  ```mermaid
  flowchart TD
    test[test/providerProfile.test.ts] -->|new integration tests, AC1-5 & AC9-13| testServer[test/testServer.ts]
    testServer --> app[src/app.ts]
    app -->|new GET/PUT profile & GET public-profile routes| controller[src/providers/providerProfileController.ts]
    app --> tokenService[src/auth/tokenService.ts]
    controller -->|Bearer token auth, existing helper| tokenService
    controller --> httpUtils[src/httpUtils.ts]
    controller -->|ownership/approval/validation calls| service[src/providers/providerProfileService.ts]
    service -->|read/write profile| repo[src/providers/providerProfileRepository.ts]
    repo -->|default seed| fixtures[src/providers/fixtures/testProviderProfiles.ts]
    fixtures -->|keyed by provider user id| testUsers[src/users/fixtures/testUsers.ts]

    classDef touched fill:#f96,color:#000
    class test,app,controller,service,repo,fixtures,testUsers touched
  ```

  Layering mirrors the existing auth code exactly: `providerProfileRepository.ts` is the
  in-memory-Map analogue of `SessionRepository`/`UserRepository`; `providerProfileService.ts`
  is the business-rules analogue of `AuthService`; `providerProfileController.ts` is the
  snake_case-wire-format analogue of `authController.ts`; `app.ts` stays the single thin
  dispatcher and dependency root. `tokenService.ts` and `httpUtils.ts` are reused unmodified
  (existing `verifyAccessToken`, `asRecord`, `readJsonBody`, `sendJson`).
