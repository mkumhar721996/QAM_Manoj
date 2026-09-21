import { testProjects } from "./fixtures/testProjects.ts";
import type { Project } from "./projectModel.ts";

export class ProjectRepository {
  private projectsById: Map<string, Project>;

  constructor(projects: Project[] = testProjects) {
    this.projectsById = new Map(projects.map((p) => [p.id, p]));
  }

  findById(projectId: string): Project | undefined {
    return this.projectsById.get(projectId);
  }

  hasAccess(project: Project, userId: string): boolean {
    return project.memberUserIds.includes(userId);
  }
}
