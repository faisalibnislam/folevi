// LEGACY — Loops transactional API. Used only during the Mailtrap cutover, when MAILTRAP_API_TOKEN is not
// set but LOOPS_API_KEY is. Remove after cutover (together with loopsWebhook.ts, the /webhooks/loops route
// and the LOOPS_* environment variables).
import { emailManifest } from "../manifest";
import { backoffDelay, clampAttempts, defaultSleep, REQUEST_TIMEOUT_MS } from "../retry";
import type { LoopsSendInput, LoopsSendOutcome, SendPolicy, TemplateKey } from "../types";
import { isPlausibleEmail, validateDataVariables } from "../validate";
import { isRecipientAllowed } from "../policy";

export const LOOPS_TRANSACTIONAL_ENDPOINT = "https://app.loops.so/api/v1/transactional";

const LOOPS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Idempotency-Key: ≤100 chars (Loops limit), visible ASCII only.
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7E]{1,100}$/;

/** LEGACY (remove after cutover): the env var holding each template's published Loops transactional id. */
export function loopsEnvVarFor(key: TemplateKey): string {
  return `LOOPS_TRANSACTIONAL_${key.toUpperCase()}_ID`;
}

export function transactionalIdFor(
  key: TemplateKey,
  env: Record<string, string | undefined>,
): string | null {
  if (!emailManifest[key]) return null;
  const value = env[loopsEnvVarFor(key)]?.trim();
  return value && LOOPS_ID_RE.test(value) ? value : null;
}

function classify(status: number): { errorCode: string; retryable: boolean } {
  if (status === 429) return { errorCode: "rate_limited", retryable: true };
  if (status === 408) return { errorCode: "timeout", retryable: true };
  if (status >= 500) return { errorCode: "loops_server_error", retryable: true };
  if (status === 409) return { errorCode: "idempotency_conflict", retryable: false };
  if (status === 404) return { errorCode: "template_not_found", retryable: false };
  if (status === 401 || status === 403) return { errorCode: "unauthorized", retryable: false };
  return { errorCode: "loops_rejected", retryable: false };
}

const PROVIDER_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Reads Loops' JSON response: the `success` flag and, when present, a provider message id
 * (`id`, `emailId` or `messageId`, top level or under `data`). The id is only kept when it looks
 * like an opaque identifier, so nothing else from the body is ever stored.
 */
async function readResponse(res: Response): Promise<{ success?: boolean; providerMessageId?: string }> {
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return {};
    const obj = body as Record<string, unknown>;
    const out: { success?: boolean; providerMessageId?: string } = {};
    if ("success" in obj) out.success = obj.success === true;
    const nested = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};
    for (const candidate of [obj.id, obj.emailId, obj.messageId, nested.id, nested.emailId, nested.messageId]) {
      if (typeof candidate === "string" && PROVIDER_ID_RE.test(candidate)) {
        out.providerMessageId = candidate;
        break;
      }
    }
    return out;
  } catch {
    // Non-JSON body: fall through.
    return {};
  }
}

/**
 * LEGACY (remove after cutover). Sends one Loops transactional email.
 *
 * Semantics: `accepted` means Loops returned 200 (accepted for delivery) — NOT delivered.
 * Never logs and never returns the payload or recipient.
 */
export async function sendTransactional(
  input: LoopsSendInput,
  opts: {
    apiKey: string;
    env: Record<string, string | undefined>;
    policy: SendPolicy;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
  },
): Promise<LoopsSendOutcome> {
  const fail = (errorCode: string, extra: Partial<LoopsSendOutcome> = {}): LoopsSendOutcome => ({
    status: "failed",
    errorCode,
    retryable: false,
    attempts: 0,
    ...extra,
  });

  const def = emailManifest[input.key];
  if (!def) return fail("unknown_template");

  const validation = validateDataVariables(input.key, input.dataVariables);
  if (!validation.ok) return fail("invalid_payload");

  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!isPlausibleEmail(to)) return fail("invalid_recipient");

  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) {
    return fail("invalid_idempotency_key");
  }

  const transactionalId = transactionalIdFor(input.key, opts.env);
  if (!transactionalId) return fail("template_not_configured");

  if (!isRecipientAllowed(to, opts.policy)) {
    return { status: "skipped", errorCode: "recipient_not_allowed", retryable: false, attempts: 0 };
  }

  if (!opts.apiKey) return fail("missing_api_key");

  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = clampAttempts(opts.maxAttempts);

  // addToAudience is always false: transactional sends must never create marketing contacts.
  const body = JSON.stringify({
    transactionalId,
    email: to,
    addToAudience: false,
    dataVariables: validation.dataVariables,
  });
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": input.idempotencyKey,
  };

  let last: LoopsSendOutcome = fail("network_error", { retryable: true });
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryAfter: string | null = null;
    const controller = typeof AbortController === "function" ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : undefined;
    try {
      const res = await fetchImpl(LOOPS_TRANSACTIONAL_ENDPOINT, {
        method: "POST",
        headers,
        body,
        signal: controller?.signal,
      });
      if (res.status === 200) {
        const { success, providerMessageId } = await readResponse(res);
        if (success === false) {
          return {
            status: "failed",
            httpStatus: 200,
            errorCode: "loops_rejected",
            retryable: false,
            attempts: attempt,
          };
        }
        return providerMessageId
          ? { status: "accepted", httpStatus: 200, retryable: false, attempts: attempt, providerMessageId }
          : { status: "accepted", httpStatus: 200, retryable: false, attempts: attempt };
      }
      const { errorCode, retryable } = classify(res.status);
      last = { status: "failed", httpStatus: res.status, errorCode, retryable, attempts: attempt };
      if (!retryable) return last;
      retryAfter = res.headers.get("retry-after");
    } catch {
      // Loops dedupes on the Idempotency-Key, so retrying an ambiguous network failure is safe here.
      last = { status: "failed", errorCode: "network_error", retryable: true, attempts: attempt };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (attempt < maxAttempts) await sleep(backoffDelay(attempt, retryAfter));
  }
  return last;
}
