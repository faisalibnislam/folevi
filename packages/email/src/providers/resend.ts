// Resend's sending API.
//
//   POST https://api.resend.com/emails   (Authorization: Bearer <api key>)
//
// Answers 200 {id} or an error body {statusCode, name, message} with 400/401/403/409/422/429/5xx. Resend
// honours an Idempotency-Key header for 24 hours, so Folevi sends its attempt id as the key: a retry of
// the same attempt (a timeout, a connection drop) can never send twice. The attempt row in Convex is still
// the guard against a second attempt for the same notification (convex/email.ts#beginAttempt).
import { backoffDelay, clampAttempts, defaultSleep, REQUEST_TIMEOUT_MS } from "../retry";
import type { SendOutcome } from "../types";

export const RESEND_API = "https://api.resend.com";
export const RESEND_SEND_ENDPOINT = `${RESEND_API}/emails`;

export interface ResendMessage {
  from: { email: string; name: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Our template key and attempt id: sent as tags, which come back in webhooks. Opaque ids only. */
  tags: { template: string; attempt: string };
  /** Extra headers (only threading headers: In-Reply-To, References), already validated. */
  headers?: Record<string, string>;
}

/** Resend tag values: ASCII letters, numbers, underscores and dashes, at most 256 characters. */
const TAG_VALUE_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** `Folevi <notify@mail.folevi.com>`, with the name stripped of anything that would break the header. */
export function formatFrom(from: { email: string; name: string }): string {
  const name = from.name.replace(/[\r\n"<>]/g, "").trim();
  return name ? `${name} <${from.email}>` : from.email;
}

/** The exact JSON body Resend receives. */
export function resendRequestBody(m: ResendMessage): Record<string, unknown> {
  const tags = Object.entries(m.tags)
    .filter(([, value]) => TAG_VALUE_RE.test(value))
    .map(([name, value]) => ({ name, value }));
  return {
    from: formatFrom(m.from),
    to: [m.to],
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    subject: m.subject,
    text: m.text,
    html: m.html,
    ...(tags.length ? { tags } : {}),
    ...(m.headers && Object.keys(m.headers).length ? { headers: { ...m.headers } } : {}),
  };
}

function classify(status: number): { errorCode: string; retryable: boolean } {
  if (status === 429) return { errorCode: "rate_limited", retryable: true };
  if (status === 408) return { errorCode: "timeout", retryable: true };
  if (status >= 500) return { errorCode: "provider_server_error", retryable: true };
  if (status === 401 || status === 403) return { errorCode: "unauthorized", retryable: false };
  if (status === 409) return { errorCode: "idempotency_conflict", retryable: false };
  return { errorCode: "provider_rejected", retryable: false };
}

const MESSAGE_ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

/**
 * The provider's reason for a refusal, safe to store and log: email addresses and long token-like strings
 * are masked, whitespace collapsed, and the result capped at 200 characters.
 */
export function sanitizeProviderError(raw: unknown): string | undefined {
  const parts = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const text = parts
    .filter((p): p is string => typeof p === "string")
    .join("; ")
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "<email>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<redacted>")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 200) : undefined;
}

async function readResponse(res: Response): Promise<{ messageId?: string; error?: string }> {
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return {};
    const obj = body as Record<string, unknown>;
    const out: { messageId?: string; error?: string } = {};
    const error = sanitizeProviderError(obj.message ?? obj.error);
    if (error) out.error = error;
    if (typeof obj.id === "string" && MESSAGE_ID_RE.test(obj.id)) out.messageId = obj.id;
    return out;
  } catch {
    return {};
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Posts one message to Resend with retries: 429 / 408 / 5xx, timeouts and connection failures are retried
 * with backoff (Retry-After honoured); other 4xx are not. Every try carries the same Idempotency-Key, so a
 * request Resend already accepted is answered with the original result instead of sending again.
 *
 * Never logs; never returns the key, the recipient or the body.
 */
export async function postToResend(
  message: ResendMessage,
  opts: {
    apiKey: string;
    idempotencyKey: string;
    endpoint?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    timeoutMs?: number;
  },
): Promise<SendOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = clampAttempts(opts.maxAttempts);
  const body = JSON.stringify(resendRequestBody(message));
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Idempotency-Key": opts.idempotencyKey,
  };

  let last: SendOutcome = { status: "failed", errorCode: "network_error", retryable: true, attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryAfter: string | null = null;
    const controller = typeof AbortController === "function" ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS) : undefined;
    try {
      const res = await fetchImpl(opts.endpoint ?? RESEND_SEND_ENDPOINT, { method: "POST", headers, body, signal: controller?.signal });
      if (res.status >= 200 && res.status < 300) {
        const { messageId } = await readResponse(res);
        return messageId
          ? { status: "accepted", httpStatus: res.status, retryable: false, attempts: attempt, providerMessageId: messageId }
          : { status: "accepted", httpStatus: res.status, retryable: false, attempts: attempt };
      }
      const { errorCode, retryable } = classify(res.status);
      const { error } = await readResponse(res);
      last = { status: "failed", httpStatus: res.status, errorCode, retryable, attempts: attempt, ...(error ? { providerError: error } : {}) };
      if (!retryable) return last;
      retryAfter = res.headers.get("retry-after");
    } catch (error) {
      // Safe to retry either way: the Idempotency-Key makes a second try of an accepted send a no-op.
      last = { status: "failed", errorCode: isAbort(error) ? "timeout" : "network_error", retryable: true, attempts: attempt };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (attempt < maxAttempts) await sleep(backoffDelay(attempt, retryAfter));
  }
  return last;
}
