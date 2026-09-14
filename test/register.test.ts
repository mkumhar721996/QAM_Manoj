import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { UserRepository } from "../src/users/userRepository.ts";

test("AC1: registering with a valid name, email, and password creates a provider account", async () => {
  const userRepository = new UserRepository([]);
  const server = await startTestServer({ userRepository });
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Provider", email: "ada@example.com", password: "test-password-1" }),
    });
    assert.equal(res.status, 201);

    const created = userRepository.findByUsername("ada@example.com");
    assert.equal(created?.role, "provider");
    assert.equal(created?.name, "Ada Provider");
  } finally {
    await server.close();
  }
});

test("AC2: registering logs the visitor in with a valid session", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Provider", email: "ada2@example.com", password: "test-password-1" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { access_token: string };

    const sessionRes = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    assert.equal(sessionRes.status, 200);
    const sessionBody = (await sessionRes.json()) as { role: string };
    assert.equal(sessionBody.role, "provider");
  } finally {
    await server.close();
  }
});

test("AC3: registering directs the visitor to the credential submission step", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Provider", email: "ada3@example.com", password: "test-password-1" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { next_step: string };
    assert.equal(body.next_step, "credential_submission");
  } finally {
    await server.close();
  }
});

test("AC4/AC5: registering with an already-registered email is rejected and does not create a duplicate account", async () => {
  const userRepository = new UserRepository([]);
  const server = await startTestServer({ userRepository });
  try {
    const firstRes = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "First Provider", email: "dup@example.com", password: "test-password-1" }),
    });
    assert.equal(firstRes.status, 201);
    const original = userRepository.findByUsername("dup@example.com");

    const secondRes = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Second Provider", email: "dup@example.com", password: "test-password-2" }),
    });
    assert.equal(secondRes.status, 409);
    const secondBody = (await secondRes.json()) as { error: string };
    assert.equal(secondBody.error, "An account with this email already exists");

    const after = userRepository.findByUsername("dup@example.com");
    assert.equal(after?.id, original?.id);
    assert.equal(after?.name, "First Provider");
  } finally {
    await server.close();
  }
});

test("AC6/AC7: invalid field values produce field-adjacent errors and the form is not submitted", async () => {
  const userRepository = new UserRepository([]);
  const server = await startTestServer({ userRepository });
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", email: "not-an-email", password: "short" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: Record<string, string>; access_token?: string };
    assert.equal(body.errors.name, "Name is required");
    assert.equal(body.errors.email, "Enter a valid email address");
    assert.equal(body.errors.password, "Password must be at least 8 characters");
    assert.equal(body.access_token, undefined);

    assert.equal(userRepository.findByUsername("not-an-email"), undefined);
  } finally {
    await server.close();
  }
});
