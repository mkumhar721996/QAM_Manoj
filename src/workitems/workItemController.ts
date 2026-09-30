import type { ControllerResponse } from "../auth/authController.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import { ERROR_CODES, errorEnvelope } from "../errors/errorEnvelope.ts";
import type { WorkItem } from "./workItemModel.ts";
import {
  BlockingDependentsError,
  ProjectAccessDeniedError,
  ProjectNotFoundError,
  SequenceCapacityExceededError,
  WorkItemNotFoundError,
  WorkItemService,
} from "./workItemService.ts";

function extractBearerPayload(authorizationHeader: string | undefined) {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  return token ? verifyAccessToken(token) : null;
}

function serializeWorkItem(item: WorkItem): Record<string, unknown> {
  return {
    id: item.id,
    project_id: item.projectId,
    kind: item.kind,
    title: item.title,
    description: item.description,
    parent_id: item.parentId,
    depends_on_ids: item.dependsOnIds,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export function handleCreateWorkItem(
  workItemService: WorkItemService,
  authorizationHeader: string | undefined,
  projectId: string,
  requestBody: unknown,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, "missing or invalid authorization") };
  }

  const { kind, title, description, parent_id: parentId, depends_on_ids: dependsOnIds } = asRecord(requestBody);
  if (
    typeof kind !== "string" ||
    kind.length === 0 ||
    typeof title !== "string" ||
    title.length === 0 ||
    (description !== undefined && description !== null && typeof description !== "string") ||
    (parentId !== undefined && parentId !== null && typeof parentId !== "string") ||
    (dependsOnIds !== undefined &&
      (!Array.isArray(dependsOnIds) || !dependsOnIds.every((d) => typeof d === "string")))
  ) {
    return { status: 400, body: errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "invalid work item payload") };
  }

  try {
    const item = workItemService.createWorkItem(projectId, payload.userId, {
      kind,
      title,
      description: description as string | null | undefined,
      parentId: parentId as string | null | undefined,
      dependsOnIds: dependsOnIds as string[] | undefined,
    });
    return { status: 201, body: serializeWorkItem(item) };
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return { status: 404, body: errorEnvelope(ERROR_CODES.NOT_FOUND, err.message, { project_id: projectId }) };
    }
    if (err instanceof ProjectAccessDeniedError) {
      return { status: 403, body: errorEnvelope(ERROR_CODES.FORBIDDEN, err.message, { project_id: projectId }) };
    }
    if (err instanceof SequenceCapacityExceededError) {
      return { status: 409, body: errorEnvelope(ERROR_CODES.CONFLICT, err.message) };
    }
    throw err;
  }
}

export function handleGetWorkItem(
  workItemService: WorkItemService,
  authorizationHeader: string | undefined,
  workItemId: string,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, "missing or invalid authorization") };
  }
  try {
    const item = workItemService.getWorkItem(workItemId, payload.userId);
    if (!item) {
      return { status: 404, body: errorEnvelope(ERROR_CODES.NOT_FOUND, `work item not found: ${workItemId}`) };
    }
    return { status: 200, body: serializeWorkItem(item) };
  } catch (err) {
    if (err instanceof ProjectAccessDeniedError) {
      return { status: 403, body: errorEnvelope(ERROR_CODES.FORBIDDEN, err.message) };
    }
    throw err;
  }
}

export function handleUpdateWorkItem(
  workItemService: WorkItemService,
  authorizationHeader: string | undefined,
  workItemId: string,
  requestBody: unknown,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, "missing or invalid authorization") };
  }

  const { title, description, parent_id: parentId, depends_on_ids: dependsOnIds } = asRecord(requestBody);
  if (
    (title !== undefined && typeof title !== "string") ||
    (description !== undefined && description !== null && typeof description !== "string") ||
    (parentId !== undefined && parentId !== null && typeof parentId !== "string") ||
    (dependsOnIds !== undefined &&
      (!Array.isArray(dependsOnIds) || !dependsOnIds.every((d) => typeof d === "string")))
  ) {
    return { status: 400, body: errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "invalid work item payload") };
  }

  try {
    const item = workItemService.updateWorkItem(workItemId, payload.userId, {
      title: title as string | undefined,
      description: description as string | null | undefined,
      parentId: parentId as string | null | undefined,
      dependsOnIds: dependsOnIds as string[] | undefined,
    });
    return { status: 200, body: { work_item: item ? serializeWorkItem(item) : null } };
  } catch (err) {
    if (err instanceof ProjectAccessDeniedError) {
      return { status: 403, body: errorEnvelope(ERROR_CODES.FORBIDDEN, err.message) };
    }
    throw err;
  }
}

export function handleDeleteWorkItem(
  workItemService: WorkItemService,
  authorizationHeader: string | undefined,
  workItemId: string,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: errorEnvelope(ERROR_CODES.UNAUTHORIZED, "missing or invalid authorization") };
  }
  try {
    workItemService.deleteWorkItem(workItemId, payload.userId);
    return { status: 204 };
  } catch (err) {
    if (err instanceof WorkItemNotFoundError) {
      return { status: 404, body: errorEnvelope(ERROR_CODES.NOT_FOUND, err.message) };
    }
    if (err instanceof ProjectAccessDeniedError) {
      return { status: 403, body: errorEnvelope(ERROR_CODES.FORBIDDEN, err.message) };
    }
    if (err instanceof BlockingDependentsError) {
      return {
        status: 409,
        body: errorEnvelope(ERROR_CODES.CONFLICT, err.message, { blocking_ids: err.blockingIds }),
      };
    }
    throw err;
  }
}
