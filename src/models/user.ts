export type Role = "TESTER" | "QA_LEAD" | "ADMIN";

export interface User {
  id: string;
  role: Role;
}
