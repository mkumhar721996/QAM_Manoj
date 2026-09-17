summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is currently a headless Node
  `http` server with no frontend/browser runtime at all: `src/auth/`, `src/sessions/`,
  `src/users/` implement a real, server-authoritative login (scrypt password hashing, signed JWT
  access tokens, in-memory session repository), tested with `node:test` + raw `fetch` against an
  ephemeral `startTestServer()`. This story asks for something different in kind: a *client-side*
  "Mock Auth Service" that reads/writes user records and session state directly in `localStorage`,
  as a consistent, testable source of truth for future UI views (registration, login, password
  reset, logout) - independent of, and not wired into, the existing JWT/session HTTP stack. This
  plan adds it as a new, standalone module tree `src/mockAuth/` (storage adapter + user
  repository + session repository + service), written so it runs against the real browser
  `localStorage` when present but is unit-tested in Node via an injected in-memory fake that
  implements the same minimal `getItem/setItem/removeItem` shape - since Node has no native
  `localStorage` and this repo has no DOM/browser test environment. Each acceptance criterion maps
  1:1 to a failing `node:test` test written first, following the existing repository -> service
  layering and constructor-injectable-dependency conventions already used by `UserRepository` /
  `SessionRepository` / `CartRepository`.
scope:
  - description: |
      Write all ten failing acceptance tests first, against the not-yet-existing
      `src/mockAuth/localAuthService.ts`, `src/mockAuth/userStore.ts`, `src/mockAuth/sessionStore.ts`,
      and `src/mockAuth/storage.ts` modules. These must fail on import (module not found) before any
      production code exists.
    files:
      - "test/mockAuthService.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before writing any production
      code, matching the existing `test/login.test.ts` / `test/logout.test.ts` style (`node:test`
      + `node:assert/strict`), but exercising the new module directly (no HTTP layer exists for
      it, so there is no `startTestServer()` involved here).
  - description: |
      Add the storage abstraction the rest of the module is built on: a minimal `StorageLike`
      interface matching the subset of the Web Storage API this module needs, a `createMemoryStorage()`
      in-memory fake (used both by tests and as the Node-side fallback), and `resolveDefaultStorage()`
      which prefers the real browser global when present.

      ```ts
      // src/mockAuth/storage.ts
      export interface StorageLike {
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
      }

      export function createMemoryStorage(): StorageLike {
        const data = new Map<string, string>();
        return {
          getItem: (key) => data.get(key) ?? null,
          setItem: (key, value) => {
            data.set(key, value);
          },
          removeItem: (key) => {
            data.delete(key);
          },
        };
      }

      export function resolveDefaultStorage(): StorageLike {
        const globalStorage = (globalThis as { localStorage?: StorageLike }).localStorage;
        return globalStorage ?? createMemoryStorage();
      }
      ```
    files:
      - "src/mockAuth/storage.ts"
    rationale: |
      No package in this repo currently depends on a DOM/browser environment (no jsdom, no
      bundler, no `lib: ["DOM"]` in `tsconfig.json`). Introducing this seam is the minimal way to
      let the module run against real `localStorage` in a browser later while remaining unit
      testable today in plain `node:test`, without adding a new third-party dependency.
  - description: |
      Add `UserStore`, a localStorage-backed repository for user records, keyed by email, modeled
      on the constructor-injectable-dependency shape already used by `UserRepository`
      (`src/users/userRepository.ts`) and `CartRepository` (`src/cart/cartRepository.ts`).

      ```ts
      // src/mockAuth/userStore.ts
      export interface StoredUser {
        email: string;
        password: string;
        createdAt: number;
      }

      export class UserStore {
        constructor(private storage: StorageLike = resolveDefaultStorage()) {}

        findByEmail(email: string): StoredUser | undefined {
          return this.readAll()[email];
        }

        save(user: StoredUser): void {
          const users = this.readAll();
          users[user.email] = user;
          this.writeAll(users);
        }

        listAll(): StoredUser[] {
          return Object.values(this.readAll());
        }

        private readAll(): Record<string, StoredUser> {
          const raw = this.storage.getItem("mockAuth:users");
          return raw ? (JSON.parse(raw) as Record<string, StoredUser>) : {};
        }

        private writeAll(users: Record<string, StoredUser>): void {
          this.storage.setItem("mockAuth:users", JSON.stringify(users));
        }
      }
      ```
    files:
      - "src/mockAuth/userStore.ts"
    rationale: |
      AC1, AC6, AC7, AC8 all hinge on a single durable, email-keyed record store. Persisting the
      whole map as one JSON blob under one `localStorage` key (rather than one key per user) keeps
      `listAll()`/duplicate-detection trivial and mirrors the "one JSON document per collection"
      shape already used by the in-memory `Map`-backed repositories elsewhere in this repo.
  - description: |
      Add `SessionStore`, a localStorage-backed repository for the single current session, modeled
      on `src/sessions/sessionModel.ts` + `src/sessions/sessionRepository.ts` but holding at most
      one active session (this module has no concept of multiple concurrent devices/tokens - it is
      a single logged-in-user-per-browser mock).

      ```ts
      // src/mockAuth/sessionStore.ts
      export interface StoredSession {
        email: string;
      }

      export class SessionStore {
        constructor(private storage: StorageLike = resolveDefaultStorage()) {}

        getCurrentSession(): StoredSession | null {
          const raw = this.storage.getItem("mockAuth:session");
          return raw ? (JSON.parse(raw) as StoredSession) : null;
        }

        setCurrentSession(session: StoredSession): void {
          this.storage.setItem("mockAuth:session", JSON.stringify(session));
        }

        clearCurrentSession(): void {
          this.storage.removeItem("mockAuth:session");
        }
      }
      ```
    files:
      - "src/mockAuth/sessionStore.ts"
    rationale: |
      AC2-AC5, AC7, AC9, AC10 all require an explicit, independently-checkable "is a session
      written / cleared" fact distinct from whether login *succeeded*, so session state needs its
      own store rather than being a boolean flag inside `LocalAuthService`.
  - description: |
      Add `LocalAuthService`, the business-rule layer combining the two stores: `register`,
      `login`, `logout`, `resetPassword`, `isAuthenticated`, `getCurrentUserEmail`.

      ```ts
      // src/mockAuth/localAuthService.ts
      export class DuplicateUserError extends Error {
        constructor(email: string) {
          super(`A user with email ${email} is already registered`);
        }
      }

      export class InvalidCredentialsError extends Error {
        constructor() {
          super("Invalid email or password");
        }
      }

      export class LocalAuthService {
        constructor(
          private userStore: UserStore = new UserStore(),
          private sessionStore: SessionStore = new SessionStore(),
        ) {}

        register(email: string, password: string, now: number = Date.now()): void {
          if (this.userStore.findByEmail(email)) {
            throw new DuplicateUserError(email);
          }
          this.userStore.save({ email, password, createdAt: now });
        }

        login(email: string, password: string): void {
          const user = this.userStore.findByEmail(email);
          if (!user || user.password !== password) {
            throw new InvalidCredentialsError();
          }
          this.sessionStore.setCurrentSession({ email });
        }

        logout(): void {
          this.sessionStore.clearCurrentSession();
        }

        resetPassword(email: string, newPassword: string): void {
          const user = this.userStore.findByEmail(email);
          if (!user) {
            throw new InvalidCredentialsError();
          }
          this.userStore.save({ ...user, password: newPassword });
        }

        isAuthenticated(): boolean {
          return this.sessionStore.getCurrentSession() !== null;
        }

        getCurrentUserEmail(): string | null {
          return this.sessionStore.getCurrentSession()?.email ?? null;
        }
      }
      ```
    files:
      - "src/mockAuth/localAuthService.ts"
    rationale: |
      Centralises all ten ACs' rules (uniqueness on register, credential matching on login,
      session write/clear side effects, password update) in one place, exactly mirroring how
      `AuthService` (`src/auth/authService.ts`) centralises the real login/refresh/logout rules
      rather than spreading them across callers.
