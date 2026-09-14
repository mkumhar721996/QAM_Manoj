import { hashPassword } from "../../auth/passwordHasher.ts";

export type Role = "customer" | "provider" | "admin";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
}

export const TEST_PASSWORD = "test-password";

const testUserSeeds: Array<Omit<User, "passwordHash">> = [
  { id: "user-customer-1", username: "customer1", role: "customer" },
  { id: "user-provider-1", username: "provider1", role: "provider" },
  { id: "user-provider-2", username: "provider2", role: "provider" },
  { id: "user-admin-1", username: "admin1", role: "admin" },
];

export const testUsers: User[] = await Promise.all(
  testUserSeeds.map(async (seed) => ({ ...seed, passwordHash: await hashPassword(TEST_PASSWORD) })),
);
