const PBKDF2_ITERATIONS = 100_000;
const DERIVED_KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    DERIVED_KEY_LENGTH_BITS,
  );
  return new Uint8Array(derived);
}

/** Uses the Web Crypto API (available in both browsers and Node) so this module stays browser-portable. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveBits(password, salt);
  return `${toHex(salt)}:${toHex(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, expectedHex] = storedHash.split(":");
  if (!saltHex || !expectedHex) {
    return false;
  }
  const actual = await deriveBits(password, fromHex(saltHex));
  const expected = fromHex(expectedHex);
  if (actual.length !== expected.length) {
    return false;
  }
  // Constant-time comparison: node:crypto's timingSafeEqual is not available in browsers.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}
