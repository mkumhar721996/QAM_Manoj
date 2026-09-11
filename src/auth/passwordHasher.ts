import crypto from "node:crypto";
import { promisify } from "node:util";

const KEY_LENGTH = 64;
const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)).toString("hex");
  return `${salt}:${derivedKey}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedDerivedKey] = storedHash.split(":");
  if (!salt || !expectedDerivedKey) {
    return false;
  }
  const actualDerivedKey = await scrypt(password, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expectedDerivedKey, "hex");
  if (actualDerivedKey.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualDerivedKey, expectedBuffer);
}

// Used to run a real password verification even when the username doesn't exist,
// so login timing doesn't leak whether an account exists (see AC7/AC8).
export const DUMMY_PASSWORD_HASH = await hashPassword(crypto.randomBytes(32).toString("hex"));
