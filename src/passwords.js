import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, derivedHex] = storedHash.split(':');
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(derivedHex, 'hex');
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(derived, stored);
}
