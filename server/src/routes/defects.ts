import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAuth } from "../middleware/requireAuth.ts";
import { validateDefectInput } from "../validation/defectValidation.ts";
import { DefectRepository } from "../repositories/defectRepository.ts";
import { SEVERITY_OPTIONS, ENVIRONMENT_OPTIONS } from "../constants/defectOptions.ts";
import type { DefectInput } from "../models/defect.ts";
import { asRecord, PayloadTooLargeError, readJsonBody, sendJson } from "../../../src/httpUtils.ts";

function toDefectInput(body: Record<string, unknown>): DefectInput {
  return {
    title: body.title as DefectInput["title"],
    description: body.description as DefectInput["description"],
    severity: body.severity as DefectInput["severity"],
    reporter: body.reporter as DefectInput["reporter"],
    stepsToReproduce: body.stepsToReproduce as DefectInput["stepsToReproduce"],
    environment: body.environment as DefectInput["environment"],
  };
}

export function createDefectsRouter(repository: DefectRepository) {
  return async function handleDefectsRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const rawUserId = (req.headers as Record<string, string | undefined>)["x-user-id"];
    const auth = requireAuth(req.headers as Record<string, string | undefined>);
    if (!auth.authenticated || auth.userId === null) {
      console.warn("defects: authentication failed", { pathname, rawUserId: rawUserId ?? null });
      sendJson(res, 401, { error: "authentication required" });
      return true;
    }

    if (pathname === "/api/defects/options" && req.method === "GET") {
      sendJson(res, 200, { severity: SEVERITY_OPTIONS, environment: ENVIRONMENT_OPTIONS });
      return true;
    }

    if (pathname === "/api/defects" && req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = asRecord(await readJsonBody(req));
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          console.warn("defects: rejected oversized request body", { userId: auth.userId });
          sendJson(res, 413, { errors: { body: "request body too large" } });
          return true;
        }
        console.warn("defects: rejected invalid JSON body", { userId: auth.userId, error: String(error) });
        sendJson(res, 400, { errors: { body: "request body must be valid JSON" } });
        return true;
      }

      const validation = validateDefectInput(body);
      if (!validation.valid) {
        console.warn("defects: validation failed", { userId: auth.userId, errors: validation.errors });
        sendJson(res, 400, { errors: validation.errors });
        return true;
      }

      const created = repository.create(toDefectInput(body), auth.userId);
      console.info("defects: created defect", { defectId: created.id, userId: auth.userId });
      sendJson(res, 201, created);
      return true;
    }

    const detailMatch = /^\/api\/defects\/([^/]+)$/.exec(pathname);
    if (detailMatch && req.method === "GET") {
      const defect = repository.findById(detailMatch[1]);
      if (!defect) {
        sendJson(res, 404, { error: "defect not found" });
        return true;
      }
      sendJson(res, 200, defect);
      return true;
    }

    return false;
  };
}
