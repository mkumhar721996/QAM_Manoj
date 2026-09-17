summary: |
  This repo is a headless Node `http` API (`src/app.ts`/`src/server.ts`) with `auth/`, `sessions/`,
  `users/` modules already fully implementing login + session persistence under a prior story
  (STORY-007): `POST /auth/login` issues a JWT access token plus an opaque refresh token backed by
  `SessionRepository`, `POST /auth/refresh` renews the access token, and `GET /auth/session`
  validates it. There is no frontend/UI layer anywhere in this codebase (`src/design-system/` is a
  static style-guide/token library only, not a rendered app) and no Register or Forgot-Password
  route/view of any kind. This plan for STORY-078 ("Login View") therefore does two things: (1) adds
  a dedicated pinning test file, `test/loginView.test.ts`, that drives this story's own AC1-AC6
  through the existing HTTP contract (most of which already pass with zero production changes,
  since STORY-007 already built the underlying auth/session behaviour), and (2) fixes one real gap
  the new ACs expose - today an empty-string `username`/`password` in `POST /auth/login` silently
  falls through to a generic 401 "wrong credentials" response instead of a 400 field-level
  validation error, so AC5 (submission blocked) and AC6 (inline feedback per empty field) are not
  actually satisfied yet. AC2, AC7 and AC8 describe navigating between views (Home, Register, Forgot
  Password) that literally do not exist as artifacts in this codebase; those are called out as open
  questions rather than guessed at.
scope:
  - description: |
      Write this story's own failing/pinning test file against the existing `POST /auth/login`,
      `POST /auth/refresh`, and `GET /auth/session` endpoints, following the exact style of the
      existing `test/login.test.ts` / `test/refresh.test.ts` (raw `fetch()` against
      `startTestServer()`, `node:test` + `node:assert/strict`). Kept in its own file rather than
      appended to `test/login.test.ts` so this story's AC numbering (AC1-AC6 below) doesn't collide
      with STORY-007's own AC1-AC13 in that file.
    files:
      - "test/loginView.test.ts"
    rationale: |
      Establishes the test-first contract for every AC in this story before any production code
      changes for it are made. AC1/AC3/AC4 are expected to pass immediately (STORY-007 already
      implemented that behaviour) - they are pinning tests for this story's explicit AC list, not
      new behaviour. AC5/AC6 are expected to fail until the validation fix below is made.
  - description: |
      Fix `handleLogin` in `src/auth/authController.ts` so an empty (or whitespace-only) `username`
      or `password` is treated as a missing required field - returning a `400` with a per-field
      `errors` map - instead of falling through to `AuthService.login()` and coming back as a
      generic `401 Invalid username or password`.

      Before:
      ```ts
      export async function handleLogin(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
        const { username, password } = asRecord(requestBody);

        if (typeof username !== "string" || typeof password !== "string") {
          return { status: 400, body: { error: "username and password are required" } };
        }
        ...
      ```

      After:
      ```ts
      export async function handleLogin(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
        const { username, password } = asRecord(requestBody);

        const fieldErrors: Record<string, string> = {};
        if (typeof username !== "string" || username.trim() === "") {
          fieldErrors.username = "This field is required";
        }
        if (typeof password !== "string" || password.trim() === "") {
          fieldErrors.password = "This field is required";
        }
        if (Object.keys(fieldErrors).length > 0) {
          return { status: 400, body: { errors: fieldErrors } };
        }
        ...
      ```

      The `401 Invalid username or password` path for a non-empty-but-wrong username/password is
      untouched, so AC3/AC4's generic (non-field-specific) error message is preserved.
    files:
      - "src/auth/authController.ts"
    rationale: |
      AC5 requires that empty required fields block submission, and AC6 requires inline feedback
      identifying *which* fields are empty. The existing `typeof !== "string"` guard only rejects a
      missing/non-string field, not an empty string, so today `{ username: "", password: "" }`
      reaches `AuthService.login()` and is indistinguishable from a genuine wrong-password attempt
      (401, single generic message) - which cannot drive per-field inline validation UI. No test in
      `test/login.test.ts`/`test/refresh.test.ts`/`test/logout.test.ts` asserts the old
      `{ error: "username and password are required" }` shape (confirmed by search), so this is a
      safe, additive change to the 400 response shape for the missing-field case only.
