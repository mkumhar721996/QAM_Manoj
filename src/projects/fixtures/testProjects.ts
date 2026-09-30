import type { Project } from "../projectModel.ts";

export const testProjects: Project[] = [
  { id: "project-apollo", key: "APOLLO", tenantId: "tenant-1", memberUserIds: ["user-customer-1", "user-admin-1"] },
  { id: "project-zephyr", key: "ZEPHYR", tenantId: "tenant-2", memberUserIds: ["user-provider-1"] },
];
