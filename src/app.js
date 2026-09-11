const http = require('http');
const { createUser } = require('./services/userService');
const { ROLES } = require('./db/roles');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req, authService) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return authService.verifyToken(token);
}

function createApp({ store, authService }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/auth/login') {
        const { email, password } = await readJsonBody(req);
        const token = authService.login(email, password);
        if (!token) return sendJson(res, 401, { error: 'Invalid credentials' });
        return sendJson(res, 200, { token });
      }

      if (req.method === 'POST' && req.url === '/admin/admins') {
        const session = authenticate(req, authService);
        if (!session) return sendJson(res, 401, { error: 'Authentication required' });
        if (session.role !== ROLES.SUPER_ADMIN) {
          return sendJson(res, 403, { error: 'Only a super-admin can create admin accounts' });
        }
        const { email, password } = await readJsonBody(req);
        if (!email || !password) {
          return sendJson(res, 400, { error: 'email and password are required' });
        }
        const user = createUser(store, { email, password, role: ROLES.ADMIN });
        return sendJson(res, 201, { id: user.id, email: user.email, role: user.role });
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

module.exports = { createApp };
