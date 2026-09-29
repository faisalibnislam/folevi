// LEGACY — Loops webhook verification. Remove after the Mailtrap cutover (with the /webhooks/loops route).
import type { LoopsWebhookEvent } from "../types";

const TOLERANCE_SECONDS = 5 * 60;
const MAX_ID_LENGTH = 256;

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(value);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a Loops webhook (Standard Webhooks style):
 *   signature = base64(HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${timestamp}.${rawBody}`))
 * The `Webhook-Signature` header may carry several space-separated `v1,<sig>` entries.
 * Rejects timestamps more than 5 minutes from `now` (ms since epoch; defaults to Date.now()).
 * Callers must additionally dedupe on `Webhook-Id`.
 */
export async function verifyLoopsWebhook(input: {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  secret: string;
  now?: number;
}): Promise<boolean> {
  const { id, timestamp, signature, rawBody, secret } = input;
  if (!id || !timestamp || !signature || typeof rawBody !== "string" || !secret) return false;
  if (id.length > MAX_ID_LENGTH || /\s/.test(id)) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;

  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const keyBytes = base64ToBytes(
    secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret,
  );
  if (!keyBytes || keyBytes.length === 0) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = bytesToBase64(new Uint8Array(mac));

  let matched = false;
  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0) continue;
    const version = entry.slice(0, comma);
    const sig = entry.slice(comma + 1);
    if (version !== "v1") continue;
    // Evaluate every entry (no early exit) to keep timing independent of position.
    if (constantTimeEqual(sig, expected)) matched = true;
  }
  return matched;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Extracts only the fields Folevi stores. Returns null for anything malformed. */
export function parseLoopsWebhook(rawBody: string): LoopsWebhookEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  const eventName = str(obj.eventName);
  const eventTime = obj.eventTime;
  if (!eventName || typeof eventTime !== "number" || !Number.isFinite(eventTime)) return null;

  const event: LoopsWebhookEvent = { eventName, eventTime };
  const transactionalId = str(obj.transactionalId);
  if (transactionalId) event.transactionalId = transactionalId;
  const email = obj.email;
  if (email && typeof email === "object") {
    const emailId = str((email as Record<string, unknown>).id);
    if (emailId) event.emailId = emailId;
  }
  const contact = obj.contactIdentity;
  if (contact && typeof contact === "object") {
    const recipient = str((contact as Record<string, unknown>).email);
    if (recipient) event.recipient = recipient;
  }
  return event;
}
