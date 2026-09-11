import { createServer as createHttpServer } from 'node:http';
import { verifyAccessToken } from './tokens.js';
import { USER_STATUS } from './store.js';
import { login, SuspendedAccountError, InvalidCredentialsError } from './authService.js';
import { suspendUser, reinstateUser, UserNotFoundError } from './adminUserService.js';

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function authenticate(store, req) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return { error: { status: 401, message: 'Missing or invalid Authorization header.' } };
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return { error: { status: 401, message: 'Invalid or expired token.' } };
  }

  const user = store.users.findById(payload.sub);
  if (!user) {
    return { error: { status: 401, message: 'Invalid token.' } };
  }

  // Reject tokens issued before the most recent suspend/revocation,
  // even if the JWT itself has not naturally expired (AC2).
  if (payload.tokenVersion !== user.tokenVersion) {
    return { error: { status: 401, message: 'Token has been revoked.' } };
  }

  if (user.status === USER_STATUS.SUSPENDED) {
    return { error: { status: 403, message: 'Account suspended. Contact support.' } };
  }

  return { user };
}

// Factory so each test can create an isolated server bound to its own
// in-memory store.
export function createApp(store) {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === 'POST' && path === '/auth/login') {
        const body = await readJsonBody(req);
        try {
          const tokens = login(store, body);
          return sendJson(res, 200, tokens);
        } catch (err) {
          if (err instanceof SuspendedAccountError) {
            return sendJson(res, 403, { message: err.message });
          }
          if (err instanceof InvalidCredentialsError) {
            return sendJson(res, 401, { message: err.message });
          }
          throw err;
        }
      }

      if (method === 'GET' && path === '/protected/ping') {
        const { user, error } = authenticate(store, req);
        if (error) return sendJson(res, error.status, { message: error.message });
        return sendJson(res, 200, { message: 'pong', userId: user.id });
      }

      const suspendMatch = path.match(/^\/admin\/users\/([^/]+)\/suspend$/);
      if (method === 'POST' && suspendMatch) {
        const { user: admin, error } = authenticate(store, req);
        if (error) return sendJson(res, error.status, { message: error.message });
        if (admin.role !== 'ADMIN') {
          return sendJson(res, 403, { message: 'Admin role required.' });
        }
        try {
          const target = suspendUser(store, suspendMatch[1]);
          return sendJson(res, 200, { id: target.id, status: target.status });
        } catch (err) {
          if (err instanceof UserNotFoundError) {
            return sendJson(res, 404, { message: err.message });
          }
          throw err;
        }
      }

      const reinstateMatch = path.match(/^\/admin\/users\/([^/]+)\/reinstate$/);
      if (method === 'POST' && reinstateMatch) {
        const { user: admin, error } = authenticate(store, req);
        if (error) return sendJson(res, error.status, { message: error.message });
        if (admin.role !== 'ADMIN') {
          return sendJson(res, 403, { message: 'Admin role required.' });
        }
        try {
          const target = reinstateUser(store, reinstateMatch[1]);
          return sendJson(res, 200, { id: target.id, status: target.status });
        } catch (err) {
          if (err instanceof UserNotFoundError) {
            return sendJson(res, 404, { message: err.message });
          }
          throw err;
        }
      }

      return sendJson(res, 404, { message: 'Not found.' });
    } catch (err) {
      return sendJson(res, 500, { message: 'Internal server error.' });
    }
  });
}
