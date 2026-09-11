const crypto = require('node:crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-only-session-secret';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function createSessionToken(user) {
  return sign({ sub: user.id, role: user.role });
}

function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = crypto
    .createHmac('sha256', SECRET)
    .update(encodedPayload)
    .digest('base64url');
  const provided = Buffer.from(signature || '');
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { createSessionToken, verifySessionToken };
