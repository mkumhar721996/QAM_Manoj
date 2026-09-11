"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app.cjs");

test("createApp refuses to start without an explicit token secret", () => {
  assert.throws(() => createApp({}), /tokenSecret/i);
  assert.throws(() => createApp(), /tokenSecret/i);
});

test("createApp starts fine when an explicit token secret is provided", () => {
  const app = createApp({ tokenSecret: "test-secret" });
  assert.ok(app.server);
});
