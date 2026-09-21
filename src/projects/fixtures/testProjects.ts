import type { Project } from "../projectModel.ts";

export const testProjects: Project[] = [
  { id: "project-apollo", key: "APOLLO", memberUserIds: ["user-customer-1", "user-admin-1"] },
  { id: "project-zephyr", key: "ZEPHYR", memberUserIds: ["user-provider-1"] },
];
