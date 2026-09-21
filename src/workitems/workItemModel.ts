export interface WorkItem {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  description: string | null;
  parentId: string | null;
  dependsOnIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkItemInput {
  kind: string;
  title: string;
  description?: string | null;
  parentId?: string | null;
  dependsOnIds?: string[];
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string | null;
  parentId?: string | null;
  dependsOnIds?: string[];
}
