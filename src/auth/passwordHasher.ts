import crypto from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedDerivedKey] = storedHash.split(":");
  if (!salt || !expectedDerivedKey) {
    return false;
  }
  const actualDerivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expectedDerivedKey, "hex");
  if (actualDerivedKey.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualDerivedKey, expectedBuffer);
}
