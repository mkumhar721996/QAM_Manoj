import { hashPassword } from "../../auth/passwordHasher.ts";

export type Role = "customer" | "provider" | "admin";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
}

export const TEST_PASSWORD = "test-password";

export const testUsers: User[] = [
  {
    id: "user-customer-1",
    username: "customer1",
    passwordHash: hashPassword(TEST_PASSWORD),
    role: "customer",
  },
  {
    id: "user-provider-1",
    username: "provider1",
    passwordHash: hashPassword(TEST_PASSWORD),
    role: "provider",
  },
  {
    id: "user-admin-1",
    username: "admin1",
    passwordHash: hashPassword(TEST_PASSWORD),
    role: "admin",
  },
];
