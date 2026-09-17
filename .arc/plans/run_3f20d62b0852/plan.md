summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is currently a headless Node `http`
  JSON API (`src/app.ts`/`src/server.ts` + `auth/`, `sessions/`, `users/`, `pizzas/`, `cart/`
  modules) with no frontend/UI layer at all - the only browser-facing asset today is a static
  design-system style guide (`src/design-system/*.css`, `style-guide.html`) that is not served by
  the app. STORY-080 is the first story whose acceptance criteria are entirely about browser-DOM
  behaviour (a nav bar being visible, a click handler clearing `localStorage` and navigating away,
  a hardcoded post feed rendering), which cannot be translated into API-only assertions the way the
  prior pizza-customisation story was. This plan adds a small static frontend under `src/web/`
  (`home.html`, `home.js`, a placeholder `login.html`) served by the existing plain `http` server
  via a handful of new exact-match static routes, reusing the existing design-system CSS tokens for
  styling. Because the server has no way to know a browser's `localStorage` state from a plain GET
  request (the app has no cookies, only Bearer tokens sent explicitly on API calls), the
  authenticated/unauthenticated guard for the Home route is implemented client-side in `home.js`
  and driven test-first with `jsdom` (a new dev dependency, since the repo has no DOM/browser test
  tooling today) plus plain dependency-injected fakes for `storage`/`location`, matching the
  existing codebase's style of passing explicit dependencies into testable functions rather than
  reaching for globals.
