summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is a headless Node `http` API — there
  is no frontend/UI layer, no `localStorage`, and no browser at all. It already implements login,
  refresh, logout, and session lookup via a repository -> service -> controller layering
  (`src/users`, `src/sessions`, `src/auth`), in-memory `Map`-backed repositories, snake_case JSON
  wire format, and `node:test` + raw `fetch` against `startTestServer()`. This plan adds
  registration as the equivalent backend capability for AC1-AC7: a new `POST /auth/register`
  route that validates `name`/`email`/`password`, creates a new user (keyed by email, mirroring
  how login is keyed by `username`), and returns the same token shape as `POST /auth/login` so the
  caller is immediately authenticated — the backend-observable equivalent of "navigated to Home as
  authenticated". Duplicate emails and field-level validation failures return structured `errors`
  instead of creating an account. AC8 ("click the link to Login shows the Login view") is pure
  client-side navigation with no service-layer behaviour to drive in this headless repo, so it is
  called out as out of scope for this codebase (see `assumptions_or_open_questions`) rather than
  invented.
scope:
  - description: |
      Write the failing acceptance tests first in a new file, covering AC1-AC7 against the
      not-yet-existing `POST /auth/register` route. These must fail (404, since the route doesn't
      exist yet) before any implementation is added.
    files:
      - "test/register.test.ts"
    rationale: |
      Establishes the test-first contract before any production code exists, matching the existing
      `test/login.test.ts` style: raw `fetch` against `startTestServer()`, snake_case JSON body,
      optionally injecting a real `UserRepository`/`SessionRepository` instance (as
      `test/login.test.ts` already does with `SessionRepository`) to assert on server-side state
      directly rather than only on the HTTP response.
  - description: |
      Add an optional `name` field to the `User` model so a registered user's name can be stored
      alongside the existing `username`/`passwordHash`/`role` fields, and add a `create` method to
      `UserRepository` to insert a new user into both existing lookup maps.

      ```ts
      // src/users/fixtures/testUsers.ts
      export interface User {
        id: string;
        username: string;
        name?: string;
        passwordHash: string;
        role: Role;
      }
      ```

      ```ts
      // src/users/userRepository.ts
      create(user: User): void {
        this.usersByUsername.set(user.username, user);
        this.usersById.set(user.id, user);
      }
      ```
    files:
      - "src/users/fixtures/testUsers.ts"
      - "src/users/userRepository.ts"
    rationale: |
      `name` is optional so the existing seeded `testUsers` (which have no name) still satisfy the
      `User` type unchanged. `UserRepository.create` is the minimal addition needed to persist a
      newly registered user using the exact same two-map structure `UserRepository` already
      maintains for lookups by username and by id — no new storage mechanism is introduced.
  - description: |
      Add `AuthService.register(name, email, password)`, reusing the existing username-keyed
      uniqueness check (email becomes the new user's `username`, so `findByUsername` doubles as
      the duplicate-email check) and the existing `hashPassword`/session/token issuance already
      used by `login`.

      ```ts
      // src/auth/authService.ts
      export class EmailAlreadyRegisteredError extends Error {
        constructor() {
          super("An account with this email already exists");
        }
      }

      async register(name: string, email: string, password: string, now: number = Date.now()): Promise<LoginResult> {
        if (this.userRepository.findByUsername(email)) {
          throw new EmailAlreadyRegisteredError();
        }
        const passwordHash = await hashPassword(password);
        const user: User = { id: crypto.randomUUID(), username: email, name, passwordHash, role: "customer" };
        this.userRepository.create(user);

        const refreshToken = generateRefreshToken();
        this.sessionRepository.create(user.id, refreshToken, REFRESH_TOKEN_TTL_MS, now);
        const accessToken = issueAccessToken({ userId: user.id, role: user.role }, now);

        return { accessToken, accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
      }
      ```
    files:
      - "src/auth/authService.ts"
    rationale: |
      AC1 requires the new account to "subsequently be used to log in" — since `AuthService.login`
      already looks users up by `username`, storing the submitted email as `username` satisfies
      AC1 with zero changes to `login`. AC2 ("navigated to Home as authenticated") is satisfied by
      returning the same `LoginResult` shape `login` returns, so the caller already holds a valid
      access/refresh token pair after registering, exactly like after a login. AC3/AC4 (duplicate
      email) reuse the existing `findByUsername` map lookup rather than adding a second index.
  - description: |
      Add `handleRegister` to the auth controller: field-level validation for `name`/`email`/
      `password` (AC5, AC6, AC7), and mapping `EmailAlreadyRegisteredError` to a `409` with an
      inline field error (AC3, AC4).

      ```ts
      // src/auth/authController.ts
      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      export async function handleRegister(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
        const { name, email, password } = asRecord(requestBody);
        const errors: Record<string, string> = {};

        if (typeof name !== "string" || name.trim() === "") errors.name = "name is required";
        if (typeof email !== "string" || email.trim() === "") errors.email = "email is required";
        else if (!EMAIL_REGEX.test(email)) errors.email = "email must be a valid email address";
        if (typeof password !== "string" || password.length === 0) errors.password = "password is required";

        if (Object.keys(errors).length > 0) {
          return { status: 400, body: { errors } };
        }

        try {
          const result = await authService.register(name as string, email as string, password as string);
          return {
            status: 201,
            body: {
              access_token: result.accessToken,
              expires_in: result.accessTokenExpiresInSeconds,
              refresh_token: result.refreshToken,
              token_type: "Bearer",
            },
          };
        } catch (err) {
          if (err instanceof EmailAlreadyRegisteredError) {
            return { status: 409, body: { errors: { email: err.message } } };
          }
          throw err;
        }
      }
      ```
    files:
      - "src/auth/authController.ts"
    rationale: |
      Keeps HTTP-shape concerns (status codes, the `errors` object keyed by field name, snake_case
      body) in the controller only, exactly like `handleLogin`/`handleRefresh` already do, so
      `AuthService` stays HTTP-agnostic. Validation runs before calling `authService.register` so
      an invalid submission never reaches the repository (AC7: "submission is blocked").
  - description: |
      Wire `POST /auth/register` into the route table in `src/app.ts`, next to the existing
      `POST /auth/login` handling.

      ```ts
      if (route === "POST /auth/register") {
        const result = await handleRegister(authService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```

      and add `"POST /auth/register"` to the existing `route !== ...` 404 guard list alongside
      `"POST /auth/login"`, `"POST /auth/refresh"`, `"POST /auth/logout"`, `"POST /cart/items"`.
    files:
      - "src/app.ts"
    rationale: |
      `createApp`/`handleRequest` is the single composition root and route dispatcher for every
      existing endpoint (auth, cart, pizzas) - the new route must be added there rather than
      starting a second dispatch path.
