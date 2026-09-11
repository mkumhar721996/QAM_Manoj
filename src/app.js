"use strict";

const http = require("node:http");

const { InMemoryUserRepository } = require("./repositories/InMemoryUserRepository");
const { TokenService } = require("./services/TokenService");
const { AuthService } = require("./services/AuthService");
const { AccountDeletionService } = require("./services/AccountDeletionService");
const { authenticateRequest } = require("./http/middleware/authenticate");
const { createAuthController } = require("./http/controllers/authController");
const { createAccountController } = require("./http/controllers/accountController");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

/**
 * Builds the app's dependency graph and an HTTP server. Exposes the
 * repository/services so tests can inspect state directly (e.g. asserting on
 * anonymised fields without a dedicated read endpoint).
 */
function createApp({ tokenSecret = "test-secret" } = {}) {
  const userRepository = new InMemoryUserRepository();
  const tokenService = new TokenService({ secret: tokenSecret, userRepository });
  const authService = new AuthService({ userRepository, tokenService });
  const accountDeletionService = new AccountDeletionService({ userRepository, tokenService });

  const authController = createAuthController({ authService });
  const accountController = createAccountController({ accountDeletionService });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

    try {
      if (req.method === "POST" && pathname === "/api/auth/login") {
        const body = await readJsonBody(req);
        const result = authController.login(body);
        return sendJson(res, result.status, result.body);
      }

      if (req.method === "POST" && pathname === "/api/auth/refresh") {
        const body = await readJsonBody(req);
        const result = authController.refresh(body);
        return sendJson(res, result.status, result.body);
      }

      if (req.method === "GET" && pathname === "/api/me") {
        const user = authenticateRequest(req, tokenService);
        if (!user) return sendJson(res, 401, { error: "Unauthorized" });
        const result = authController.me(user);
        return sendJson(res, result.status, result.body);
      }

      const userIdMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (req.method === "DELETE" && userIdMatch) {
        const user = authenticateRequest(req, tokenService);
        if (!user) return sendJson(res, 401, { error: "Unauthorized" });
        const result = accountController.deleteAccount(user, userIdMatch[1]);
        return sendJson(res, result.status, result.body);
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || "Bad request" });
    }
  });

  return { server, userRepository, tokenService, authService, accountDeletionService };
}

module.exports = { createApp };