scope:
  - description: |
      Write the failing test file first, covering all 7 ACs against the not-yet-existing
      `src/web/home.html`, `src/web/home.js`, `src/web/login.html`, and the new `GET /home`,
      `GET /home.js`, `GET /login` routes. These must fail (module-not-found / 404) before any
      implementation exists.
    files:
      - "test/home.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before any production code exists,
      matching the existing `test/login.test.ts` / `test/cartCustomisation.test.ts` style (raw
      `fetch` against `startTestServer()` for the HTTP-layer checks) plus `jsdom` + `node:test`'s
      built-in `mock.fn()` for the DOM/click/navigation behaviour that has no API equivalent.
  - description: |
      Add the static Home markup and a placeholder Login page, styled with the existing
      design-system utility classes (`.row`, `.stack`, `.btn`, `.btn-secondary`, `.card`,
      `.text-bold`, `.text-muted`) from `src/design-system/prototype-utils.css` /
      `tokens.css`. The Home content is wrapped in a single `hidden` container so that "not
      rendered" (AC7) is a real, assertable DOM state rather than a convention.

      ```html
      <!-- src/web/home.html (body) -->
      <body>
        <div data-testid="home-view" hidden>
          <nav class="row" data-testid="navbar">
            <span class="text-bold" data-testid="logo">PizzaBook</span>
            <button class="btn btn-secondary" data-testid="logout-button">Log out</button>
          </nav>
          <div class="card" data-testid="story-strip">Stories go here</div>
          <div class="stack" data-testid="post-feed"></div>
        </div>
        <script type="module">
          import { initHome } from "/home.js";
          initHome({ document, storage: window.localStorage, location: window.location });
        </script>
      </body>
      ```

      ```html
      <!-- src/web/login.html: placeholder navigation target only, no real login form yet -->
      <body>
        <div class="stack p-4" data-testid="login-view">
          <h1>Log in</h1>
        </div>
      </body>
      ```
    files:
      - "src/web/home.html"
      - "src/web/login.html"
    rationale: |
      AC1/AC4/AC5 require specific, always-in-the-DOM elements (nav bar with logo + logout button,
      a story strip above the feed, a feed container) for `home.js` to reveal/populate; AC7 requires
      a concrete "not rendered" state, which the `hidden` attribute on a single wrapper gives us
      without a framework. `login.html` is a minimal stub because no prior story
      (`QAM-MANOJ-STORY-007`, which is API-only) produced a browser Login view for AC3/AC6 to
      navigate to - see `assumptions_or_open_questions`.
  - description: |
      Add `src/web/home.js`: plain, framework-free ES module (not TypeScript - it must run
      unmodified in the browser, and this repo has no build/bundle step) holding the hardcoded post
      fixture and the auth guard/render/logout logic as small, dependency-injected, individually
      testable functions.

      ```js
      // src/web/home.js
      export const SESSION_STORAGE_KEY = "qam_session";

      export const POSTS = [
        { author: "Priya Sharma", text: "Excited to try the new pizza builder!", timestamp: "2026-09-15T10:00:00Z" },
        { author: "Alex Chen", text: "Anyone up for pizza night this weekend?", timestamp: "2026-09-16T14:30:00Z" },
        { author: "Jordan Lee", text: "Just customised my first pizza on here.", timestamp: "2026-09-16T18:45:00Z" },
      ];

      export function hasSession(storage) {
        return storage.getItem(SESSION_STORAGE_KEY) !== null;
      }

      export function clearSession(storage) {
        storage.removeItem(SESSION_STORAGE_KEY);
      }

      export function renderPosts(feedEl, document, posts = POSTS) {
        for (const post of posts) {
          const article = document.createElement("article");
          article.className = "card";
          article.dataset.testid = "post";
          article.innerHTML = `
            <p class="text-bold" data-testid="post-author">${post.author}</p>
            <p data-testid="post-text">${post.text}</p>
            <p class="text-sm text-muted" data-testid="post-timestamp">${post.timestamp}</p>
          `;
          feedEl.appendChild(article);
        }
      }

      export function initHome({ document, storage, location }) {
        const homeView = document.querySelector('[data-testid="home-view"]');
        if (!hasSession(storage)) {
          location.assign("/login");
          return;
        }
        homeView.hidden = false;
        renderPosts(document.querySelector('[data-testid="post-feed"]'), document);
        document.querySelector('[data-testid="logout-button"]').addEventListener("click", () => {
          clearSession(storage);
          location.assign("/login");
        });
      }
      ```
    files:
      - "src/web/home.js"
    rationale: |
      Keeping `hasSession`/`clearSession`/`renderPosts`/`initHome` as pure(ish) functions taking
      `document`/`storage`/`location` as explicit arguments (rather than reading `window.*`
      globally) means tests can pass plain fakes instead of fighting `jsdom`'s well-known
      unimplemented-navigation limitation, mirroring how `authController.ts` handlers take
      `authorizationHeader`/`requestBody` as plain arguments instead of reaching into `req`
      directly.
  - description: |
      Wire the new static routes into `src/app.ts`, reading the files from disk once and serving
      them with the right content type, plus a small `sendRaw` helper alongside the existing
      `sendJson` in `httpUtils.ts`.

      ```ts
      // src/httpUtils.ts (addition)
      export function sendRaw(res: ServerResponse, status: number, body: string, contentType: string): void {
        res.writeHead(status, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body) });
        res.end(body);
      }
      ```

      ```ts
      // src/app.ts (additions inside handleRequest, before the JSON-only routes)
      const STATIC_ROUTES: Record<string, { file: string; contentType: string }> = {
        "GET /home": { file: "web/home.html", contentType: "text/html" },
        "GET /home.js": { file: "web/home.js", contentType: "text/javascript" },
        "GET /login": { file: "web/login.html", contentType: "text/html" },
        "GET /design-system/tokens.css": { file: "design-system/tokens.css", contentType: "text/css" },
        "GET /design-system/prototype-utils.css": { file: "design-system/prototype-utils.css", contentType: "text/css" },
      };

      const staticRoute = STATIC_ROUTES[route];
      if (staticRoute) {
        sendRaw(res, 200, readFileSync(new URL(`./${staticRoute.file}`, import.meta.url), "utf8"), staticRoute.contentType);
        return;
      }
      ```
    files:
      - "src/app.ts"
      - "src/httpUtils.ts"
    rationale: |
      `createApp`/`handleRequest` is the single composition root and route dispatcher today (see
      the existing `route === "POST /auth/login"` string-match style) - the new pages must be
      served through the same dispatcher rather than a second server. An explicit allow-list of
      exact routes (rather than a generic static-directory server) avoids introducing a
      path-traversal surface for a feature that only needs 5 known files.
  - description: |
      Add `jsdom` (+ its type definitions) as dev dependencies so `home.js`'s DOM behaviour can be
      driven test-first with `node:test`, since the repo currently has zero DOM/browser test
      tooling.
    files:
      - "package.json"
    rationale: |
      `node:test` alone has no `document`/`Node`/`Storage` implementation; `jsdom` is the
      lightest-weight way to construct a real DOM from the actual `home.html` file content in a
      plain Node test process, with no new build step or headless-browser binary.
