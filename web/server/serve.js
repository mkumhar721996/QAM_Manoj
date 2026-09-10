import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(webRoot, relativePath));

  if (!filePath.startsWith(webRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const contents = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(contents);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(Number(process.env.ARC_WEB_PORT ?? 3001), () => {
  console.log(`Defect tracker web app listening on port ${process.env.ARC_WEB_PORT ?? 3001}`);
});
