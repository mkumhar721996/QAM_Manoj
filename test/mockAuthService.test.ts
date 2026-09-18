import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../src/mockAuth/storage.ts";
import { UserStore } from "../src/mockAuth/userStore.ts";
import { SessionStore } from "../src/mockAuth/sessionStore.ts";
import {
  LocalAuthService,
  DuplicateUserError,
  InvalidCredentialsError,
} from "../src/mockAuth/localAuthService.ts";

test("AC1: a registered user is persisted and retrievable by a fresh store instance", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
  await service.register("alice@example.com", "test-password");

  const freshUserStore = new UserStore(storage);
  const found = freshUserStore.findByEmail("alice@example.com");
  assert.ok(found);
  assert.equal(found?.email, "alice@example.com");
});

test("Security: the stored user record never contains the plaintext password", async () => {
  const storage = createMemoryStorage();
  const userStore = new UserStore(storage);
  const service = new LocalAuthService(userStore, new SessionStore(storage));
  await service.register("alice@example.com", "test-password");

  const stored = userStore.findByEmail("alice@example.com");
  assert.ok(stored);
  assert.notEqual(stored?.passwordHash, "test-password");
  assert.equal(JSON.stringify(stored).includes("test-password"), false);
});

test("AC2: login with correct credentials marks the session authenticated", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
  await service.register("alice@example.com", "test-password");

  await service.login("alice@example.com", "test-password");

  assert.equal(service.isAuthenticated(), true);
});

test("AC3: login with a wrong password throws InvalidCredentialsError", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
  await service.register("alice@example.com", "test-password");

  await assert.rejects(
    () => service.login("alice@example.com", "wrong-password"),
    InvalidCredentialsError,
  );
});

test("AC4: a failed login (wrong password) does not write a session", async () => {
  const storage = createMemoryStorage();
  const sessionStore = new SessionStore(storage);
  const service = new LocalAuthService(new UserStore(storage), sessionStore);
  await service.register("alice@example.com", "test-password");

  await assert.rejects(() => service.login("alice@example.com", "wrong-password"));

  assert.equal(sessionStore.getCurrentSession(), null);
});

test("AC5: logout clears the authenticated session", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
  await service.register("alice@example.com", "test-password");
  await service.login("alice@example.com", "test-password");

  service.logout();

  assert.equal(service.isAuthenticated(), false);
});

test("AC6: resetting a password updates the stored record", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
  await service.register("alice@example.com", "test-password");

  await service.resetPassword("alice@example.com", "new-test-password");

  await assert.rejects(
    () => service.login("alice@example.com", "test-password"),
    InvalidCredentialsError,
  );
  await service.login("alice@example.com", "new-test-password");
  assert.equal(service.isAuthenticated(), true);
});

test("AC7: each user's session reflects only their own record", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));
  await service.register("alice@example.com", "alice-password");
  await service.register("bob@example.com", "bob-password");

  await service.login("alice@example.com", "alice-password");
  assert.equal(service.getCurrentUserEmail(), "alice@example.com");

  await service.login("bob@example.com", "bob-password");
  assert.equal(service.getCurrentUserEmail(), "bob@example.com");
});

test("AC8: registering twice with the same email fails and does not duplicate the record", async () => {
  const storage = createMemoryStorage();
  const userStore = new UserStore(storage);
  const service = new LocalAuthService(userStore, new SessionStore(storage));
  await service.register("alice@example.com", "test-password");

  await assert.rejects(
    () => service.register("alice@example.com", "another-test-password"),
    DuplicateUserError,
  );
  assert.equal(userStore.listAll().length, 1);
});

test("AC9: login with an email that has no record fails", async () => {
  const storage = createMemoryStorage();
  const service = new LocalAuthService(new UserStore(storage), new SessionStore(storage));

  await assert.rejects(
    () => service.login("nobody@example.com", "whatever"),
    InvalidCredentialsError,
  );
});

test("AC10: login with an unknown email does not write a session", async () => {
  const storage = createMemoryStorage();
  const sessionStore = new SessionStore(storage);
  const service = new LocalAuthService(new UserStore(storage), sessionStore);

  await assert.rejects(() => service.login("nobody@example.com", "whatever"));

  assert.equal(sessionStore.getCurrentSession(), null);
});
