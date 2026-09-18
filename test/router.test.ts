import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../public/client/router.js";
import { renderHome } from "../public/client/views/home.js";
import { renderLogin } from "../public/client/views/login.js";
import { renderRegister } from "../public/client/views/register.js";
import { renderForgotPassword } from "../public/client/views/forgotPassword.js";
import { createFakeContainer, createFakeWindow } from "./support/fakeDom.ts";

const views = {
  home: renderHome,
  login: renderLogin,
  register: renderRegister,
  "forgot-password": renderForgotPassword,
};

test("AC1: clicking an in-app link renders the destination view via pushState, not a real navigation", () => {
  const window = createFakeWindow("/");
  const container = createFakeContainer();
  const pushStateCalls: unknown[][] = [];
  const originalPushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: [unknown, string, string]) => {
    pushStateCalls.push(args);
    originalPushState(...args);
  };

  const router = new Router({ window, container, views });
  router.renderForCurrentPath();

  const link = container.querySelector('a[href="/login"]');
  assert.ok(link, "expected home view to link to /login");

  const clickEvent = container.dispatchClick(link!);

  assert.equal(clickEvent.defaultPrevented, true);
  assert.equal(pushStateCalls.length, 1);
  assert.equal(pushStateCalls[0][2], "/login");
  assert.match(container.innerHTML, /data-view="login"/);
});

test("AC2: initial render resolves the view from the current URL without navigating again", () => {
  const window = createFakeWindow("/register");
  const container = createFakeContainer();
  let pushStateCallCount = 0;
  window.history.pushState = () => {
    pushStateCallCount += 1;
  };

  const router = new Router({ window, container, views: { register: renderRegister } });
  router.renderForCurrentPath();

  assert.match(container.innerHTML, /data-view="register"/);
  assert.equal(pushStateCallCount, 0);
});

test("AC3: a popstate event (browser back/forward) re-renders the matching view", () => {
  const window = createFakeWindow("/");
  const container = createFakeContainer();

  const router = new Router({ window, container, views: { home: renderHome, login: renderLogin } });
  router.renderForCurrentPath();
  router.navigate("/login");
  assert.match(container.innerHTML, /data-view="login"/);

  window.location.pathname = "/";
  window.dispatchPopstate();

  assert.match(container.innerHTML, /data-view="home"/);
});

test("navigating to the forgot-password route renders the forgot-password view", () => {
  const window = createFakeWindow("/");
  const container = createFakeContainer();

  const router = new Router({ window, container, views });
  router.renderForCurrentPath();
  router.navigate("/forgot-password");

  assert.match(container.innerHTML, /data-view="forgot-password"/);
});

test("Router ignores an in-app link with no href, without crashing or navigating", () => {
  const window = createFakeWindow("/");
  const container = createFakeContainer();
  let pushStateCallCount = 0;
  window.history.pushState = () => {
    pushStateCallCount += 1;
  };

  const router = new Router({ window, container, views: { home: renderHome } });
  router.renderForCurrentPath();

  const linkWithoutHref = {
    tagName: "A",
    getAttribute: () => null,
    closest(selector: string) {
      return selector === "a[data-link]" ? this : null;
    },
  };
  let defaultPrevented = false;
  router.handleClick({ target: linkWithoutHref, preventDefault: () => (defaultPrevented = true) });

  assert.equal(defaultPrevented, false);
  assert.equal(pushStateCallCount, 0);
});

test("navigate() ignores an unknown pathname and leaves the current view unchanged", () => {
  const window = createFakeWindow("/");
  const container = createFakeContainer();
  let pushStateCallCount = 0;
  window.history.pushState = () => {
    pushStateCallCount += 1;
  };

  const router = new Router({ window, container, views: { home: renderHome } });
  router.renderForCurrentPath();
  const homeHtml = container.innerHTML;

  router.navigate("/unknown-route");

  assert.equal(pushStateCallCount, 0);
  assert.equal(container.innerHTML, homeHtml);
});

test("renderForCurrentPath renders a not-found state instead of crashing when no view matches the current path", () => {
  const window = createFakeWindow("/unknown-route");
  const container = createFakeContainer();

  const router = new Router({ window, container, views: { home: renderHome } });
  router.renderForCurrentPath();

  assert.match(container.innerHTML, /data-view="not-found"/);
});

test("renderForCurrentPath renders a not-found state instead of crashing when the route's view function is missing", () => {
  const window = createFakeWindow("/forgot-password");
  const container = createFakeContainer();

  const router = new Router({ window, container, views: { home: renderHome } });
  router.renderForCurrentPath();

  assert.match(container.innerHTML, /data-view="not-found"/);
});