tests:
  - |
    AC1 - GIVEN no users are stored WHEN a new user registers with a unique email and password
    THEN a record for that user is persisted in localStorage and retrievable in subsequent
    browser sessions.

    A second `UserStore` instance over the *same* injected storage stands in for "a subsequent
    browser session", since real `localStorage` persistence across reloads can't be exercised
    inside a single Node process - only that a fresh object reading the same underlying store
    sees what an earlier object wrote.
    ```ts
    test("AC1: a registered user is persisted and retrievable by a fresh store instance", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
      service.register("alice@example.com", "hunter2");

      const freshUserStore = new UserStore(storage);
      const found = freshUserStore.findByEmail("alice@example.com");
      assert.ok(found);
      assert.equal(found?.email, "alice@example.com");
    });
    ```
  - |
    AC2 - GIVEN a user record exists WHEN login is attempted with matching email and password
    THEN the session is marked as authenticated in localStorage.
    ```ts
    test("AC2: login with correct credentials marks the session authenticated", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
      service.register("alice@example.com", "hunter2");

      service.login("alice@example.com", "hunter2");

      assert.equal(service.isAuthenticated(), true);
    });
    ```
  - |
    AC3 - GIVEN a user record exists WHEN login is attempted with a wrong password THEN
    authentication fails.
    ```ts
    test("AC3: login with a wrong password throws InvalidCredentialsError", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
      service.register("alice@example.com", "hunter2");

      assert.throws(() => service.login("alice@example.com", "wrong-password"), InvalidCredentialsError);
    });
    ```
  - |
    AC4 - GIVEN a user record exists WHEN login is attempted with a wrong password THEN no
    session is written.
    ```ts
    test("AC4: a failed login (wrong password) does not write a session", () => {
      const storage = createMemoryStorage();
      const sessionStore = new SessionStore(storage);
      const service = new LocalAuthService(new UserStore(storage), sessionStore);
      service.register("alice@example.com", "hunter2");

      assert.throws(() => service.login("alice@example.com", "wrong-password"));

      assert.equal(sessionStore.getCurrentSession(), null);
    });
    ```
  - |
    AC5 - GIVEN an authenticated session exists WHEN the user logs out THEN subsequent checks
    treat the user as unauthenticated.
    ```ts
    test("AC5: logout clears the authenticated session", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
      service.register("alice@example.com", "hunter2");
      service.login("alice@example.com", "hunter2");

      service.logout();

      assert.equal(service.isAuthenticated(), false);
    });
    ```
  - |
    AC6 - GIVEN a user record exists WHEN a password-reset is submitted for that email with a new
    password THEN the stored password for that record is updated in localStorage.
    ```ts
    test("AC6: resetting a password updates the stored record", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
      service.register("alice@example.com", "hunter2");

      service.resetPassword("alice@example.com", "new-password");

      assert.throws(() => service.login("alice@example.com", "hunter2"), InvalidCredentialsError);
      service.login("alice@example.com", "new-password");
      assert.equal(service.isAuthenticated(), true);
    });
    ```
  - |
    AC7 - GIVEN multiple users have registered WHEN each logs in with their own credentials THEN
    each session is isolated to that user's record.
    ```ts
    test("AC7: each user's session reflects only their own record", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
      service.register("alice@example.com", "alice-pw");
      service.register("bob@example.com", "bob-pw");

      service.login("alice@example.com", "alice-pw");
      assert.equal(service.getCurrentUserEmail(), "alice@example.com");

      service.login("bob@example.com", "bob-pw");
      assert.equal(service.getCurrentUserEmail(), "bob@example.com");
    });
    ```
  - |
    AC8 - GIVEN a user record already exists for an email WHEN registration is attempted again
    with that same email THEN registration fails and no duplicate record is created.
    ```ts
    test("AC8: registering twice with the same email fails and does not duplicate the record", () => {
      const storage = createMemoryStorage();
      const userStore = new UserStore(storage);
      const service = new LocalAuthService(userStore, new SessionStore(storage));
      service.register("alice@example.com", "hunter2");

      assert.throws(
        () => service.register("alice@example.com", "another-password"),
        DuplicateUserError,
      );
      assert.equal(userStore.listAll().length, 1);
    });
    ```
  - |
    AC9 - GIVEN no user record exists for an email WHEN login is attempted with that email THEN
    authentication fails.
    ```ts
    test("AC9: login with an email that has no record fails", () => {
      const storage = createMemoryStorage();
      const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));

      assert.throws(() => service.login("nobody@example.com", "whatever"), InvalidCredentialsError);
    });
    ```
  - |
    AC10 - GIVEN no user record exists for an email WHEN login is attempted with that email THEN
    no session is written.
    ```ts
    test("AC10: login with an unknown email does not write a session", () => {
      const storage = createMemoryStorage();
      const sessionStore = new SessionStore(storage);
      const service = new LocalAuthService(new UserStore(storage), sessionStore);

      assert.throws(() => service.login("nobody@example.com", "whatever"));

      assert.equal(sessionStore.getCurrentSession(), null);
    });
    ```
