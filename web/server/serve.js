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

const apiPort = Number(process.env.ARC_DEV_PORT ?? 8001);

createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(webRoot, relativePath));

  if (!filePath.startsWith(webRoot)) {
    console.warn("web server: blocked path traversal attempt", { requestedPath: pathname });
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    let contents = await readFile(filePath);
    if (filePath.endsWith("index.html")) {
      contents = Buffer.from(
        contents
          .toString("utf8")
          .replace("<head>", `<head>\n    <script>window.__DEFECT_TRACKER_API_PORT__ = ${apiPort};</script>`),
      );
    }
    const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(contents);
  } catch (error) {
    console.error("web server: failed to read requested file", { requestedPath: filePath, error: String(error) });
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(Number(process.env.ARC_WEB_PORT ?? 3001), () => {
  console.log(`Defect tracker web app listening on port ${process.env.ARC_WEB_PORT ?? 3001}`);
});