tests:
  - |
    AC1 - registering with a valid name, email, and password creates an account that can
    subsequently log in.
    ```ts
    test("AC1: registering creates an account that can subsequently log in", async () => {
      const server = await startTestServer();
      try {
        const registerRes = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "test-password" }),
        });
        assert.equal(registerRes.status, 201);

        const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "ada@example.com", password: "test-password" }),
        });
        assert.equal(loginRes.status, 200);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - registering navigates to Home as authenticated. Translated for this headless API as: the
    tokens returned by registration are immediately valid against the existing session endpoint.
    ```ts
    test("AC2: a successful registration returns a token that is immediately authenticated", async () => {
      const server = await startTestServer();
      try {
        const registerRes = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Grace Hopper", email: "grace@example.com", password: "test-password" }),
        });
        const { access_token: accessToken } = (await registerRes.json()) as { access_token: string };

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
    AC3/AC4 - a duplicate email is rejected with an inline error and no duplicate account is
    created (verified by asserting the stored user's id is unchanged after the rejected attempt).
    ```ts
    test("AC3/AC4: a duplicate email is rejected and no duplicate account is created", async () => {
      const userRepository = new UserRepository();
      const server = await startTestServer({ userRepository });
      try {
        const payload = { name: "Ada Lovelace", email: "dup@example.com", password: "test-password" };
        const first = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        assert.equal(first.status, 201);
        const firstUserId = userRepository.findByUsername("dup@example.com")!.id;

        const second = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, name: "Someone Else" }),
        });
        assert.equal(second.status, 409);
        const body = (await second.json()) as { errors: { email: string } };
        assert.equal(body.errors.email, "An account with this email already exists");
        assert.equal(userRepository.findByUsername("dup@example.com")!.id, firstUserId);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 - a required field left empty produces a field-level validation error for that field.
    ```ts
    test("AC5: a required field left empty produces a field-level validation error", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "", email: "missingname@example.com", password: "test-password" }),
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { errors: { name?: string } };
        assert.equal(body.errors.name, "name is required");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 - an invalid email format produces a field-level validation error for the email field.
    ```ts
    test("AC6: an invalid email format produces a field-level validation error on the email field", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Ada Lovelace", email: "not-an-email", password: "test-password" }),
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { errors: { email?: string } };
        assert.equal(body.errors.email, "email must be a valid email address");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 - invalid input (empty required field, or invalid email format) blocks submission: no
    account is created for either case.
    ```ts
    test("AC7: invalid submissions are blocked and create no account", async () => {
      const userRepository = new UserRepository();
      const server = await startTestServer({ userRepository });
      try {
        await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "", email: "blocked@example.com", password: "test-password" }),
        });
        await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Ada", email: "not-an-email", password: "test-password" }),
        });
        assert.equal(userRepository.findByUsername("blocked@example.com"), undefined);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC8 - clicking the link to Login shows the Login view. This repo has no frontend/UI layer at
    all (see `assumptions_or_open_questions`), so there is no service-layer behaviour to drive here
    and no test is written for it as part of this backend plan.
