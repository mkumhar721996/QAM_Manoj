import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";

test("AC2: direct navigation to each of the four view URLs serves the app shell", async () => {
  const server = await startTestServer();
  try {
    for (const path of ["/", "/login", "/register", "/forgot-password"]) {
      const res = await fetch(`${server.baseUrl}${path}`);
      assert.equal(res.status, 200, `expected 200 for ${path}`);
      const html = await res.text();
      assert.match(html, /<div id="app">/);
    }
  } finally {
    await server.close();
  }
});

test("every client asset imported by main.js is served with a 200, not a 404", async () => {
  const server = await startTestServer();
  try {
    for (const path of [
      "/client/main.js",
      "/client/dom.js",
      "/client/router.js",
      "/client/views/home.js",
      "/client/views/login.js",
      "/client/views/register.js",
      "/client/views/forgotPassword.js",
    ]) {
      const res = await fetch(`${server.baseUrl}${path}`);
      assert.equal(res.status, 200, `expected 200 for ${path}`);
      assert.match(res.headers.get("content-type") ?? "", /application\/javascript/);
    }
  } finally {
    await server.close();
  }
});
