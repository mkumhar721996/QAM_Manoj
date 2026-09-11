import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-access-token-secret';
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Minimal HMAC-signed token (JWT-shaped) so an access token's claims,
// including tokenVersion, can be checked on every request without a
// server-side lookup, while still allowing immediate revocation via
// the tokenVersion comparison against the current user record.
export function signAccessToken({ userId, role, tokenVersion }) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    role,
    tokenVersion,
    iat: Date.now(),
    exp: Date.now() + ACCESS_TOKEN_TTL_MS,
  };
  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', ACCESS_TOKEN_SECRET)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  return `${headerPart}.${payloadPart}.${signature}`;
}

export function verifyAccessToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;
  const expectedSignature = createHmac('sha256', ACCESS_TOKEN_SECRET)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

export function generateRefreshToken() {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
