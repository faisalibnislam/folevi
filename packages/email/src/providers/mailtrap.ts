// Mailtrap Email API (transactional stream) and Email Sandbox.
//
//   live:    POST https://send.api.mailtrap.io/api/send
//   sandbox: POST https://sandbox.api.mailtrap.io/api/send/{inbox_id}   (captured; never delivered)
//
// Both take the same JSON body and answer 200 {success: true, message_ids: [...]} or
// {success: false, errors: [...]} with 400/401/403/429/5xx. Mailtrap has no idempotency key: Folevi's
// send-attempt row is the guard against sending twice (convex/email.ts#beginAttempt).
import { backoffDelay, clampAttempts, defaultSleep, REQUEST_TIMEOUT_MS } from "../retry";
import type { SendOutcome } from "../types";

export const MAILTRAP_SEND_ENDPOINT = "https://send.api.mailtrap.io/api/send";
export const MAILTRAP_SANDBOX_ENDPOINT = "https://sandbox.api.mailtrap.io/api/send";

export interface MailtrapMessage {
  from: { email: string; name: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Our template key. */
  category: string;
  /** Opaque ids only, never personal data (they come back in webhooks). */
  customVariables: Record<string, string>;
}

/** The exact JSON body Mailtrap receives. */
export function mailtrapRequestBody(m: MailtrapMessage): Record<string, unknown> {
  return {
    from: { email: m.from.email, name: m.from.name },
    to: [{ email: m.to }],
    ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}),
    subject: m.subject,
    text: m.text,
    html: m.html,
    category: m.category,
    custom_variables: { ...m.customVariables },
  };
}

function classify(status: number): { errorCode: string; retryable: boolean } {
  if (status === 429) return { errorCode: "rate_limited", retryable: true };
  if (status === 408) return { errorCode: "timeout", retryable: true };
  if (status >= 500) return { errorCode: "provider_server_error", retryable: true };
  if (status === 401 || status === 403) return { errorCode: "unauthorized", retryable: false };
  return { errorCode: "provider_rejected", retryable: false };
}

const MESSAGE_ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

/**
 * Mailtrap's reason for a refusal, safe to store and log: email addresses and long token-like strings
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

async function readResponse(res: Response): Promise<{ success?: boolean; messageId?: string; error?: string }> {
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return {};
    const obj = body as Record<string, unknown>;
    const out: { success?: boolean; messageId?: string; error?: string } = {};
    const error = sanitizeProviderError(obj.errors ?? obj.error);
    if (error) out.error = error;
    if ("success" in obj) out.success = obj.success === true;
    const ids = obj.message_ids;
    if (Array.isArray(ids) && typeof ids[0] === "string" && MESSAGE_ID_RE.test(ids[0])) out.messageId = ids[0];
    return out;
  } catch {
    return {};
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Posts one message to Mailtrap with retries: 429 / 408 / 5xx and connection failures are retried with
 * backoff (Retry-After honoured); other 4xx are not. A request that times out on our side is NOT retried:
 * Mailtrap may already have accepted it and has no idempotency key, so a retry could send twice.
 *
 * Never logs; never returns the token, the recipient or the body.
 */
export async function postToMailtrap(
  message: MailtrapMessage,
  opts: {
    token: string;
    endpoint: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    timeoutMs?: number;
  },
): Promise<SendOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = clampAttempts(opts.maxAttempts);
  const body = JSON.stringify(mailtrapRequestBody(message));
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let last: SendOutcome = { status: "failed", errorCode: "network_error", retryable: true, attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryAfter: string | null = null;
    const controller = typeof AbortController === "function" ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS) : undefined;
    try {
      const res = await fetchImpl(opts.endpoint, { method: "POST", headers, body, signal: controller?.signal });
      if (res.status >= 200 && res.status < 300) {
        const { success, messageId, error } = await readResponse(res);
        if (success === false) {
          return { status: "failed", httpStatus: res.status, errorCode: "provider_rejected", retryable: false, attempts: attempt, ...(error ? { providerError: error } : {}) };
        }
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
      if (isAbort(error)) {
        // Ambiguous: the request may have been accepted. Don't risk a duplicate.
        return { status: "failed", errorCode: "timeout", retryable: false, attempts: attempt };
      }
      last = { status: "failed", errorCode: "network_error", retryable: true, attempts: attempt };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (attempt < maxAttempts) await sleep(backoffDelay(attempt, retryAfter));
  }
  return last;
}
