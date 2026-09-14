import { createServer as createHttpServer, type Server } from "node:http";
import { createDefectsRouter } from "./routes/defects.ts";
import { DefectRepository } from "./repositories/defectRepository.ts";

export function createServer(): Server {
  const repository = new DefectRepository();
  const handleDefectsRequest = createDefectsRouter(repository);

  return createHttpServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      const handled = await handleDefectsRequest(req, res, pathname);
      if (!handled) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    } catch (error) {
      console.error("defect-tracker server: unhandled request error", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error" }));
      } else {
        res.end();
      }
    }
  });
}
