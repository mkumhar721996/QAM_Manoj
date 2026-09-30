import type { Project } from "../projects/projectModel.ts";
import type { ProjectRepository } from "../projects/projectRepository.ts";
import type { CreateWorkItemInput, UpdateWorkItemInput, WorkItem } from "./workItemModel.ts";
import type { WorkItemRepository } from "./workItemRepository.ts";

export class ProjectNotFoundError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(`project not found: ${projectId}`);
    this.projectId = projectId;
  }
}

export class ProjectAccessDeniedError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(`access denied to project: ${projectId}`);
    this.projectId = projectId;
  }
}

export class SequenceCapacityExceededError extends Error {
  readonly keyKindPair: string;
  constructor(keyKindPair: string) {
    super(`sequence capacity exceeded for ${keyKindPair}`);
    this.keyKindPair = keyKindPair;
  }
}

export class WorkItemNotFoundError extends Error {
  readonly workItemId: string;
  constructor(workItemId: string) {
    super(`work item not found: ${workItemId}`);
    this.workItemId = workItemId;
  }
}

export class BlockingDependentsError extends Error {
  readonly blockingIds: string[];
  constructor(blockingIds: string[]) {
    super(`cannot delete work item: blocked by ${blockingIds.join(", ")}`);
    this.blockingIds = blockingIds;
  }
}

export class WorkItemService {
  private projectRepository: ProjectRepository;
  private workItemRepository: WorkItemRepository;

  constructor(projectRepository: ProjectRepository, workItemRepository: WorkItemRepository) {
    this.projectRepository = projectRepository;
    this.workItemRepository = workItemRepository;
  }

  private assertAccess(project: Project | undefined, projectId: string, userId: string): Project {
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    if (!this.projectRepository.hasAccess(project, userId)) {
      throw new ProjectAccessDeniedError(projectId);
    }
    return project;
  }

  createWorkItem(projectId: string, userId: string, input: CreateWorkItemInput, now: number = Date.now()): WorkItem {
    const project = this.assertAccess(this.projectRepository.findById(projectId), projectId, userId);
    const sequence = this.workItemRepository.nextSequence(project.key, input.kind);
    if (sequence === null) {
      throw new SequenceCapacityExceededError(`${project.key}-${input.kind}`);
    }
    const id = `${project.key}-${input.kind}-${String(sequence).padStart(3, "0")}`;
    const item: WorkItem = {
      id,
      projectId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      dependsOnIds: input.dependsOnIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.workItemRepository.save(item);
    return item;
  }

  listWorkItems(projectId: string, userId: string): WorkItem[] {
    const project = this.assertAccess(this.projectRepository.findById(projectId), projectId, userId);
    return this.workItemRepository.findByProjectId(project.id);
  }

  getWorkItem(id: string, userId: string): WorkItem | undefined {
    const item = this.workItemRepository.findById(id);
    if (!item) {
      return undefined;
    }
    this.assertAccess(this.projectRepository.findById(item.projectId), item.projectId, userId);
    return item;
  }

  updateWorkItem(id: string, userId: string, patch: UpdateWorkItemInput, now: number = Date.now()): WorkItem | undefined {
    const existing = this.workItemRepository.findById(id);
    if (!existing) {
      return undefined;
    }
    this.assertAccess(this.projectRepository.findById(existing.projectId), existing.projectId, userId);
    const updated: WorkItem = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      ...(patch.dependsOnIds !== undefined ? { dependsOnIds: patch.dependsOnIds } : {}),
      updatedAt: now,
    };
    this.workItemRepository.save(updated);
    return updated;
  }

  deleteWorkItem(id: string, userId: string): void {
    const existing = this.workItemRepository.findById(id);
    if (!existing) {
      throw new WorkItemNotFoundError(id);
    }
    this.assertAccess(this.projectRepository.findById(existing.projectId), existing.projectId, userId);
    const blockingIds = [
      ...this.workItemRepository.findChildren(id),
      ...this.workItemRepository.findDependents(id),
    ].map((i) => i.id);
    if (blockingIds.length > 0) {
      throw new BlockingDependentsError(blockingIds);
    }
    this.workItemRepository.delete(id);
  }
}
