"use strict";

/**
 * Extracts and verifies the bearer access token from a request's Authorization
 * header. Returns the authenticated user, or null if the request is
 * unauthenticated or the token is invalid/expired/revoked.
 */
function authenticateRequest(req, tokenService) {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  return tokenService.verifyAccessToken(token);
}

module.exports = { authenticateRequest };
