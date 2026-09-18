import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { log, recordRequest } from "./observability.ts";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, "index.html");

const CLIENT_ASSETS: Record<string, string> = {
  "/client/main.js": "client/main.js",
  "/client/dom.js": "client/dom.js",
  "/client/router.js": "client/router.js",
  "/client/views/home.js": "client/views/home.js",
  "/client/views/login.js": "client/views/login.js",
  "/client/views/register.js": "client/views/register.js",
  "/client/views/forgotPassword.js": "client/views/forgotPassword.js",
};

// These files ship with the app and never change at runtime, so once a read
// succeeds it is cached in memory to avoid re-reading disk on every request.
const fileCache = new Map<string, string>();

async function readCached(absolutePath: string): Promise<string> {
  const cached = fileCache.get(absolutePath);
  if (cached !== undefined) return cached;
  const contents = await readFile(absolutePath, "utf8");
  fileCache.set(absolutePath, contents);
  return contents;
}

export async function serveAppShell(res: ServerResponse): Promise<void> {
  const startedAt = Date.now();
  let html: string;
  try {
    html = await readCached(INDEX_HTML_PATH);
  } catch (err) {
    log("error", "failed to read app shell", { file: "index.html", error: String(err) });
    recordRequest("app_shell", Date.now() - startedAt, true);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("internal server error");
    return;
  }
  recordRequest("app_shell", Date.now() - startedAt, false);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(html);
}

export async function serveClientAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  const startedAt = Date.now();
  const relativePath = CLIENT_ASSETS[pathname];
  if (!relativePath) {
    log("warn", "requested client asset is not in the allowlist", { pathname });
    recordRequest("client_asset", Date.now() - startedAt, true);
    return false;
  }
  let contents: string;
  try {
    contents = await readCached(path.join(PUBLIC_DIR, relativePath));
  } catch (err) {
    log("error", "failed to read client asset", { pathname, file: relativePath, error: String(err) });
    recordRequest("client_asset", Date.now() - startedAt, true);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("internal server error");
    return true;
  }
  recordRequest("client_asset", Date.now() - startedAt, false);
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  res.end(contents);
  return true;
}
