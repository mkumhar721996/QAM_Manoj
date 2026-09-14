import type { ApplicationService } from "./applicationService.ts";
import { ApplicationNotFoundError, ApplicationNotResubmittableError, DocumentInfectedError } from "./applicationService.ts";
import { asRecord } from "../httpUtils.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

export async function handleResubmitApplication(
  applicationService: ApplicationService,
  applicationId: string,
  providerId: string,
  requestBody: unknown,
): Promise<ControllerResponse> {
  const { profile, documents } = asRecord(requestBody);

  try {
    const application = await applicationService.resubmit(applicationId, providerId, {
      profile: profile as Record<string, unknown> | undefined,
      newDocuments: documents as Array<{ fileName: string; contentBase64: string }> | undefined,
    });
    console.log(`application resubmitted: id=${application.id} providerId=${providerId}`);
    return { status: 200, body: { id: application.id, status: application.status } };
  } catch (err) {
    if (err instanceof ApplicationNotFoundError) {
      console.warn(`resubmit failed: application not found id=${applicationId} providerId=${providerId}`);
      return { status: 404, body: { error: "application not found" } };
    }
    if (err instanceof ApplicationNotResubmittableError) {
      console.warn(`resubmit failed: application not rejected id=${applicationId}`);
      return { status: 409, body: { error: "application is not rejected" } };
    }
    if (err instanceof DocumentInfectedError) {
      console.warn(`resubmit failed: ${err.message}`);
      return { status: 422, body: { error: err.message } };
    }
    throw err;
  }
}