assumptions_or_open_questions:
  - "This story's ACs are phrased in terms of a UI ('subsequent browser sessions', a source of truth for 'all views'), but this repo (`qam-manoj-story-007-login-session-management`) is a headless Node HTTP API with no frontend/browser runtime, bundler, or DOM types anywhere (`tsconfig.json` has no `DOM` lib; the only HTML in the repo is the static, unwired `src/design-system/style-guide.html`). This plan adds a new, standalone module (`src/mockAuth/`) written to run against real browser `localStorage` when present, unit-tested via an injected in-memory fake since Node itself has no native `localStorage`. Please confirm this translation is the intended scope, or point to where an actual UI/browser layer is meant to consume it - this mirrors the same kind of scope question already raised in the sibling plan `.arc/plans/run_3812cca44f4c/plan.md` for the Pizza Customisation story."
  - "This module is intentionally NOT wired into `src/app.ts` or the existing `src/auth/`/`src/sessions/` JWT stack: the story explicitly calls this a 'Mock Auth Service', distinct from the real server-authoritative login already implemented in `src/auth/authService.ts`. No existing route, controller, or repository is touched by this plan."
  - "Passwords are stored as plain strings in the mock user record (no hashing), since this is an explicitly mock/prototype localStorage layer and no AC mentions hashing. The real login path continues to use `scrypt` via `src/auth/passwordHasher.ts`, unaffected by this plan. Flagging for reviewer: if hashing is wanted even for the mock, the Web Crypto API (`crypto.subtle`) would be the browser-safe choice - the existing `node:crypto`-based hasher cannot run unmodified in a browser."
  - "Email is treated as the unique identifier/lookup key throughout (as the ACs use 'email'), unlike the existing server-side `User` model in `src/users/fixtures/testUsers.ts` which keys by `username`. No separate username field is introduced."
  - "This module assumes a single 'current session' per storage instance (i.e. per browser), not a per-session-token model like the real backend's `SessionRepository` - AC7's 'each session is isolated to that user's record' is read as 'the single current session reflects whichever user last logged in', not concurrent multi-session tracking."
