import { WebhookError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

export interface VerifyWebhookOptions {
  /** How far the delivery's timestamp may be from now, in seconds. Default 300. */
  tolerance?: number | undefined;
  /** The current time, for tests: Unix seconds, a `Date`, or a function returning either. */
  now?: number | Date | (() => number | Date) | undefined;
}

function unixSeconds(now: VerifyWebhookOptions["now"]): number {
  const value = typeof now === "function" ? now() : now;
  if (value === undefined) return Math.floor(Date.now() / 1000);
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verifies a webhook delivery and returns its event.
 *
 * @param body The raw request body, exactly as received (not re-serialised).
 * @param signature The `Photos-Signature` header: `t=<unix seconds>,v1=<hex>`.
 * @param secret Your signing key (`webhookSecret()`, or the console).
 * @throws {WebhookError} when the header is malformed, the signature does not
 * match, the timestamp is outside the tolerance, or the body is not an event.
 */
export async function verifyWebhook(
  body: string | ArrayBuffer | ArrayBufferView,
  signature: string | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {},
): Promise<WebhookEvent> {
  if (!signature) throw new WebhookError("Missing Photos-Signature header");
  if (!secret) throw new WebhookError("Missing webhook secret");

  let timestamp: string | undefined;
  const candidates: Uint8Array[] = [];
  for (const part of signature.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") {
      const bytes = hexToBytes(value);
      if (bytes) candidates.push(bytes);
    }
  }
  if (timestamp === undefined || !/^\d+$/.test(timestamp) || candidates.length === 0) {
    throw new WebhookError("Malformed Photos-Signature header");
  }

  const encoder = new TextEncoder();
  const raw =
    typeof body === "string"
      ? encoder.encode(body)
      : body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  const prefix = encoder.encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let matches = false;
  for (const candidate of candidates) {
    // `verify` compares in constant time.
    if (await crypto.subtle.verify("HMAC", key, candidate as BufferSource, signed)) {
      matches = true;
    }
  }
  if (!matches) throw new WebhookError("Webhook signature does not match");

  const tolerance = options.tolerance ?? 300;
  if (Math.abs(unixSeconds(options.now) - Number(timestamp)) > tolerance) {
    throw new WebhookError("Webhook timestamp is outside the tolerance");
  }

  let event: unknown;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch (cause) {
    throw new WebhookError("Webhook body is not valid JSON", { cause });
  }
  if (
    typeof event !== "object" ||
    event === null ||
    typeof (event as { type?: unknown }).type !== "string"
  ) {
    throw new WebhookError("Webhook body is not an event");
  }
  return event as WebhookEvent;
}
