import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { UserRepository } from "../src/users/userRepository.ts";
import type { User } from "../src/users/fixtures/testUsers.ts";
import type { FacebookOAuthClient, FacebookProfile } from "../src/auth/facebookOAuthClient.ts";

class FakeFacebookOAuthClient implements FacebookOAuthClient {
  private readonly profile: FacebookProfile;

  constructor(profile: FacebookProfile) {
    this.profile = profile;
  }

  async exchangeCodeForProfile(): Promise<FacebookProfile> {
    return this.profile;
  }
}

test("AC1: a user with no existing account is registered on first Facebook OAuth completion", async () => {
  const userRepository = new UserRepository([]);
  const facebookOAuthClient = new FakeFacebookOAuthClient({
    facebookId: "fb-jordan-1",
    name: "Jordan Alvarez",
    email: "jordan.alvarez@example.com",
    avatarUrl: null,
  });
  const server = await startTestServer({ userRepository, facebookOAuthClient });
  try {
    const res = await fetch(`${server.baseUrl}/auth/facebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "valid-oauth-code" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { is_new_account: boolean };
    assert.equal(body.is_new_account, true);
    assert.equal(userRepository.findByFacebookId("fb-jordan-1")?.name, "Jordan Alvarez");
  } finally {
    await server.close();
  }
});

test("AC2: a returning Facebook user is logged into their existing account", async () => {
  const existingUser: User = {
    id: "user-fb-1",
    role: "customer",
    facebookId: "fb-jordan-1",
    name: "Jordan Alvarez",
    email: "jordan.alvarez@example.com",
  };
  const userRepository = new UserRepository([existingUser]);
  const facebookOAuthClient = new FakeFacebookOAuthClient({
    facebookId: "fb-jordan-1",
    name: "Jordan Alvarez",
    email: "jordan.alvarez@example.com",
    avatarUrl: null,
  });
  const server = await startTestServer({ userRepository, facebookOAuthClient });
  try {
    const res = await fetch(`${server.baseUrl}/auth/facebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "valid-oauth-code" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { is_new_account: boolean };
    assert.equal(body.is_new_account, false);
    assert.equal(userRepository.findByFacebookId("fb-jordan-1")?.id, "user-fb-1");
  } finally {
    await server.close();
  }
});

test("AC3: Facebook auth succeeds with only a code, no username or password", async () => {
  const facebookOAuthClient = new FakeFacebookOAuthClient({
    facebookId: "fb-jordan-1",
    name: "Jordan Alvarez",
    email: "jordan.alvarez@example.com",
    avatarUrl: null,
  });
  const server = await startTestServer({ userRepository: new UserRepository([]), facebookOAuthClient });
  try {
    const res = await fetch(`${server.baseUrl}/auth/facebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "valid-oauth-code" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    assert.equal(typeof body.access_token, "string");
    assert.equal(typeof body.refresh_token, "string");
  } finally {
    await server.close();
  }
});

test("AC4: no email/password registration endpoint exists", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "test-password" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
