import crypto from "node:crypto";
import type { Role } from "../users/fixtures/testUsers.ts";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable must be set");
}

export interface AccessTokenPayload {
  userId: string;
  role: Role;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
}

export function issueAccessToken(payload: { userId: string; role: Role }, now: number = Date.now()): string {
  const header = { alg: "HS256", typ: "JWT" };
  const iat = Math.floor(now / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
  const fullPayload: AccessTokenPayload = { ...payload, iat, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function decodeAccessToken(token: string): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  return JSON.parse(base64UrlDecode(encodedPayload)) as AccessTokenPayload;
}

export function verifyAccessToken(token: string, now: number = Date.now()): AccessTokenPayload | null {
  const payload = decodeAccessToken(token);
  if (!payload) {
    return null;
  }
  if (payload.exp * 1000 <= now) {
    return null;
  }
  return payload;
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function getBearerPayload(
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): AccessTokenPayload | null {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  return token ? verifyAccessToken(token, now) : null;
}
