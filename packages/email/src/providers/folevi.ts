// Folevi Mail: a Folevi Server sends through Folevi Connect's mail relay (docs/self-hosting/CONTRACT.md §9).
//
//   POST <FOLEVI_CONNECT_URL>/v1/mail   (Authorization: Bearer <the server's Connect token>)
//   {to, subject, html, text, replyTo?, tag}  ->  202 {id}
//
// Connect sets the From address itself (`<server name> <no-reply@folevi.app>`). The relay only ever sees the
// rendered message, which is what any mail provider sees. Retries follow the same policy as Resend's sender
// (429, 408, 5xx, timeouts and dropped connections), with the attempt id as the Idempotency-Key.
import { backoffDelay, clampAttempts, defaultSleep, REQUEST_TIMEOUT_MS } from "../retry";
import type { SendOutcome } from "../types";
import { sanitizeProviderError } from "./resend";

export interface FoleviMailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** What kind of mail it is (the template key), for the relay's per-server limits and logs. Opaque. */
  tag: string;
}

/** The exact JSON body the relay receives. */
export function foleviMailBody(m: FoleviMailMessage): Record<string, unknown> {
  return { to: m.to, subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}), tag: m.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "mail" };
}

function classify(status: number): { errorCode: string; retryable: boolean } {
  if (status === 429) return { errorCode: "rate_limited", retryable: true };
  if (status === 408) return { errorCode: "timeout", retryable: true };
  if (status >= 500) return { errorCode: "provider_server_error", retryable: true };
  if (status === 401 || status === 403) return { errorCode: "unauthorized", retryable: false };
  return { errorCode: "provider_rejected", retryable: false };
}

const ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

/** Posts one message to the relay with retries. Never logs; never returns the token, the recipient or the body. */
export async function postToFoleviMail(
  message: FoleviMailMessage,
  opts: { baseUrl: string; token: string; idempotencyKey: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; timeoutMs?: number },
): Promise<SendOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = clampAttempts(opts.maxAttempts);
  const endpoint = `${opts.baseUrl.replace(/\/+$/, "")}/v1/mail`;
  const body = JSON.stringify(foleviMailBody(message));
  const headers = { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": opts.idempotencyKey };
  let last: SendOutcome = { status: "failed", errorCode: "network_error", retryable: true, attempts: 0, provider: "folevi" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryAfter: string | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(endpoint, { method: "POST", headers, body, signal: controller.signal });
      let parsed: Record<string, unknown> = {};
      try {
        const json: unknown = await res.json();
        if (json && typeof json === "object") parsed = json as Record<string, unknown>;
      } catch {
        /* no body */
      }
      if (res.status >= 200 && res.status < 300) {
        const id = typeof parsed.id === "string" && ID_RE.test(parsed.id) ? parsed.id : undefined;
        return { status: "accepted", httpStatus: res.status, retryable: false, attempts: attempt, provider: "folevi", ...(id ? { providerMessageId: id } : {}) };
      }
      const { errorCode, retryable } = classify(res.status);
      const error = sanitizeProviderError(parsed.message ?? parsed.error);
      last = { status: "failed", httpStatus: res.status, errorCode, retryable, attempts: attempt, provider: "folevi", ...(error ? { providerError: error } : {}) };
      if (!retryable) return last;
      retryAfter = res.headers.get("retry-after");
    } catch (error) {
      const aborted = typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
      last = { status: "failed", errorCode: aborted ? "timeout" : "network_error", retryable: true, attempts: attempt, provider: "folevi" };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts) await sleep(backoffDelay(attempt, retryAfter));
  }
  return last;
}
