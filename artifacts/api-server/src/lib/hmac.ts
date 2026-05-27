import crypto from "crypto";

/** Max allowed clock skew between client and server */
const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/** Generate a random 32-byte hex secret for a new app */
export function generateSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Compute HMAC-SHA256 signature.
 * message = `${timestamp}:${METHOD}:${path}`
 */
export function computeHmac(secretKey: string, timestamp: string, method: string, path: string): string {
  const message = `${timestamp}:${method.toUpperCase()}:${path}`;
  return crypto.createHmac("sha256", secretKey).update(message, "utf8").digest("hex");
}

/** Return true if the timestamp is within the allowed clock skew window */
export function isTimestampFresh(timestamp: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Math.abs(Date.now() - ts) <= MAX_SKEW_MS;
}

/**
 * Verify X-Timestamp + X-Signature headers against the stored secret.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyHmac(
  secretKey: string,
  timestamp: string,
  method: string,
  path: string,
  signature: string,
): boolean {
  if (!secretKey || !timestamp || !signature) return false;
  if (!isTimestampFresh(timestamp)) return false;
  const expected = computeHmac(secretKey, timestamp, method, path);
  const sigLower = signature.toLowerCase();
  if (expected.length !== sigLower.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sigLower, "hex"));
  } catch {
    return false;
  }
}
