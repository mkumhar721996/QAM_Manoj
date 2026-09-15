import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";

test("createApp fails fast when STRIPE_SECRET_KEY is not configured and no stripeGateway is injected", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    assert.throws(() => createApp(), /STRIPE_SECRET_KEY environment variable must be set/);
  } finally {
    if (original !== undefined) {
      process.env.STRIPE_SECRET_KEY = original;
    }
  }
});
