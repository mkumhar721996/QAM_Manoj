import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/middleware/requireAuth.ts";

test("returns the user id when X-User-Id header is present", () => {
  const result = requireAuth({ "x-user-id": "jane.doe" });
  assert.deepEqual(result, { authenticated: true, userId: "jane.doe" });
});

test("rejects when X-User-Id header is missing", () => {
  const result = requireAuth({});
  assert.deepEqual(result, { authenticated: false, userId: null });
});

test("rejects when X-User-Id header is blank", () => {
  const result = requireAuth({ "x-user-id": "   " });
  assert.deepEqual(result, { authenticated: false, userId: null });
});
