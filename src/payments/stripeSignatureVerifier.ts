import crypto from "node:crypto";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function parseSignatureHeader(signatureHeader: string): { timestamp?: string; signature?: string } {
  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(",")) {
    const [key, value] = segment.split("=");
    if (key && value) {
      parts[key] = value;
    }
  }
  return { timestamp: parts.t, signature: parts.v1 };
}

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const { timestamp, signature } = parseSignatureHeader(signatureHeader);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return false;
  }

  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const providedBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
