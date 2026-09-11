"use strict";

function createAuthController({ authService }) {
  return {
    login(body) {
      const { email, password } = body || {};
      if (!email || !password) {
        return { status: 400, body: { error: "email and password are required" } };
      }

      const result = authService.login({ email, password });
      if (!result) {
        return { status: 401, body: { error: "Invalid credentials" } };
      }

      return { status: 200, body: result };
    },

    refresh(body) {
      const { refreshToken } = body || {};
      if (!refreshToken) {
        return { status: 400, body: { error: "refreshToken is required" } };
      }

      const result = authService.refresh({ refreshToken });
      if (!result) {
        return { status: 401, body: { error: "Invalid refresh token" } };
      }

      return { status: 200, body: result };
    },

    me(user) {
      return {
        status: 200,
        body: { id: user.id, email: user.email, displayName: user.displayName },
      };
    },
  };
}

module.exports = { createAuthController };
