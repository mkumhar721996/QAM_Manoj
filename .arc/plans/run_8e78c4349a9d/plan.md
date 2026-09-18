summary: |
  Add Facebook OAuth as a registration and login method to the existing JSON API backend
  (`src/auth/*`, `src/sessions/*`, `src/users/*`). A new `POST /auth/facebook` endpoint accepts a
  Facebook OAuth authorization code, exchanges it (via a new, injectable `FacebookOAuthClient`)
  for the user's Facebook profile, then either creates a new password-less account or logs the
  user into their existing Facebook-linked account, issuing the same access/refresh token pair
  the existing `/auth/login` flow issues. This repo has no view/rendering layer today — `src/app.ts`
  only routes JSON requests — so this plan implements the backend contract the approved prototype's
  screens depend on (which fields are requested/captured, what distinguishes "new account" from
  "returning user", the fact that no username/password is ever required), not the screens
  themselves, since building those is out of scope for this codebase and was already done in the
  prototype.
scope:
  - description: |
      Extend the `User` domain type so an account can exist with only a Facebook identity and no
      password, and add the fields the approved design's consent screen says are requested:
      name, email, and profile photo (`.arc/designs/QAM-MANOJ-STORY-048-design.html`, screen
      "Facebook Consent (simulated)", `<ul class="permission-list">`: "Your name and profile
      photo" / "Your email address").

      Before:
      ```ts
      export interface User {
        id: string;
        username: string;
        passwordHash: string;
        role: Role;
      }
      ```
      After:
      ```ts
      export interface User {
        id: string;
        role: Role;
        username?: string;
        passwordHash?: string;
        facebookId?: string;
        name?: string;
        email?: string;
        avatarUrl?: string | null;
      }
      ```
    files:
      - src/users/fixtures/testUsers.ts
    rationale: |
      `username`/`passwordHash` are only meaningful for the pre-existing password-based accounts
      from STORY-007; Facebook-only accounts (this story) never set them. Existing `testUsers`
      fixtures are unaffected since the added fields are optional.
  - description: |
      Add lookup-by-Facebook-id and runtime account creation to `UserRepository`, which today is
      built once from a fixed fixture array and has no write path.

      Before:
      ```ts
      export class UserRepository {
        private usersByUsername: Map<string, User>;
        private usersById: Map<string, User>;
        constructor(users: User[] = testUsers) { ... }
        findByUsername(username: string): User | undefined { ... }
        findById(userId: string): User | undefined { ... }
      }
      ```
      After: add `private usersByFacebookId: Map<string, User>` (built by filtering
      `users.filter(u => u.facebookId)`), plus:
      ```ts
      findByFacebookId(facebookId: string): User | undefined {
        return this.usersByFacebookId.get(facebookId);
      }

      create(user: User): void {
        this.usersById.set(user.id, user);
        if (user.username) this.usersByUsername.set(user.username, user);
        if (user.facebookId) this.usersByFacebookId.set(user.facebookId, user);
      }
      ```
    files:
      - src/users/userRepository.ts
    rationale: |
      AC1/AC2 require distinguishing "no existing account for this Facebook id" (create) from
      "existing account" (reuse) — `findByFacebookId` is the lookup that decision hinges on, and
      `create` is the only way to persist a newly-registered Facebook account.
  - description: |
      Add a new module defining the Facebook OAuth boundary as an injectable interface (mirrors
      how `UserRepository`/`SessionRepository` are already passed into `AuthService` and swapped
      in tests), plus the real Graph API implementation used outside tests.
      ```ts
      export interface FacebookProfile {
        facebookId: string;
        name: string;
        email: string;
        avatarUrl: string | null;
      }

      export interface FacebookOAuthClient {
        exchangeCodeForProfile(code: string): Promise<FacebookProfile>;
      }

      export class FacebookAuthError extends Error {
        constructor(message = "Facebook sign-in failed") { super(message); }
      }

      export class FacebookGraphOAuthClient implements FacebookOAuthClient {
        // reads FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / FACEBOOK_REDIRECT_URI from process.env
        // at construction time (fail-fast, same pattern as JWT_SECRET in tokenService.ts);
        // exchangeCodeForProfile() calls graph.facebook.com over global fetch() and throws
        // FacebookAuthError on any non-2xx response or malformed profile payload.
      }
      ```
    files:
      - src/auth/facebookOAuthClient.ts
    rationale: |
      Isolating the real network call behind an interface is what makes AC1-AC3 testable without
      hitting Facebook's servers in `npm test`, consistent with this repo's existing DI style
      (`AppDependencies` in `src/app.ts`) and its "no network calls in tests" convention (see
      `test/testServer.ts`).
  - description: |
      Add `AuthService.loginWithFacebook`, the Facebook-equivalent of the existing `login()`
      method, reusing the same session/token issuance path.

      Before:
      ```ts
      constructor(userRepository: UserRepository, sessionRepository: SessionRepository)
      ```
      After:
      ```ts
      constructor(
        userRepository: UserRepository,
        sessionRepository: SessionRepository,
        facebookOAuthClient: FacebookOAuthClient,
      )

      async loginWithFacebook(
        code: string,
        now: number = Date.now(),
      ): Promise<{ result: LoginResult; isNewAccount: boolean; profile: { name: string; email: string } }> {
        let profile: FacebookProfile;
        try {
          profile = await this.facebookOAuthClient.exchangeCodeForProfile(code);
        } catch {
          throw new FacebookAuthError();
        }

        let user = this.userRepository.findByFacebookId(profile.facebookId);
        let isNewAccount = false;
        if (!user) {
          user = {
            id: crypto.randomUUID(),
            role: "customer",
            facebookId: profile.facebookId,
            name: profile.name,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
          };
          this.userRepository.create(user);
          isNewAccount = true;
        }

        const refreshToken = generateRefreshToken();
        this.sessionRepository.create(user.id, refreshToken, REFRESH_TOKEN_TTL_MS, now);
        const accessToken = issueAccessToken({ userId: user.id, role: user.role }, now);

        return {
          result: { accessToken, accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS, refreshToken },
          isNewAccount,
          profile: { name: user.name!, email: user.email! },
        };
      }
      ```
    files:
      - src/auth/authService.ts
    rationale: |
      Mirrors `login()`'s session/token issuance exactly (AC2/AC3: a Facebook-authenticated user
      gets the same kind of session as a password-authenticated one) while branching on
      `findByFacebookId` to satisfy AC1 (create once) and AC2 (reuse thereafter). New accounts
      default to role `customer`, matching every other self-service account in this codebase.
  - description: |
      Add `handleFacebookAuth`, following the existing controller pattern (validate body shape,
      delegate to the service, map known errors to HTTP status).
      ```ts
      export async function handleFacebookAuth(authService: AuthService, requestBody: unknown): Promise<ControllerResponse> {
        const { code } = asRecord(requestBody);
        if (typeof code !== "string" || code.length === 0) {
          return { status: 400, body: { error: "code is required" } };
        }
        try {
          const { result, isNewAccount, profile } = await authService.loginWithFacebook(code);
          console.log(`facebook auth succeeded, isNewAccount=${isNewAccount}`);
          return {
            status: 200,
            body: {
              access_token: result.accessToken,
              expires_in: result.accessTokenExpiresInSeconds,
              refresh_token: result.refreshToken,
              token_type: "Bearer",
              is_new_account: isNewAccount,
              user: { name: profile.name, email: profile.email },
            },
          };
        } catch (err) {
          if (err instanceof FacebookAuthError) {
            console.warn(`facebook auth failed: ${err.message}`);
            return { status: 401, body: { error: "Facebook sign-in failed. Please try again." } };
          }
          throw err;
        }
      }
      ```
    files:
      - src/auth/authController.ts
    rationale: |
      The request body intentionally accepts only `code` — no `username`/`password` field exists
      on this endpoint at all (AC3, AC4). `is_new_account` + `user` in the response give a caller
      what it needs to render the design's two different success screens ("Account Created" vs.
      "Welcome back, Jordan") without a second round-trip.
  - description: |
      Wire the new route and dependency into the app, following the existing route-table and DI
      pattern.
      Before (`AppDependencies`):
      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
      }
      ```
      After: add `facebookOAuthClient?: FacebookOAuthClient;`, default to
      `new FacebookGraphOAuthClient()` when not supplied, pass it into `new AuthService(...)`, and
      add a route entry:
      ```ts
      if (route === "POST /auth/facebook") {
        const result = await handleFacebookAuth(authService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
      (added to the same `route !== "..."` guard list that currently gates which routes go on to
      `readJsonBody`).
    files:
      - src/app.ts
    rationale: |
      Matches how every other authenticated route is registered and how `sessionRepository`/
      `userRepository` are already overridable per-test via `AppDependencies`.
  - description: |
      Add the failing-tests-first suite for this story, using a fake `FacebookOAuthClient` (no
      network calls, consistent with every other test in `test/`) injected via `startTestServer`.
    files:
      - test/facebookAuth.test.ts
    rationale: |
      One new test file per existing convention (`test/login.test.ts`, `test/refresh.test.ts`),
      each test named `AC<n>: ...` and hitting the real HTTP server via `fetch`.
tests:
  - |
    AC1 — a user with no existing account is registered on completing Facebook OAuth:
    ```ts
    test("AC1: a user with no existing account is registered on first Facebook OAuth completion", async () => {
      const userRepository = new UserRepository([]);
      const facebookOAuthClient = new FakeFacebookOAuthClient({
        facebookId: "fb-jordan-1", name: "Jordan Alvarez", email: "jordan.alvarez@example.com", avatarUrl: null,
      });
      const server = await startTestServer({ userRepository, facebookOAuthClient });
      try {
        const res = await fetch(`${server.baseUrl}/auth/facebook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "valid-oauth-code" }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { is_new_account: boolean };
        assert.equal(body.is_new_account, true);
        assert.equal(userRepository.findByFacebookId("fb-jordan-1")?.name, "Jordan Alvarez");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 — a returning Facebook user is logged into their existing account, not a new one:
    ```ts
    test("AC2: a returning Facebook user is logged into their existing account", async () => {
      const existingUser: User = {
        id: "user-fb-1", role: "customer", facebookId: "fb-jordan-1",
        name: "Jordan Alvarez", email: "jordan.alvarez@example.com",
      };
      const userRepository = new UserRepository([existingUser]);
      const facebookOAuthClient = new FakeFacebookOAuthClient({
        facebookId: "fb-jordan-1", name: "Jordan Alvarez", email: "jordan.alvarez@example.com", avatarUrl: null,
      });
      const server = await startTestServer({ userRepository, facebookOAuthClient });
      try {
        const res = await fetch(`${server.baseUrl}/auth/facebook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "valid-oauth-code" }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { is_new_account: boolean };
        assert.equal(body.is_new_account, false);
        assert.equal(userRepository.findByFacebookId("fb-jordan-1")?.id, "user-fb-1");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 — Facebook login succeeds without the client ever supplying a username or password:
    ```ts
    test("AC3: Facebook auth succeeds with only a code, no username or password", async () => {
      const facebookOAuthClient = new FakeFacebookOAuthClient({
        facebookId: "fb-jordan-1", name: "Jordan Alvarez", email: "jordan.alvarez@example.com", avatarUrl: null,
      });
      const server = await startTestServer({ userRepository: new UserRepository([]), facebookOAuthClient });
      try {
        const res = await fetch(`${server.baseUrl}/auth/facebook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "valid-oauth-code" }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { access_token: string; refresh_token: string };
        assert.equal(typeof body.access_token, "string");
        assert.equal(typeof body.refresh_token, "string");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 — no email/password registration endpoint is exposed alongside Facebook auth:
    ```ts
    test("AC4: no email/password registration endpoint exists", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "newuser", password: "secret" }),
        });
        assert.equal(res.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - |
    This repo is a JSON API backend only — `src/app.ts`/`src/server.ts` have no HTML rendering or
    static-serving path today. The approved prototype's seven screens (Sign Up/Log In, Facebook
    Consent, Authenticating, Account Created, Logged In, Error, Home) describe the client
    experience that will consume this API; this plan builds the backend contract those screens
    need (new-vs-returning distinction, no password ever required, captured profile fields) but
    does not and cannot add the screens themselves in this codebase.
  - |
    The request field name `code` (an OAuth authorization code) is my choice, following the
    standard Authorization Code flow implied by the design's browser-chrome screen
    (`facebook.com/dialog/oauth`). The prototype's own script never sends a real payload (it's a
    hardcoded in-page fixture, see `FIXTURES.facebookProfile`), so no field name is specified
    anywhere in this codebase or the design — confirm this contract with whoever builds the
    client.
  - |
    Captured Facebook profile fields (name, email, profile photo) come from the design's
    Facebook-consent screen (`.arc/designs/QAM-MANOJ-STORY-048-design.html`, `.permission-list`)
    and its own comment resolving the story's open question "for design purposes" — treated here
    as confirmed rather than still-open, per the design being the approved source of truth.
  - |
    Per the design's own script, clicking "Cancel" on the consent screen (`consent-cancel-btn`)
    is a pure client-side transition to the error screen — it never calls the backend. A genuine
    Facebook-side failure during code exchange is handled here (`FacebookAuthError` -> 401), but
    exact copy/telemetry for that path is explicitly called out in the story as an unresolved
    open question, so it is implemented defensively but not test-driven as a separate AC in this
    plan.
  - |
    AC4 ("no email/password registration option is presented") is read as scoped to the
    registration/sign-up entry point shown in the design (which has no password field at all),
    not as a mandate to remove the pre-existing username/password `/auth/login` endpoint added in
    STORY-007 for already-registered non-Facebook test accounts. That endpoint is left untouched.
    Confirm this reading at grooming since the AC text itself doesn't scope it explicitly.
  - |
    `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` / `FACEBOOK_REDIRECT_URI` are real third-party
    secrets — they are read from `process.env` by `FacebookGraphOAuthClient` at construction time
    (fail-fast, mirroring `JWT_SECRET` in `src/auth/tokenService.ts`) but no values are invented
    or added to `.env`/`.env.test` here; every test injects a fake `FacebookOAuthClient`, so this
    path never executes under `npm test`. Ops must supply real values before this ships.
  - |
    New Facebook-registered accounts default to role `customer`, the same default every other
    self-service account in this codebase gets.
package_dependencies: []
notes: |
  This plan touches 6 production files across three layers (routing, service, repository/model)
  plus a new OAuth boundary module, so here is the call graph, with untouched existing modules
  (`sessionRepository.ts`, `tokenService.ts`) shown for context but not restyled:

  ```mermaid
  flowchart TD
    app["src/app.ts<br/>adds POST /auth/facebook route + DI"]
    controller["src/auth/authController.ts<br/>adds handleFacebookAuth"]
    service["src/auth/authService.ts<br/>adds loginWithFacebook"]
    fbClient["src/auth/facebookOAuthClient.ts<br/>new: FacebookOAuthClient + Graph impl"]
    userRepo["src/users/userRepository.ts<br/>adds findByFacebookId + create"]
    userModel["src/users/fixtures/testUsers.ts<br/>User gets optional fb fields"]
    sessionRepo["src/sessions/sessionRepository.ts<br/>reused as-is"]
    tokenService["src/auth/tokenService.ts<br/>reused as-is"]

    app -->|routes body to| controller
    controller -->|calls loginWithFacebook| service
    service -->|exchangeCodeForProfile: get FB profile| fbClient
    service -->|findByFacebookId / create: AC1 vs AC2| userRepo
    service -->|create session: same as password login| sessionRepo
    service -->|issueAccessToken / generateRefreshToken| tokenService
    userRepo --> userModel

    classDef touched fill:#f96,color:#000
    class app,controller,service,fbClient,userRepo,userModel touched
  ```

  The Facebook consent/cancel/error screens and the Home "Sign-in method" panel in the approved
  prototype are UI-only and have no corresponding code path to build in this backend-only repo;
  they're referenced above only to justify the response shape (`is_new_account`, `user.name`,
  `user.email`) and the profile fields captured on registration.
