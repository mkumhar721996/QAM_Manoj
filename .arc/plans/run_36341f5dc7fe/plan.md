summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is currently a headless Node `http`
  API with no frontend/UI layer at all - no HTML pages served by the server, no client-side JS, and
  no `Register`/`Login`/`Forgot Password`/`Home` views anywhere in the codebase (only a static,
  never-served `src/design-system/style-guide.html`). This story asks for those four views to exist
  and be wired together into a single-page app with client-side routing, so this plan necessarily
  creates the app shell from scratch: a minimal `public/index.html` shell with a `#app` mount
  point, four placeholder view renderers (`public/client/views/*.js`), and a small dependency-free
  `Router` class (`public/client/router.js`) that intercepts in-app link clicks, uses
  `history.pushState`/`popstate` instead of real navigation, and resolves the initial view from
  `location.pathname` on load. Because the client runs as plain browser JS (this repo has no
  bundler and never compiles TypeScript to browser-executable output - `tsconfig.json` has
  `"noEmit": true` and the project runs `.ts` only via Node's native `--experimental-strip-types`),
  the router and views are written in plain ES module JavaScript, not TypeScript. Server-side,
  `src/app.ts` gains a small SPA-fallback: `GET /`, `/login`, `/register`, `/forgot-password` all
  serve the same `index.html` shell (via a new `src/staticAssets.ts`) instead of falling through to
  the existing JSON 404 handler, and `GET /client/*` serves the browser JS files. Client-side
  routing logic (click interception, pushState, popstate, initial-URL resolution) is unit tested
  with `jsdom` against real DOM/History APIs, since Node's test runner has no DOM and this is the
  first UI code in the repo; the SPA fallback is tested the same way every other route in this repo
  is tested - `startTestServer()` + raw `fetch()`.
scope:
  - description: |
      Write the failing tests first for all three ACs: a server-side test asserting `GET /`,
      `/login`, `/register`, and `/forgot-password` all return the app shell HTML (not a 404, since
      neither the routes nor `index.html` exist yet), and a client-side `jsdom` test asserting the
      not-yet-existing `Router` module can be imported and exercised. Both must fail before any
      implementation exists.
    files:
      - "test/appShellRouting.test.ts"
      - "test/router.test.ts"
    rationale: |
      Establishes the test-first contract before writing any production code, matching the existing
      `test/*.test.ts` flat-file, `node:test` + raw `fetch()` + `startTestServer()` convention (see
      `test/cartCustomisation.test.ts`) for the server half, and introducing the minimal DOM-testing
      addition needed for the client half.
  - description: |
      Add `jsdom` (+ its type declarations) as new devDependencies so the client router tests can
      run against real DOM/History/Event APIs instead of hand-rolled fakes.
    files:
      - "package.json"
    rationale: |
      Node's built-in test runner has no DOM, and this repo has zero existing DOM-testing
      dependency - `jsdom` is the standard, minimal way to get real `document`/`window`/`history`/
      `popstate` semantics for testing click interception and back/forward behaviour faithfully.
  - description: |
      Add the `Router` class: event-delegated click interception on internal nav links,
      `history.pushState`-based navigation (no real navigation/reload), a `popstate` listener, and
      resolving the view to render from the current URL.

      ```js
      // public/client/router.js
      export const ROUTES = {
        "/": "home",
        "/login": "login",
        "/register": "register",
        "/forgot-password": "forgot-password",
      };

      export class Router {
        constructor({ window, container, views }) {
          this.window = window;
          this.container = container;
          this.views = views;
          this.window.addEventListener("popstate", () => this.renderForCurrentPath());
          this.container.addEventListener("click", (event) => this.handleClick(event));
        }

        handleClick(event) {
          const link = event.target.closest && event.target.closest("a[data-link]");
          if (!link) return;
          event.preventDefault();
          this.navigate(link.getAttribute("href"));
        }

        navigate(pathname) {
          this.window.history.pushState({}, "", pathname);
          this.renderForCurrentPath();
        }

        renderForCurrentPath() {
          const viewName = ROUTES[this.window.location.pathname];
          this.container.innerHTML = this.views[viewName]();
        }
      }
      ```
    files:
      - "public/client/router.js"
    rationale: |
      Centralises every AC's actual mechanism in one place: AC1 needs `preventDefault()` +
      `pushState` (not a real link navigation, which would reload), AC2 needs
      `renderForCurrentPath()` to work purely from `location.pathname` on first load, and AC3 needs
      the `popstate` listener to re-run the same render path the browser's back/forward buttons
      trigger natively.
  - description: |
      Add four minimal placeholder view renderers - plain functions returning an HTML string with a
      `data-view` marker (for test assertions) and root-relative `<a data-link>` links to the other
      three views.

      ```js
      // public/client/views/home.js
      export function renderHome() {
        return `
          <section data-view="home">
            <h1>Home</h1>
            <nav>
              <a data-link href="/login">Log in</a>
              <a data-link href="/register">Create account</a>
              <a data-link href="/forgot-password">Forgot password?</a>
            </nav>
          </section>`;
      }
      ```

      `register.js`, `login.js`, and `forgotPassword.js` follow the same shape (`renderRegister`,
      `renderLogin`, `renderForgotPassword`), each with `data-view="register"` / `"login"` /
      `"forgot-password"` and links back to the other three.
    files:
      - "public/client/views/home.js"
      - "public/client/views/login.js"
      - "public/client/views/register.js"
      - "public/client/views/forgotPassword.js"
    rationale: |
      The ACs only require that navigating to/rendering each view works correctly, not any specific
      view content or wiring to the existing login/register APIs - that functional wiring belongs to
      view-specific stories. These placeholders exist so the router has four real, distinct,
      cross-linked targets to route between and the ACs are checkable end-to-end.
  - description: |
      Add the app shell HTML and the browser entry point that wires `Router` to the four views and
      mounts it into `#app`.

      ```html
      <!-- public/index.html -->
      <!doctype html>
      <html lang="en">
      <head><meta charset="utf-8" /><title>Pizza App</title></head>
      <body>
        <div id="app"></div>
        <script type="module" src="/client/main.js"></script>
      </body>
      </html>
      ```

      ```js
      // public/client/main.js
      import { Router } from "./router.js";
      import { renderHome } from "./views/home.js";
      import { renderLogin } from "./views/login.js";
      import { renderRegister } from "./views/register.js";
      import { renderForgotPassword } from "./views/forgotPassword.js";

      const router = new Router({
        window,
        container: document.getElementById("app"),
        views: {
          home: renderHome,
          login: renderLogin,
          register: renderRegister,
          "forgot-password": renderForgotPassword,
        },
      });
      router.renderForCurrentPath();
      ```
    files:
      - "public/index.html"
      - "public/client/main.js"
    rationale: |
      `main.js` is deliberately thin wiring with no branching logic, mirroring how this repo's own
      `src/server.ts` (the Node bootstrap) has no tests of its own - only `src/app.ts`'s behaviour is
      tested, via `startTestServer()`. Likewise `router.test.ts` exercises `Router` directly rather
      than importing `main.js`.
  - description: |
      Add a small static-asset module and wire it into `src/app.ts`'s route dispatch: an
      explicit allowlist of the four SPA routes serves `index.html`, and an explicit allowlist of
      client JS files serves them under `/client/*` - both as fixed maps (no generic directory
      traversal), matching this repo's existing preference for explicit route matching over
      general-purpose middleware.

      ```ts
      // src/staticAssets.ts
      import { readFile } from "node:fs/promises";
      import path from "node:path";
      import type { ServerResponse } from "node:http";

      const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");

      const CLIENT_ASSETS: Record<string, string> = {
        "/client/main.js": "client/main.js",
        "/client/router.js": "client/router.js",
        "/client/views/home.js": "client/views/home.js",
        "/client/views/login.js": "client/views/login.js",
        "/client/views/register.js": "client/views/register.js",
        "/client/views/forgotPassword.js": "client/views/forgotPassword.js",
      };

      export async function serveAppShell(res: ServerResponse): Promise<void> {
        const html = await readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      }

      export async function serveClientAsset(res: ServerResponse, pathname: string): Promise<boolean> {
        const relativePath = CLIENT_ASSETS[pathname];
        if (!relativePath) return false;
        const contents = await readFile(path.join(PUBLIC_DIR, relativePath), "utf8");
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(contents);
        return true;
      }
      ```

      Added near the top of `handleRequest` in `src/app.ts`, before the existing JSON-API routing:

      ```ts
      const SPA_ROUTES = new Set(["/", "/login", "/register", "/forgot-password"]);

      if (method === "GET" && SPA_ROUTES.has(url.pathname)) {
        await serveAppShell(res);
        return;
      }
      if (method === "GET" && url.pathname.startsWith("/client/")) {
        const served = await serveClientAsset(res, url.pathname);
        if (served) return;
      }
      ```
    files:
      - "src/staticAssets.ts"
      - "src/app.ts"
    rationale: |
      `createApp`/`handleRequest` in `src/app.ts` is this repo's single composition root and route
      dispatcher today (see the existing `route === "POST /auth/login"` string-comparison style) -
      the SPA fallback must be dispatched the same way rather than introducing a second server or a
      generic static-file middleware, which would be more than this story needs.
tests:
  - |
    AC1 - GIVEN the user is on any of the four views WHEN they use an in-app navigation link to move
    to another view THEN the destination view renders without a full page reload.

    ```js
    // test/router.test.ts
    import { test } from "node:test";
    import assert from "node:assert/strict";
    import { JSDOM } from "jsdom";
    import { Router } from "../public/client/router.js";
    import { renderHome } from "../public/client/views/home.js";
    import { renderLogin } from "../public/client/views/login.js";

    const views = { home: renderHome, login: renderLogin };

    test("AC1: clicking an in-app link renders the destination view via pushState, not a real navigation", () => {
      const dom = new JSDOM("<div id=\"app\"></div>", { url: "http://localhost/" });
      const container = dom.window.document.getElementById("app");
      const pushStateCalls: unknown[][] = [];
      dom.window.history.pushState = (...args: unknown[]) => pushStateCalls.push(args);

      const router = new Router({ window: dom.window, container, views });
      router.renderForCurrentPath();

      const link = container.querySelector('a[href="/login"]') as HTMLAnchorElement;
      const clickEvent = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(clickEvent);

      assert.equal(clickEvent.defaultPrevented, true);
      assert.equal(pushStateCalls.length, 1);
      assert.equal(pushStateCalls[0][2], "/login");
      assert.match(container.innerHTML, /data-view="login"/);
    });
    ```
  - |
    AC2 - GIVEN the app is loaded WHEN the user navigates directly to the URL corresponding to any of
    the four views THEN the corresponding view is rendered without a full page reload.

    Server half - the URL must serve the SPA shell directly (200, same HTML), not a 404 or redirect:
    ```ts
    // test/appShellRouting.test.ts
    import { test } from "node:test";
    import assert from "node:assert/strict";
    import { startTestServer } from "./testServer.ts";

    test("AC2: direct navigation to each of the four view URLs serves the app shell", async () => {
      const server = await startTestServer();
      try {
        for (const path of ["/", "/login", "/register", "/forgot-password"]) {
          const res = await fetch(`${server.baseUrl}${path}`);
          assert.equal(res.status, 200);
          const html = await res.text();
          assert.match(html, /<div id="app">/);
        }
      } finally {
        await server.close();
      }
    });
    ```

    Client half - once loaded, the router must resolve the correct view from the URL alone, with no
    extra navigation call:
    ```js
    // test/router.test.ts
    test("AC2: initial render resolves the view from the current URL without navigating again", () => {
      const dom = new JSDOM("<div id=\"app\"></div>", { url: "http://localhost/register" });
      const container = dom.window.document.getElementById("app");
      let pushStateCallCount = 0;
      dom.window.history.pushState = () => { pushStateCallCount += 1; };

      const router = new Router({ window: dom.window, container, views: { register: renderRegister } });
      router.renderForCurrentPath();

      assert.match(container.innerHTML, /data-view="register"/);
      assert.equal(pushStateCallCount, 0);
    });
    ```
  - |
    AC3 - GIVEN any view is active WHEN the browser back/forward buttons are used THEN the correct
    view renders without a full page reload.

    ```js
    // test/router.test.ts
    test("AC3: a popstate event (browser back/forward) re-renders the matching view", () => {
      const dom = new JSDOM("<div id=\"app\"></div>", { url: "http://localhost/" });
      const container = dom.window.document.getElementById("app");
      dom.window.history.pushState = (_state: unknown, _title: string, url: string) => {
        dom.reconfigure({ url: `http://localhost${url}` });
      };

      const router = new Router({ window: dom.window, container, views: { home: renderHome, login: renderLogin } });
      router.renderForCurrentPath();
      router.navigate("/login");
      assert.match(container.innerHTML, /data-view="login"/);

      dom.reconfigure({ url: "http://localhost/" });
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));

      assert.match(container.innerHTML, /data-view="home"/);
    });
    ```
assumptions_or_open_questions:
  - "This repo had no frontend/UI layer at all before this story (no served HTML, no client JS, no Register/Login/Forgot Password/Home views). This plan creates all four as minimal placeholder markup - a heading plus cross-navigation links only - since the ACs concern navigation behaviour, not view content; wiring the actual login/register/forgot-password functionality to the existing backend APIs is assumed to be the scope of separate, view-specific stories."
  - "URL slugs for the four views are assumed to be '/', '/login', '/register', and '/forgot-password' (Home = '/'); the story doesn't specify exact paths, so please confirm or correct these."
  - "The route-to-view mapping is necessarily duplicated in two places - `SPA_ROUTES`/dispatch in `src/app.ts` (server, TypeScript, Node) and `ROUTES` in `public/client/router.js` (browser, plain JS) - because this repo has no bundler or shared-module step between server and browser code. A mismatch between these two lists is a real drift risk to watch for in review, not something this plan can eliminate structurally."
  - "AC1 says 'a link or button'; this plan implements only link-based navigation (four cross-linked views), since one working mechanism satisfies the AC as written. A button would call the same `router.navigate(path)` method if added later."
  - "No visual styling or design-system integration is included for the four placeholder views (unstyled HTML) since no AC requires specific visual content, only correct view/URL/back-forward behaviour."
  - "jsdom is added purely as a devDependency for testing the browser Router class; it is never shipped to the browser or imported by any runtime (server or client) code."
package_dependencies:
  - name: "jsdom"
    version: "^25.0.1"
    ecosystem: "npm"
    rationale: |
      Needed to unit test the browser `Router` class's click interception, `pushState` navigation,
      and `popstate` handling against real DOM/History/Event APIs - Node's built-in test runner has
      no DOM, and this repo has no existing DOM-testing dependency, since this is the first UI code
      in the codebase.
  - name: "@types/jsdom"
    version: "^21.1.7"
    ecosystem: "npm"
    rationale: |
      TypeScript type declarations for `jsdom` so `test/router.test.ts` type-checks under this
      repo's strict `tsconfig.json`; the `jsdom` package itself does not ship bundled types.
notes: |
  Route dispatch in `src/app.ts` today is a flat set of exact `${method} ${pathname}` string
  comparisons for the JSON API. The SPA fallback reuses that same exact-match style (a `Set` of the
  four known paths) rather than a generic catch-all/static-directory server, both to avoid a path
  traversal surface and to stay consistent with how every other route in this file is matched.

  Layering/call-graph for the touched modules, plus their real existing callers/callees read while
  planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: SPA route dispatch)"]
    staticAssets["src/staticAssets.ts (new)"]
    indexHtml["public/index.html (new)"]
    mainJs["public/client/main.js (new)"]
    router["public/client/router.js (new)"]
    views["public/client/views/*.js (new: home, login, register, forgotPassword)"]
    serverTest["test/appShellRouting.test.ts (new)"]
    routerTest["test/router.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"GET /, /login, /register, /forgot-password"| staticAssets
    app -->|"GET /client/*"| staticAssets
    staticAssets -->|"reads file contents of"| indexHtml
    staticAssets -->|"reads file contents of"| mainJs
    staticAssets -->|"reads file contents of"| router
    staticAssets -->|"reads file contents of"| views
    mainJs -->|"new Router(...)"| router
    mainJs -->|"passes view renderers to"| views
    router -->|"calls views[name]() to render into #app"| views
    serverTest -->|"drives via fetch()"| app
    serverTest -->|"startTestServer()"| testServer
    routerTest -->|"imports and drives directly (jsdom, no server involved)"| router
    routerTest -->|"imports directly"| views

    classDef touched fill:#f96,color:#000
    class app,staticAssets,indexHtml,mainJs,router,views,serverTest,routerTest touched
  ```
