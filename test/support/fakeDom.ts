// Minimal, dependency-free DOM/History test doubles for exercising public/client/router.js.
//
// This repo has no network access to the npm registry in this environment, so a real DOM
// testing library (e.g. jsdom) cannot be installed. These fakes implement just enough of the
// EventTarget / anchor-element / History surface that Router actually calls, so Router itself
// is exercised as real production code against real click/pushState/popstate call sequences.

export interface FakeAnchorElement {
  tagName: "A";
  getAttribute(name: string): string | null;
  closest(selector: string): FakeAnchorElement | null;
}

export interface FakeHeadingElement {
  tagName: "H1";
  focus(): void;
}

export interface FakeClickEvent {
  type: "click";
  target: FakeAnchorElement;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export interface FakeContainer {
  innerHTML: string;
  addEventListener(type: string, handler: (event: FakeClickEvent) => void): void;
  querySelector(selector: string): FakeAnchorElement | FakeHeadingElement | null;
  dispatchClick(target: FakeAnchorElement): FakeClickEvent;
  focusCallCount: number;
}

export interface FakeWindow {
  location: { pathname: string };
  history: { pushState(state: unknown, title: string, url: string): void };
  addEventListener(type: string, handler: () => void): void;
  dispatchPopstate(): void;
}

function parseAnchorAttributes(anchorTag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrPattern = /([\w-]+)(?:="([^"]*)")?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(anchorTag)) !== null) {
    const [, name, value] = match;
    if (name === "a") continue;
    attributes[name] = value ?? "";
  }
  return attributes;
}

function makeAnchor(attributes: Record<string, string>): FakeAnchorElement {
  return {
    tagName: "A",
    getAttribute: (name: string) => (name in attributes ? attributes[name] : null),
    closest(selector: string) {
      return matchesSelector(attributes, selector) ? this : null;
    },
  };
}

function matchesSelector(attributes: Record<string, string>, selector: string): boolean {
  const match = selector.match(/^a\[([\w-]+)(?:="([^"]*)")?\]$/);
  if (!match) return false;
  const [, attrName, attrValue] = match;
  if (!(attrName in attributes)) return false;
  if (attrValue !== undefined && attributes[attrName] !== attrValue) return false;
  return true;
}

export function createFakeContainer(): FakeContainer {
  const listeners = new Map<string, Array<(event: FakeClickEvent) => void>>();
  let html = "";
  let focusCallCount = 0;

  return {
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
    },
    get focusCallCount() {
      return focusCallCount;
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    querySelector(selector: string) {
      if (selector === "h1") {
        if (!/<h1[\s>]/.test(html)) return null;
        return { tagName: "H1", focus: () => { focusCallCount += 1; } };
      }
      const anchorTagPattern = /<a\s+([^>]*)>/g;
      let match: RegExpExecArray | null;
      while ((match = anchorTagPattern.exec(html)) !== null) {
        const attributes = parseAnchorAttributes(match[1]);
        if (matchesSelector(attributes, selector)) {
          return makeAnchor(attributes);
        }
      }
      return null;
    },
    dispatchClick(target: FakeAnchorElement) {
      const event: FakeClickEvent = {
        type: "click",
        target,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (const handler of listeners.get("click") ?? []) {
        handler(event);
      }
      return event;
    },
  };
}

export function createFakeWindow(initialPath: string): FakeWindow {
  const listeners = new Map<string, Array<() => void>>();
  const location = { pathname: initialPath };

  return {
    location,
    history: {
      pushState(_state: unknown, _title: string, url: string) {
        location.pathname = url;
      },
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatchPopstate() {
      for (const handler of listeners.get("popstate") ?? []) {
        handler();
      }
    },
  };
}