tests:
  - |
    AC1 - GIVEN the Login view is displayed WHEN the user submits a registered email and correct
    password THEN the user remains authenticated if the page is reloaded.

    Translated to the existing refresh-token contract: a "reload" is simulated by using only the
    persisted `refresh_token` (no re-submitted credentials) to obtain a fresh access token and then
    successfully calling the protected session endpoint. This already passes with the current
    `AuthService`/`SessionRepository` implementation (STORY-007); this is a pinning test.

    ```ts
    test("AC1: a valid login keeps the user authenticated after a simulated reload", async () => {
      const server = await startTestServer();
      try {
        const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
        });
        assert.equal(loginRes.status, 200);
        const { refresh_token: refreshToken } = (await loginRes.json()) as { refresh_token: string };

        // Simulate a page reload: only the persisted refresh token is available, no credentials.
        const reloadRes = await fetch(`${server.baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        assert.equal(reloadRes.status, 200);
        const { access_token: accessToken } = (await reloadRes.json()) as { access_token: string };

        const sessionRes = await fetch(`${server.baseUrl}/auth/session`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        assert.equal(sessionRes.status, 200);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - GIVEN the Login view is displayed WHEN the user submits a registered email and correct
    password THEN the user is navigated to the Home view.

    There is no Home view or router in this codebase to navigate to, so this is translated into the
    narrowest thing this repo can actually assert: a successful login returns everything a client
    would need to perform that navigation. This already passes; it is a pinning test, and does not
    claim to cover real navigation (see `assumptions_or_open_questions`).

    ```ts
    test("AC2: a successful login response contains what a client needs to route to Home", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(typeof body.access_token, "string");
        assert.equal(typeof body.refresh_token, "string");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN the Login view is displayed WHEN the user submits an unrecognised email or wrong
    password THEN an error message is shown.

    Already implemented by `AuthService.login()` / `handleLogin` (STORY-007); pinning test for this
    story.

    ```ts
    test("AC3: an unrecognised username or wrong password returns an error message", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "customer1", password: "wrong-password" }),
        });
        assert.equal(res.status, 401);
        const body = (await res.json()) as { error: string };
        assert.equal(body.error, "Invalid username or password");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN the Login view is displayed WHEN the user submits an unrecognised email or wrong
    password THEN the user is not navigated to the Home view and is not authenticated if the page is
    reloaded.

    Translated to: no tokens are returned and no session is created, so there is nothing for a
    "reload" to authenticate with. Already implemented (mirrors STORY-007's own AC8); pinning test.

    ```ts
    test("AC4: a failed login issues no tokens and creates no session", async () => {
      const sessionRepository = new SessionRepository();
      const server = await startTestServer({ sessionRepository });
      try {
        const res = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "customer1", password: "wrong-password" }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.access_token, undefined);
        assert.equal(body.refresh_token, undefined);
        assert.equal(sessionRepository.countByUserId("user-customer-1"), 0);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 - GIVEN the Login view is displayed WHEN required fields are empty and the user attempts to
    submit THEN submission is blocked.

    Fails today: an empty string passes the current `typeof !== "string"` guard and falls through to
    a 401 from `AuthService.login()` rather than being rejected as a validation failure. Fixed by the
    `authController.ts` change above.

    ```ts
    test("AC5: submitting with empty username or password is blocked, not authenticated", async () => {
      const sessionRepository = new SessionRepository();
      const server = await startTestServer({ sessionRepository });
      try {
        const res = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "", password: "" }),
        });
        assert.equal(res.status, 400);
        assert.equal(sessionRepository.countByUserId("user-customer-1"), 0);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 - GIVEN the Login view is displayed WHEN required fields are empty and the user attempts to
    submit THEN inline validation feedback is shown for the empty fields.

    Fails today for the same reason as AC5, and additionally because even the existing 400 path
    returns one generic message, not a per-field map. Fixed by the same `authController.ts` change.

    ```ts
    test("AC6: the validation error identifies exactly which fields are empty", async () => {
      const server = await startTestServer();
      try {
        const bothEmpty = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "", password: "" }),
        });
        const bothBody = (await bothEmpty.json()) as { errors: Record<string, string> };
        assert.equal(typeof bothBody.errors.username, "string");
        assert.equal(typeof bothBody.errors.password, "string");

        const onlyPasswordEmpty = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "customer1", password: "" }),
        });
        const partialBody = (await onlyPasswordEmpty.json()) as { errors: Record<string, string> };
        assert.equal("username" in partialBody.errors, false);
        assert.equal(typeof partialBody.errors.password, "string");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 - GIVEN the Login view is displayed WHEN the user clicks the link to Register THEN the
    Register view is shown.

    Not implementable in this repo as it stands: there is no Register view, route, or any related
    code anywhere in the codebase. No test is written for this AC in this plan - see
    `assumptions_or_open_questions` for the question this raises for the reviewer.
  - |
    AC8 - GIVEN the Login view is displayed WHEN the user clicks 'Forgot password' THEN the Forgot
    Password view is shown.

    Not implementable in this repo as it stands, for the same reason as AC7: there is no Forgot
    Password view, route, or any related code anywhere in the codebase. No test is written for this
    AC in this plan - see `assumptions_or_open_questions`.
assumptions_or_open_questions:
  - "This repo is a headless HTTP API with no frontend/UI layer at all (src/design-system/ is a static token/style-guide library, not a rendered app, and there is no router or page/view code anywhere). AC2's 'navigated to the Home view' is translated to 'the success response contains what a client would need to navigate' (already true, pinning test only) - it cannot actually verify navigation. Please confirm this translation is acceptable, or point to where a real UI layer for this product is supposed to live."
  - "AC7 (Register link) and AC8 (Forgot password link) cannot be implemented or tested at all in this codebase today: there is no Register view/route and no Forgot Password view/route anywhere, and building those views is out of scope for a 'Login View' story. This plan deliberately does not write tests or stub routes for AC7/AC8. Please confirm whether these two ACs should be dropped from this story until the Register/Forgot-Password stories exist, or whether you want placeholder routes added now."
  - "The ACs say 'registered email', but the existing User model/repository (src/users/fixtures/testUsers.ts, src/users/userRepository.ts) and the whole login/session wire contract shipped under STORY-007 identify users by `username` (e.g. 'customer1'), not email - there is no email field anywhere in the codebase. This plan assumes 'email' in the ACs is just descriptive language for the existing unique login identifier field, not a request to add a real email field/format validation, since renaming the wire field would risk regressing the already-shipped STORY-007 tests (test/login.test.ts, test/refresh.test.ts, test/logout.test.ts) and no AC asks for email-format validation. Please confirm."
  - "'This field is required' was chosen as the per-field inline-validation message text for AC6 since no copy was specified; happy to change it to match whatever copy convention the reviewer wants."
package_dependencies: []
notes: |
  AC1, AC2, AC3, AC4 are expected to pass with zero production-code changes - STORY-007 already
  built and tested the underlying login/refresh/session behaviour; the tests added here exist to
  pin those ACs specifically for this story (078), under their own AC numbering, in their own file
  (`test/loginView.test.ts`) so they don't collide with STORY-007's own AC1-AC13 already living in
  `test/login.test.ts`/`test/refresh.test.ts`/`test/logout.test.ts`. Only AC5/AC6 require the
  `authController.ts` change. No mermaid diagram is included since the change set is one production
  file (`src/auth/authController.ts`) plus one new test file, with no new module boundaries or
  cross-layer calls introduced.
