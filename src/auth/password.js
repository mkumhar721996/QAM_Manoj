const crypto = require('node:crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, hash) {
  const [salt, storedKey] = hash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  const storedBuffer = Buffer.from(storedKey, 'hex');
  if (storedBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(storedBuffer, derivedKey);
}

module.exports = { hashPassword, verifyPassword };
