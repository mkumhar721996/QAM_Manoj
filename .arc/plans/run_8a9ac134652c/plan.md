summary: |
  Add a provider self-registration endpoint to the existing headless auth
  service, following the same controller -> service -> repository shape
  already used by login/refresh/logout (src/auth/authController.ts,
  src/auth/authService.ts, src/users/userRepository.ts). A new
  `POST /auth/register` route accepts name/email/password, performs
  field-level validation, rejects emails that already have an account,
  creates a "provider"-role user, and immediately logs the new account in
  by issuing the same access/refresh token pair login does, plus a
  `next_step` field the client can use to route to credential submission.
  This covers AC1-7. AC8-10 (keyboard operability, screen reader
  announcements, colour-contrast) describe a rendered UI, and this
  repository has no view layer at all today (no HTML/CSS/JS, no browser
  test tooling, only a raw `node:http` JSON API exercised via `fetch` in
  node:test) — see assumptions_or_open_questions for how this is handled.

scope:
  - description: |
      Extend the `User` model with an optional `name` field, and teach
      `UserRepository` to create a user (generating its own id, mirroring
      `SessionRepository.create`), so the registration service has
      somewhere to persist new provider accounts.

      Before/after for `UserRepository`:
      ```ts
      // before
      export class UserRepository {
        private usersByUsername: Map<string, User>;
        private usersById: Map<string, User>;
        constructor(users: User[] = testUsers) { ... }
        findByUsername(username: string): User | undefined { ... }
        findById(userId: string): User | undefined { ... }
      }

      // after
      export class UserRepository {
        private usersByUsername: Map<string, User>;
        private usersById: Map<string, User>;
        constructor(users: User[] = testUsers) { ... }
        findByUsername(username: string): User | undefined { ... }
        findById(userId: string): User | undefined { ... }

        create(input: { username: string; passwordHash: string; role: Role; name?: string }): User {
          const user: User = { id: crypto.randomUUID(), ...input };
          this.usersByUsername.set(user.username, user);
          this.usersById.set(user.id, user);
          return user;
        }
      }
      ```
    files:
      - src/users/fixtures/testUsers.ts
      - src/users/userRepository.ts
    rationale: |
      Self-registered providers need a unique id and to be findable by the
      identifier they'll later log in with. Generating the id inside the
      repository mirrors the existing `SessionRepository.create` pattern
      instead of inventing a new convention. `name` is optional on `User`
      so existing seeded test users (which have no name) still type-check
      unchanged.

  - description: |
      There is no separate `email` column in the existing `User` model.
      Rather than widen the schema, self-registered providers store their
      normalized (trimmed, lower-cased) email address in the existing
      `username` field, which is already the unique login identifier keyed
      by `UserRepository`. This lets AC4/AC5's "email already associated
      with an account" check reuse `findByUsername` with no new index.
    files: []
    rationale: |
      Minimal change: avoids adding an `email` field/index that would only
      duplicate what `username` already does as a unique key, for a story
      that doesn't otherwise need multiple identifiers per user.

  - description: |
      New validation module for the registration form fields, returning
      one message per invalid field so the controller can hand back
      field-adjacent errors (AC6).
      ```ts
      export interface RegistrationErrors {
        name?: string;
        email?: string;
        password?: string;
      }

      function validateNewCredential(credential: unknown): string | undefined {
        if (typeof credential !== "string" || credential.length === 0) {
          return "Password is required";
        }
        if (credential.length < 8) {
          return "Password must be at least 8 characters";
        }
        return undefined;
      }

      export function validateRegistrationInput(input: {
        name: unknown;
        email: unknown;
        password: unknown;
      }): RegistrationErrors {
        const errors: RegistrationErrors = {};
        const credentialMessage = validateNewCredential(input.password);
        if (typeof input.name !== "string" || input.name.trim().length === 0) {
          errors.name = "Name is required";
        }
        if (typeof input.email !== "string" || input.email.trim().length === 0) {
          errors.email = "Email is required";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
          errors.email = "Enter a valid email address";
        }
        if (credentialMessage) {
          errors.password = credentialMessage;
        }
        return errors;
      }
      ```
    files:
      - src/auth/registrationValidation.ts
    rationale: |
      Keeps format/required-field validation testable in isolation and out
      of the controller/service, matching this repo's existing separation
      (controller does presence/shape checks, service does business rules).

  - description: |
      Add `AuthService.register(name, email, password, now?)` alongside
      the existing `login`/`refresh`/`logout` methods, reusing
      `hashPassword`, `generateRefreshToken`, `issueAccessToken`, and
      `SessionRepository.create` exactly as `login` does today.
      ```ts
      export const EMAIL_ALREADY_REGISTERED_MESSAGE = "An account with this email already exists";

      export class EmailAlreadyRegisteredError extends Error {
        constructor() {
          super(EMAIL_ALREADY_REGISTERED_MESSAGE);
        }
      }

      // in class AuthService
      async register(name: string, email: string, password: string, now: number = Date.now()): Promise<LoginResult> {
        const normalizedEmail = email.trim().toLowerCase();
        if (this.userRepository.findByUsername(normalizedEmail)) {
          throw new EmailAlreadyRegisteredError();
        }

        const passwordHash = await hashPassword(password);
        const user = this.userRepository.create({
          username: normalizedEmail,
          passwordHash,
          role: "provider",
          name: name.trim(),
        });

        const refreshToken = generateRefreshToken();
        this.sessionRepository.create(user.id, refreshToken, REFRESH_TOKEN_TTL_MS, now);
        const accessToken = issueAccessToken({ userId: user.id, role: user.role }, now);

        return { accessToken, accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
      }
      ```
    files:
      - src/auth/authService.ts
    rationale: |
      Registration and login end in the same place (an authenticated
      session), so reusing `LoginResult`/token issuance avoids a parallel
      "register result" type and keeps AC2 (registration logs the user in)
      trivially true by construction rather than by extra glue code.

  - description: |
      Add `handleRegister` to the controller, wiring validation errors to
      400, duplicate email to 409, and success to 201 with the login
      token payload plus a `next_step` field for AC3.
      ```ts
      export async function handleRegister(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
        const { name, email, password } = asRecord(requestBody);
        const errors = validateRegistrationInput({ name, email, password });
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
              next_step: "credential_submission",
            },
          };
        } catch (err) {
          if (err instanceof EmailAlreadyRegisteredError) {
            return { status: 409, body: { error: err.message } };
          }
          throw err;
        }
      }
      ```
    files:
      - src/auth/authController.ts
    rationale: |
      Mirrors `handleLogin`'s shape (parse -> validate -> call service ->
      map known errors to status codes) so a reader familiar with login
      can follow registration without learning a new pattern.

  - description: |
      Wire `POST /auth/register` into the router alongside the other
      `/auth/*` routes.
      ```ts
      if (
        route !== "POST /auth/login" &&
        route !== "POST /auth/register" &&
        route !== "POST /auth/refresh" &&
        route !== "POST /auth/logout"
      ) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const body = await readJsonBody(req);
      if (route === "POST /auth/register") {
        const result = await handleRegister(authService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - src/app.ts
    rationale: |
      `createApp` already threads `userRepository`/`sessionRepository`
      dependencies through to `AuthService`, so no new dependency-injection
      plumbing is needed — only the route dispatch changes.

  - description: |
      New test file covering AC1-7 against the real HTTP server, in the
      same style as test/login.test.ts (start a real server via
      `startTestServer`, `fetch` the route, assert on status/body and on
      injected repositories).
    files:
      - test/register.test.ts
    rationale: |
      Matches this repo's existing black-box HTTP test convention rather
      than introducing unit tests of the service/controller in isolation.

tests:
  - |
    AC1 (account created for that email): in test/register.test.ts —
    ```ts
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Provider", email: "ada@example.com", password: "test-password-1" }),
    });
    assert.equal(res.status, 201);
    const created = userRepository.findByUsername("ada@example.com");
    assert.equal(created?.role, "provider");
    assert.equal(created?.name, "Ada Provider");
    ```
    Fails today because `POST /auth/register` doesn't exist (404). Passes once
    `handleRegister`/`AuthService.register`/`UserRepository.create` land.
  - |
    AC2 (visitor is logged in): after registering, call the token straight
    into the existing session-lookup route:
    ```ts
    const sessionRes = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    assert.equal(sessionRes.status, 200);
    assert.equal((await sessionRes.json()).role, "provider");
    ```
  - |
    AC3 (directed to the credential submission step):
    ```ts
    const body = (await res.json()) as { next_step: string };
    assert.equal(body.next_step, "credential_submission");
    ```
  - |
    AC4 (duplicate email shows an error): register once, then again with the
    same email:
    ```ts
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "An account with this email already exists");
    ```
  - |
    AC5 (no duplicate account created): after the duplicate attempt above,
    assert the original record is untouched:
    ```ts
    const after = userRepository.findByUsername(email);
    assert.equal(after?.id, original?.id);
    assert.equal(after?.name, "First Provider");
    ```
  - |
    AC6 (inline, field-adjacent validation errors): submit blank name,
    malformed email, short password in one request:
    ```ts
    const body = (await res.json()) as { errors: Record<string, string> };
    assert.equal(body.errors.name, "Name is required");
    assert.equal(body.errors.email, "Enter a valid email address");
    assert.equal(body.errors.password, "Password must be at least 8 characters");
    ```
  - |
    AC7 (form not submitted on invalid input): same invalid request as AC6,
    then assert nothing was persisted and no session token was issued:
    ```ts
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.access_token, undefined);
    assert.equal(userRepository.findByUsername("invalid@example.com"), undefined);
    ```
  - |
    AC8 (keyboard operability of the registration form): NOT implemented or
    tested by this plan. This repository has no rendered form — it is a
    headless JSON API (see src/app.ts, src/server.ts; every existing test
    drives the service via `fetch` against JSON routes, never a browser or
    DOM). There is nothing here for a keyboard to navigate. See
    assumptions_or_open_questions.
  - |
    AC9 (screen reader announces fields/labels/errors correctly): NOT
    implemented or tested here for the same reason as AC8 — no HTML is
    rendered by this service. See assumptions_or_open_questions.
  - |
    AC10 (WCAG 2.1 AA colour contrast): NOT implemented or tested here for
    the same reason as AC8/AC9 — there is no CSS/visual layer in this
    repository to measure contrast against. See assumptions_or_open_questions.

assumptions_or_open_questions:
  - |
    Biggest open question: AC8, AC9, and AC10 describe a rendered,
    keyboard/screen-reader/colour-contrast-tested registration form, but
    this repository (as seen in src/app.ts, src/server.ts, and every test
    under test/) is a headless `node:http` JSON API with no HTML, CSS, JS,
    or browser-testing tooling (no Playwright/jsdom/axe-core, no static
    file serving). Implementing those three ACs for real would mean
    standing up an entire new frontend stack in what is currently a pure
    auth microservice — that's out of proportion to "the minimal code to
    pass a failing test" and isn't hinted at anywhere in the existing
    code. This plan implements and tests AC1-7 (the account-creation/
    login/validation contract a UI would call) and leaves AC8-10 as an
    explicit gap. Please confirm: is the registration UI a separate
    frontend work item/repo (in which case AC8-10 belong there), or is a
    server-rendered form expected to land in this same service?
  - |
    Password strength policy isn't specified by the story ("a valid...
    password"). Assumed a minimum of 8 characters, with no other
    complexity rules, since nothing stronger is implied and the codebase
    has no existing password-policy precedent to match.
  - |
    Self-registered accounts are always created with role "provider" (no
    role field in the request), since this story is specifically
    provider self-registration per its title and epic.
  - |
    No separate `email` column was added to `User` — the normalized
    (trimmed, lower-cased) email is stored in the existing `username`
    field, which is already the unique key `UserRepository` looks users up
    by. If a later story needs to distinguish "username" from "email" as
    separate concepts, this will need revisiting.
  - |
    "Directed to the credential submission step" (AC3) is implemented as
    a `next_step: "credential_submission"` field in the JSON response
    body, since this backend has no server-side routing/redirect concept
    to "direct" a visitor with — actual navigation is left to whatever
    client consumes this API.

package_dependencies: []

notes: |
  This plan reuses every existing building block (token issuance,
  password hashing, session creation) rather than adding new ones — no
  new third-party packages are needed.

  ```mermaid
  flowchart TD
    app["src/app.ts\n(route dispatch)"]
    controller["src/auth/authController.ts\nhandleRegister"]
    service["src/auth/authService.ts\nAuthService.register"]
    validation["src/auth/registrationValidation.ts\nvalidateRegistrationInput"]
    userRepo["src/users/userRepository.ts\nUserRepository.create/findByUsername"]
    userModel["src/users/fixtures/testUsers.ts\nUser type (+name)"]
    sessionRepo["src/sessions/sessionRepository.ts\n(unchanged, reused)"]
    tokenSvc["src/auth/tokenService.ts\n(unchanged, reused)"]
    passwordHasher["src/auth/passwordHasher.ts\n(unchanged, reused)"]
    tests["test/register.test.ts"]

    app -->|"new POST /auth/register route"| controller
    controller -->|"field format/required checks"| validation
    controller -->|"business logic call"| service
    service -->|"duplicate-email check + create user"| userRepo
    userRepo -->|"typed by"| userModel
    service -->|"issue session, same as login"| sessionRepo
    service -->|"hash password, issue access token"| tokenSvc
    service --> passwordHasher
    tests -->|"exercises via fetch"| app

    classDef touched fill:#f96,color:#000
    class app,controller,service,validation,userRepo,userModel,tests touched
  ```
