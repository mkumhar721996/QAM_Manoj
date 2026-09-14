import type { ServerResponse } from "node:http";
import type { AccessTokenPayload } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import {
  ApplicationNotFoundError,
  ApplicationService,
  InvalidTransitionError,
  MissingRejectionReasonError,
  NoCredentialDocumentError,
  REJECTED_CTA_MESSAGE,
  SUBMISSION_CONFIRMATION_MESSAGE,
} from "./applicationService.ts";
import type { Application, ApplicationState } from "./applicationModel.ts";
import type { ApplicationEventBus } from "./applicationEventBus.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

function toStatusBody(application: Application): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: application.id,
    state: application.state,
  };

  if (application.state === "submitted") {
    body.message = SUBMISSION_CONFIRMATION_MESSAGE;
  }
  if (application.state === "rejected") {
    body.rejectionReason = application.rejectionReason;
    body.cta = REJECTED_CTA_MESSAGE;
  }

  return body;
}

export function handleSubmit(
  applicationService: ApplicationService,
  applicationId: string,
  auth: AccessTokenPayload | null,
): ControllerResponse {
  if (!auth) {
    return { status: 401, body: { error: "missing or invalid access token" } };
  }

  const application = applicationService.getStatus(applicationId);
  if (!application) {
    return { status: 404, body: { error: "Application not found" } };
  }
  if (application.providerId !== auth.userId) {
    return { status: 403, body: { error: "You do not have access to this application" } };
  }

  try {
    const updated = applicationService.submit(applicationId);
    return { status: 200, body: toStatusBody(updated) };
  } catch (err) {
    if (err instanceof NoCredentialDocumentError) {
      return { status: 400, body: { error: err.message } };
    }
    if (err instanceof InvalidTransitionError) {
      return { status: 400, body: { error: err.message } };
    }
    if (err instanceof ApplicationNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleGetStatus(
  applicationService: ApplicationService,
  applicationId: string,
  auth: AccessTokenPayload | null,
): ControllerResponse {
  if (!auth) {
    return { status: 401, body: { error: "missing or invalid access token" } };
  }

  const application = applicationService.getStatus(applicationId);
  if (!application) {
    return { status: 404, body: { error: "Application not found" } };
  }
  if (application.providerId !== auth.userId) {
    return { status: 403, body: { error: "You do not have access to this application" } };
  }

  return { status: 200, body: toStatusBody(application) };
}

export async function handleTransition(
  applicationService: ApplicationService,
  applicationId: string,
  auth: AccessTokenPayload | null,
  requestBody: unknown,
): Promise<ControllerResponse> {
  if (!auth) {
    return { status: 401, body: { error: "missing or invalid access token" } };
  }
  if (auth.role !== "admin") {
    return { status: 403, body: { error: "Only admins can transition an application" } };
  }

  const { state, rejectionReason } = asRecord(requestBody);
  if (typeof state !== "string") {
    return { status: 400, body: { error: "state is required" } };
  }

  try {
    const updated = await applicationService.transitionState(applicationId, state as ApplicationState, {
      rejectionReason: typeof rejectionReason === "string" ? rejectionReason : undefined,
    });
    return { status: 200, body: toStatusBody(updated) };
  } catch (err) {
    if (
      err instanceof InvalidTransitionError ||
      err instanceof MissingRejectionReasonError
    ) {
      return { status: 400, body: { error: err.message } };
    }
    if (err instanceof ApplicationNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleStatusStream(
  res: ServerResponse,
  eventBus: ApplicationEventBus,
  applicationService: ApplicationService,
  applicationId: string,
  auth: AccessTokenPayload | null,
): void {
  if (!auth) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "missing or invalid access token" }));
    return;
  }

  const application = applicationService.getStatus(applicationId);
  if (!application) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Application not found" }));
    return;
  }
  if (application.providerId !== auth.userId) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You do not have access to this application" }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const unsubscribe = eventBus.subscribe(auth.userId, (updated) => {
    if (updated.id !== applicationId) {
      return;
    }
    res.write(`data: ${JSON.stringify(toStatusBody(updated))}\n\n`);
  });

  res.on("close", unsubscribe);
}