package_dependencies: []
notes: |
  No new third-party package is needed: the storage seam (`StorageLike`) is small enough to hand-write,
  and the in-memory test fake avoids pulling in a DOM/localStorage polyfill package (e.g. `jsdom`,
  `node-localstorage`) that this repo has never depended on.

  This is a wholly new module tree with no existing callers, so the diagram below only shows the
  internal layering plus the test file that drives it - there is no existing `src/app.ts` or
  `src/auth/` edge to draw, since (per the open question above) this module is deliberately not
  wired into either.

  ```mermaid
  flowchart TD
    testFile["test/mockAuthService.test.ts (new)"]
    service["src/mockAuth/localAuthService.ts (new)"]
    userStore["src/mockAuth/userStore.ts (new)"]
    sessionStore["src/mockAuth/sessionStore.ts (new)"]
    storage["src/mockAuth/storage.ts (new)"]

    testFile -->|"register(), login(), logout(), resetPassword(), isAuthenticated()"| service
    service -->|"findByEmail(), save(), listAll()"| userStore
    service -->|"getCurrentSession(), setCurrentSession(), clearCurrentSession()"| sessionStore
    userStore -->|"getItem()/setItem() under key mockAuth:users"| storage
    sessionStore -->|"getItem()/setItem()/removeItem() under key mockAuth:session"| storage
    testFile -->|"createMemoryStorage() as the injected StorageLike fake"| storage

    classDef touched fill:#f96,color:#000
    class testFile,service,userStore,sessionStore,storage touched
  ```