assumptions_or_open_questions:
  - "This repo is a headless HTTP API with no frontend/UI/localStorage layer at all (confirmed by reading every file under src/ and test/), so, mirroring how the already-merged Pizza Customisation plan translated 'screen' ACs into API contracts, every 'view'-phrased AC here is translated into an equivalent API behaviour: 'Register view submit' -> `POST /auth/register`, 'navigated to Home as authenticated' -> the returned tokens are valid against `GET /auth/session`, and 'existing in localStorage' -> existing in the in-memory `UserRepository` (the same no-DB, no-browser storage every other domain in this repo already uses). Please confirm this translation, or point to where an actual UI layer should live."
  - "AC8 ('click the link to Login shows the Login view') is pure client-side navigation with no backend-observable behaviour in a headless API repo, so it is treated as out of scope for this plan rather than invented as a fake endpoint. Flagging for reviewer confirmation."
  - "The submitted email becomes the new user's `username` (the same field `AuthService.login` already authenticates against), since the existing User model has no separate `email` field and the story doesn't say registration and login use different identifiers. This means AC1's 'subsequently be used to log in' is satisfied via the existing `POST /auth/login` username/password contract with email-as-username."
  - "A newly registered user is assigned the `customer` role by default, since the story describes a general-public signup flow and every other role (`provider`, `admin`) in the existing fixtures is a fixed seed, not something a registration form assigns."
  - "No password strength/minimum-length rule is enforced beyond 'required', since no AC specifies one."
  - "Duplicate-email and field-validation error responses use a new `{ errors: { <field>: <message> } }` body shape (distinct from the existing single `{ error: <message> }` shape used by login/refresh/logout), since AC3, AC5, and AC6 all require a validation error attributable to a specific field, which the existing flat `error` shape cannot express. Duplicate email is returned as HTTP 409 (Conflict) rather than 400, to distinguish 'well-formed but already taken' from 'malformed input'."
package_dependencies: []
notes: |
  Layering/call-graph for the touched modules, plus their existing real callers/callees read while
  planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: route + composition)"]
    authController["src/auth/authController.ts (modified: handleRegister)"]
    authService["src/auth/authService.ts (modified: register())"]
    userRepository["src/users/userRepository.ts (modified: create())"]
    userFixtures["src/users/fixtures/testUsers.ts (modified: name field)"]
    sessionRepository["src/sessions/sessionRepository.ts (existing, untouched)"]
    tokenService["src/auth/tokenService.ts (existing, untouched)"]
    passwordHasher["src/auth/passwordHasher.ts (existing, untouched)"]
    httpUtils["src/httpUtils.ts (existing, untouched)"]
    testFile["test/register.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes POST /auth/register"| authController
    authController -->|"asRecord()/body parsing"| httpUtils
    authController -->|"register()"| authService
    authService -->|"findByUsername()/create() - email as username"| userRepository
    authService -->|"hashPassword()"| passwordHasher
    authService -->|"create() - new session on success"| sessionRepository
    authService -->|"issueAccessToken()"| tokenService
    userRepository -->|"seeds from"| userFixtures
    testFile -->|"drives via fetch()"| app
    testFile -->|"startTestServer(), injects UserRepository"| testServer

    classDef touched fill:#f96,color:#000
    class app,authController,authService,userRepository,userFixtures,testFile touched
  ```
