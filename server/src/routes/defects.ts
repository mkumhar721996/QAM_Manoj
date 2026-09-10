import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAuth } from "../middleware/requireAuth.ts";
import { validateDefectInput } from "../validation/defectValidation.ts";
import { DefectRepository } from "../repositories/defectRepository.ts";
import { SEVERITY_OPTIONS, ENVIRONMENT_OPTIONS } from "../constants/defectOptions.ts";
import type { DefectInput } from "../models/defect.ts";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (raw.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function createDefectsRouter(repository: DefectRepository) {
  return async function handleDefectsRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const auth = requireAuth(req.headers as Record<string, string | undefined>);
    if (!auth.authenticated || auth.userId === null) {
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
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { errors: { body: "request body must be valid JSON" } });
        return true;
      }

      const validation = validateDefectInput(body);
      if (!validation.valid) {
        sendJson(res, 400, { errors: validation.errors });
        return true;
      }

      const created = repository.create(body as unknown as DefectInput, auth.userId);
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
