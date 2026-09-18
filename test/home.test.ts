import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startTestServer } from "./testServer.ts";
import { hasSession, initHome, SESSION_STORAGE_KEY } from "../src/web/home.js";

// This repo has no browser/DOM test tooling and no network access to install one (e.g. jsdom),
// so home.js's DOM interactions are driven here with a small hand-rolled fake DOM instead. It
// mirrors the real elements/nesting in src/web/home.html; the HTML tests below independently
// verify that the real markup file matches this shape.

class FakeElement {
  tagName: string;
  private attributes = new Map<string, string>();
  children: FakeElement[] = [];
  hidden = false;
  className = "";
  private listeners = new Map<string, Array<() => void>>();
  private _textContent = "";

  constructor(tagName = "div") {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, handler: () => void): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatchEvent(event: { type: string }): void {
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler();
    }
  }

  get textContent(): string {
    return this._textContent;
  }

  set textContent(value: string) {
    this._textContent = value;
  }

  querySelector(selector: string): FakeElement | null {
    return findFirst(this.children, selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return findAll(this.children, selector);
  }
}

function matchesSelector(el: FakeElement, selector: string): boolean {
  const match = selector.match(/^\[data-testid="([^"]+)"\]$/);
  if (!match) {
    throw new Error(`unsupported selector: ${selector}`);
  }
  return el.getAttribute("data-testid") === match[1];
}

function findFirst(nodes: FakeElement[], selector: string): FakeElement | null {
  for (const node of nodes) {
    if (matchesSelector(node, selector)) {
      return node;
    }
    const found = findFirst(node.children, selector);
    if (found) {
      return found;
    }
  }
  return null;
}

function findAll(nodes: FakeElement[], selector: string): FakeElement[] {
  const results: FakeElement[] = [];
  for (const node of nodes) {
    if (matchesSelector(node, selector)) {
      results.push(node);
    }
    results.push(...findAll(node.children, selector));
  }
  return results;
}

function createFakeHomeDocument() {
  const homeView = new FakeElement();
  homeView.setAttribute("data-testid", "home-view");
  homeView.hidden = true;

  const navbar = new FakeElement("nav");
  navbar.setAttribute("data-testid", "navbar");

  const logo = new FakeElement("span");
  logo.setAttribute("data-testid", "logo");
  logo.textContent = "PizzaBook";

  const logoutButton = new FakeElement("button");
  logoutButton.setAttribute("data-testid", "logout-button");

  navbar.appendChild(logo);
  navbar.appendChild(logoutButton);

  const storyStrip = new FakeElement();
  storyStrip.setAttribute("data-testid", "story-strip");

  const postFeed = new FakeElement();
  postFeed.setAttribute("data-testid", "post-feed");

  homeView.appendChild(navbar);
  homeView.appendChild(storyStrip);
  homeView.appendChild(postFeed);

  const roots = [homeView];

  return {
    document: {
      querySelector: (selector: string) => findFirst(roots, selector),
      querySelectorAll: (selector: string) => findAll(roots, selector),
      createElement: (tagName: string) => new FakeElement(tagName),
    },
    homeView,
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

function fakeLocation() {
  return { assign: mock.fn() };
}

const HOME_HTML = readFileSync(new URL("../src/web/home.html", import.meta.url), "utf8");

test("AC1: nav bar with logo and logout control is visible when a session exists", () => {
  const { document, homeView } = createFakeHomeDocument();
  initHome({ document, storage: fakeStorage({ [SESSION_STORAGE_KEY]: "{}" }), location: fakeLocation() });

  assert.equal(homeView.hidden, false);
  const navbar = document.querySelector('[data-testid="navbar"]')!;
  assert.ok(navbar.querySelector('[data-testid="logo"]'));
  assert.ok(navbar.querySelector('[data-testid="logout-button"]'));
});

test("AC1: the home markup contains a nav bar with the logo and a logout control", () => {
  const navBlock = HOME_HTML.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.match(navBlock, /data-testid="logo"/);
  assert.match(navBlock, /data-testid="logout-button"/);
});

test("AC2: clicking logout removes the session from storage", () => {
  const { document } = createFakeHomeDocument();
  const storage = fakeStorage({ [SESSION_STORAGE_KEY]: "{}" });
  initHome({ document, storage, location: fakeLocation() });

  document.querySelector('[data-testid="logout-button"]')!.dispatchEvent({ type: "click" });

  assert.equal(hasSession(storage), false);
});

test("AC3: clicking logout navigates to /login", () => {
  const { document } = createFakeHomeDocument();
  const location = fakeLocation();
  initHome({ document, storage: fakeStorage({ [SESSION_STORAGE_KEY]: "{}" }), location });

  document.querySelector('[data-testid="logout-button"]')!.dispatchEvent({ type: "click" });

  assert.equal(location.assign.mock.calls.length, 1);
  assert.equal(location.assign.mock.calls[0].arguments[0], "/login");
});

test("AC4: the home markup places the story strip above the post feed", () => {
  const storyStripIndex = HOME_HTML.indexOf('data-testid="story-strip"');
  const postFeedIndex = HOME_HTML.indexOf('data-testid="post-feed"');
  assert.ok(storyStripIndex >= 0);
  assert.ok(postFeedIndex >= 0);
  assert.ok(storyStripIndex < postFeedIndex);
});

test("AC5: at least three posts render with author, text, and timestamp", () => {
  const { document } = createFakeHomeDocument();
  initHome({ document, storage: fakeStorage({ [SESSION_STORAGE_KEY]: "{}" }), location: fakeLocation() });

  const posts = document.querySelectorAll('[data-testid="post"]');
  assert.ok(posts.length >= 3);
  for (const post of posts) {
    assert.ok(post.querySelector('[data-testid="post-author"]')!.textContent.trim().length > 0);
    assert.ok(post.querySelector('[data-testid="post-text"]')!.textContent.trim().length > 0);
    assert.ok(post.querySelector('[data-testid="post-timestamp"]')!.textContent.trim().length > 0);
  }
});

test("AC6: no session redirects to /login", () => {
  const { document } = createFakeHomeDocument();
  const location = fakeLocation();
  initHome({ document, storage: fakeStorage(), location });

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
    assert.match(loginRes.headers.get("content-type") ?? "", /text\/html/);
  } finally {
    await server.close();
  }
});

test("AC7: home content stays hidden and unpopulated with no session", () => {
  const { document, homeView } = createFakeHomeDocument();
  initHome({ document, storage: fakeStorage(), location: fakeLocation() });

  assert.equal(homeView.hidden, true);
  assert.equal(document.querySelectorAll('[data-testid="post"]').length, 0);
});

test("AC7: the home markup starts hidden so it is not rendered before the guard runs", () => {
  assert.match(HOME_HTML, /data-testid="home-view"[^>]*\bhidden\b/);
});
