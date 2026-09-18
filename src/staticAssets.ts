import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");

const CLIENT_ASSETS: Record<string, string> = {
  "/client/main.js": "client/main.js",
  "/client/router.js": "client/router.js",
  "/client/views/home.js": "client/views/home.js",
  "/client/views/login.js": "client/views/login.js",
  "/client/views/register.js": "client/views/register.js",
  "/client/views/forgotPassword.js": "client/views/forgotPassword.js",
};

export async function serveAppShell(res: ServerResponse): Promise<void> {
  const html = await readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

export async function serveClientAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  const relativePath = CLIENT_ASSETS[pathname];
  if (!relativePath) return false;
  const contents = await readFile(path.join(PUBLIC_DIR, relativePath), "utf8");
  res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
  res.end(contents);
  return true;
}
