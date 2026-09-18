import { test } from "node:test";
import assert from "node:assert/strict";
import { requireElement } from "../public/client/dom.js";

test("requireElement returns the element when it exists", () => {
  const element = { id: "app" };
  assert.equal(requireElement(element, "App container"), element);
});

test("requireElement throws a descriptive error when the element is missing", () => {
  assert.throws(() => requireElement(null, "App container #app"), /App container #app not found/);
});
