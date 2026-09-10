import { createServer as createHttpServer, type Server } from "node:http";
import { createDefectsRouter } from "./routes/defects.ts";
import { DefectRepository } from "./repositories/defectRepository.ts";

export function createServer(): Server {
  const repository = new DefectRepository();
  const handleDefectsRequest = createDefectsRouter(repository);

  return createHttpServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    const handled = await handleDefectsRequest(req, res, pathname);
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
}
