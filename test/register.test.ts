import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { UserRepository } from "../src/users/userRepository.ts";

test("AC1: registering creates an account that can subsequently log in", async () => {
  const server = await startTestServer();
  try {
    const registerRes = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "test-password" }),
    });
    assert.equal(registerRes.status, 201);

    const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ada@example.com", password: "test-password" }),
    });
    assert.equal(loginRes.status, 200);
  } finally {
    await server.close();
  }
});

test("AC2: a successful registration returns a token that is immediately authenticated", async () => {
  const server = await startTestServer();
  try {
    const registerRes = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Grace Hopper", email: "grace@example.com", password: "test-password" }),
    });
    const { access_token: accessToken } = (await registerRes.json()) as { access_token: string };

    const sessionRes = await fetch(`${server.baseUrl}/auth/session`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(sessionRes.status, 200);
  } finally {
    await server.close();
  }
});

test("AC3/AC4: a duplicate email is rejected and no duplicate account is created", async () => {
  const userRepository = new UserRepository();
  const server = await startTestServer({ userRepository });
  try {
    const payload = { name: "Ada Lovelace", email: "dup@example.com", password: "test-password" };
    const first = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 201);
    const firstUserId = userRepository.findByUsername("dup@example.com")!.id;

    const second = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, name: "Someone Else" }),
    });
    assert.equal(second.status, 409);
    const body = (await second.json()) as { errors: { email: string } };
    assert.equal(body.errors.email, "An account with this email already exists");
    assert.equal(userRepository.findByUsername("dup@example.com")!.id, firstUserId);
  } finally {
    await server.close();
  }
});

test("AC5: a required field left empty produces a field-level validation error", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", email: "missingname@example.com", password: "test-password" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: { name?: string } };
    assert.equal(body.errors.name, "name is required");
  } finally {
    await server.close();
  }
});

test("AC6: an invalid email format produces a field-level validation error on the email field", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "not-an-email", password: "test-password" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: { email?: string } };
    assert.equal(body.errors.email, "email must be a valid email address");
  } finally {
    await server.close();
  }
});

test("AC7: invalid submissions are blocked and create no account", async () => {
  const userRepository = new UserRepository();
  const server = await startTestServer({ userRepository });
  try {
    await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", email: "blocked@example.com", password: "test-password" }),
    });
    await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "not-an-email", password: "test-password" }),
    });
    assert.equal(userRepository.findByUsername("blocked@example.com"), undefined);
  } finally {
    await server.close();
  }
});