tests:
  - |
    AC1 - nav bar with logo and logout control is visible once an authenticated session exists.
    ```ts
    test("AC1: nav bar with logo and logout control is visible when a session exists", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      initHome({ document: dom.window.document, storage: fakeStorage({ qam_session: "{}" }), location: fakeLocation() });
      const homeView = dom.window.document.querySelector('[data-testid="home-view"]') as HTMLElement;
      assert.equal(homeView.hidden, false);
      assert.ok(dom.window.document.querySelector('[data-testid="logo"]'));
      assert.ok(dom.window.document.querySelector('[data-testid="logout-button"]'));
    });
    ```
  - |
    AC2 - clicking logout clears the session from localStorage.
    ```ts
    test("AC2: clicking logout removes the session from storage", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      const storage = fakeStorage({ qam_session: "{}" });
      initHome({ document: dom.window.document, storage, location: fakeLocation() });
      dom.window.document.querySelector('[data-testid="logout-button"]')!.dispatchEvent(new dom.window.Event("click"));
      assert.equal(storage.getItem("qam_session"), null);
    });
    ```
  - |
    AC3 - clicking logout navigates to the Login view.
    ```ts
    test("AC3: clicking logout navigates to /login", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      const location = fakeLocation();
      initHome({ document: dom.window.document, storage: fakeStorage({ qam_session: "{}" }), location });
      dom.window.document.querySelector('[data-testid="logout-button"]')!.dispatchEvent(new dom.window.Event("click"));
      assert.equal(location.assign.mock.calls.length, 1);
      assert.equal(location.assign.mock.calls[0].arguments[0], "/login");
    });
    ```
  - |
    AC4 - a story/status strip is visible above the post feed.
    ```ts
    test("AC4: the story strip appears above the post feed", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      initHome({ document: dom.window.document, storage: fakeStorage({ qam_session: "{}" }), location: fakeLocation() });
      const storyStrip = dom.window.document.querySelector('[data-testid="story-strip"]')!;
      const feed = dom.window.document.querySelector('[data-testid="post-feed"]')!;
      assert.ok(storyStrip.compareDocumentPosition(feed) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    });
    ```
  - |
    AC5 - at least three hardcoded posts render, each with an author, text, and timestamp.
    ```ts
    test("AC5: at least three posts render with author, text, and timestamp", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      initHome({ document: dom.window.document, storage: fakeStorage({ qam_session: "{}" }), location: fakeLocation() });
      const posts = [...dom.window.document.querySelectorAll('[data-testid="post"]')];
      assert.ok(posts.length >= 3);
      for (const post of posts) {
        assert.ok(post.querySelector('[data-testid="post-author"]')!.textContent!.trim().length > 0);
        assert.ok(post.querySelector('[data-testid="post-text"]')!.textContent!.trim().length > 0);
        assert.ok(post.querySelector('[data-testid="post-timestamp"]')!.textContent!.trim().length > 0);
      }
    });
    ```
  - |
    AC6 - an unauthenticated direct visit to the Home route is redirected to the Login view.
    ```ts
    test("AC6: no session redirects to /login", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      const location = fakeLocation();
      initHome({ document: dom.window.document, storage: fakeStorage(), location });
      assert.equal(location.assign.mock.calls.length, 1);
      assert.equal(location.assign.mock.calls[0].arguments[0], "/login");
    });

    test("AC6: GET /home and GET /login routes exist and serve HTML", async () => {
      const server = await startTestServer();
      try {
        const homeRes = await fetch(`${server.baseUrl}/home`);
        assert.equal(homeRes.status, 200);
        assert.match(homeRes.headers.get("content-type") ?? "", /text\/html/);
        const loginRes = await fetch(`${server.baseUrl}/login`);
        assert.equal(loginRes.status, 200);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 - the Home view is not rendered for an unauthenticated visit.
    ```ts
    test("AC7: home content stays hidden and unpopulated with no session", () => {
      const dom = new JSDOM(readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8"));
      initHome({ document: dom.window.document, storage: fakeStorage(), location: fakeLocation() });
      const homeView = dom.window.document.querySelector('[data-testid="home-view"]') as HTMLElement;
      assert.equal(homeView.hidden, true);
      assert.equal(dom.window.document.querySelectorAll('[data-testid="post"]').length, 0);
    });
    ```
assumptions_or_open_questions:
  - "This repo is a headless HTTP API with no frontend layer at all, and no prior story delivered a browser Login view (QAM-MANOJ-STORY-007 is API-only). This plan therefore also creates a minimal placeholder `src/web/login.html` (heading only, no real form) purely as a navigation target for AC3/AC6 - please confirm that building the *actual* login form/flow is out of scope for this story and belongs to a future story, or point me to an existing Login view I've missed."
  - "The server has no cookie-based session and only ever sees Bearer tokens explicitly attached to API calls, so it cannot know a browser's localStorage/auth state from a plain `GET /home` navigation. AC6/AC7's redirect and 'not rendered' behaviour are therefore implemented as a client-side guard in `home.js` that runs on load, not a server-side HTTP redirect. Flagging this explicitly since it's the key architectural call this plan makes."
  - "The localStorage key/shape holding the session (`qam_session`) is invented for this story, since no existing login UI writes to localStorage yet. Tests seed/clear this key directly to simulate the AC's GIVEN conditions rather than going through a real login flow."
  - "The 3 hardcoded posts, their author names/text, and the 'PizzaBook' logo text are placeholder content invented to satisfy AC5/AC1 structurally; exact copy is assumed not to matter for the ACs as written."
  - "'App logo' is rendered as styled text (no image asset exists in the repo), consistent with the CSS-tokens-only design system present today."
  - "Story/status strip content (AC4) is a single static placeholder element, not an interactive carousel, since no AC describes strip content or interaction beyond it being visible above the feed."
package_dependencies:
  - name: jsdom
    version: "^25.0.1"
    ecosystem: npm
    rationale: |
      Needed to construct a real DOM from `src/web/home.html` in `node:test` and assert on
      element visibility, click-driven side effects, and DOM order for AC1/AC4/AC5/AC7 - there is
      no existing DOM/browser test tooling in this repo to reuse.
  - name: "@types/jsdom"
    version: "^21.1.7"
    ecosystem: npm
    rationale: |
      Type definitions for `jsdom` so `test/home.test.ts` (a `.ts` file, run via
      `--experimental-strip-types` like the rest of the test suite) type-checks the `JSDOM`
      import and its `window.document`/`window.Node` members.
notes: |
  `node:test`'s built-in `mock.fn()` (already available via `import { mock } from "node:test"`) is
  used for the `location.assign` spy in the AC3/AC6 tests instead of adding a mocking library.

  Layering for the touched modules, plus their existing real callers/callees read while planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: new static routes)"]
    httpUtils["src/httpUtils.ts (modified: sendRaw added)"]
    homeHtml["src/web/home.html (new)"]
    homeJs["src/web/home.js (new)"]
    loginHtml["src/web/login.html (new)"]
    tokensCss["src/design-system/tokens.css (existing, now served)"]
    utilsCss["src/design-system/prototype-utils.css (existing, now served)"]
    testFile["test/home.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"GET /home, /home.js, /login, /design-system/*.css via sendRaw()"| httpUtils
    app -->|"reads file content"| homeHtml
    app -->|"reads file content"| homeJs
    app -->|"reads file content"| loginHtml
    app -->|"reads file content"| tokensCss
    app -->|"reads file content"| utilsCss
    homeHtml -->|"bootstrap script imports initHome()"| homeJs
    testFile -->|"imports initHome/hasSession/clearSession directly"| homeJs
    testFile -->|"loads real markup via JSDOM()"| homeHtml
    testFile -->|"HTTP-level route smoke test via fetch()"| app
    testFile -->|"startTestServer()"| testServer

    classDef touched fill:#f96,color:#000
    class app,httpUtils,homeHtml,homeJs,loginHtml,testFile touched
  ```
