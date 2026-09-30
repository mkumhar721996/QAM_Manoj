import type { WorkItem } from "./workItemModel.ts";

const MAX_SEQUENCE = 999;

export class WorkItemRepository {
  private itemsById: Map<string, WorkItem>;
  private sequenceByKeyAndKind: Map<string, number>;

  constructor(items: WorkItem[] = [], sequenceOverrides: Map<string, number> = new Map()) {
    this.itemsById = new Map(items.map((i) => [i.id, i]));
    this.sequenceByKeyAndKind = new Map(sequenceOverrides);
  }

  nextSequence(projectKey: string, kind: string): number | null {
    const seqKey = `${projectKey}-${kind}`;
    const current = this.sequenceByKeyAndKind.get(seqKey) ?? 0;
    if (current >= MAX_SEQUENCE) {
      return null;
    }
    const next = current + 1;
    this.sequenceByKeyAndKind.set(seqKey, next);
    return next;
  }

  save(item: WorkItem): void {
    this.itemsById.set(item.id, item);
  }

  findById(id: string): WorkItem | undefined {
    return this.itemsById.get(id);
  }

  delete(id: string): void {
    this.itemsById.delete(id);
  }

  findChildren(parentId: string): WorkItem[] {
    return [...this.itemsById.values()].filter((item) => item.parentId === parentId);
  }

  findDependents(id: string): WorkItem[] {
    return [...this.itemsById.values()].filter((item) => item.dependsOnIds.includes(id));
  }

  findByProjectId(projectId: string): WorkItem[] {
    return [...this.itemsById.values()]
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
}
