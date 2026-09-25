import { emailManifest } from "./manifest";
import type { LoopsSendInput, LoopsSendOutcome, SendPolicy, TemplateKey } from "./types";
import { isPlausibleEmail, validateDataVariables } from "./validate";

export const LOOPS_TRANSACTIONAL_ENDPOINT = "https://app.loops.so/api/v1/transactional";

const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_ATTEMPTS_CAP = 8;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TEST_DOMAINS = new Set(["example.com", "test.com"]);
const LOOPS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Idempotency-Key: ≤100 chars (Loops limit), visible ASCII only.
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7E]{1,100}$/;

export function transactionalIdFor(
  key: TemplateKey,
  env: Record<string, string | undefined>,
): string | null {
  const def = emailManifest[key];
  if (!def) return null;
  const value = env[def.envVar]?.trim();
  return value && LOOPS_ID_RE.test(value) ? value : null;
}

/** Non-production: only @example.com, @test.com, or exact allowlisted addresses. */
export function isRecipientAllowed(email: string, policy: SendPolicy): boolean {
  if (policy.environment === "production") return true;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (TEST_DOMAINS.has(domain)) return true;
  return (policy.allowlist ?? []).some((a) => a.trim().toLowerCase() === normalized);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_DELAY_MS);
  }
  const exp = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  // Full jitter on the upper half keeps concurrent senders from synchronising.
  return Math.round(exp / 2 + Math.random() * (exp / 2));
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

async function readSuccessFlag(res: Response): Promise<boolean | undefined> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "success" in body) {
      return (body as { success: unknown }).success === true;
    }
  } catch {
    // Non-JSON body: fall through.
  }
  return undefined;
}

/**
 * Sends one Loops transactional email.
 *
 * Semantics: `accepted` means Loops returned 200 (accepted for delivery) — NOT delivered.
 * Delivery/bounce/complaint state only comes from verified Loops webhooks.
 *
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
  const maxAttempts = Math.max(
    1,
    Math.min(MAX_ATTEMPTS_CAP, Math.floor(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
  );

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
        const success = await readSuccessFlag(res);
        if (success === false) {
          return {
            status: "failed",
            httpStatus: 200,
            errorCode: "loops_rejected",
            retryable: false,
            attempts: attempt,
          };
        }
        return { status: "accepted", httpStatus: 200, retryable: false, attempts: attempt };
      }
      const { errorCode, retryable } = classify(res.status);
      last = { status: "failed", httpStatus: res.status, errorCode, retryable, attempts: attempt };
      if (!retryable) return last;
      retryAfter = res.headers.get("retry-after");
    } catch {
      last = { status: "failed", errorCode: "network_error", retryable: true, attempts: attempt };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (attempt < maxAttempts) await sleep(backoffDelay(attempt, retryAfter));
  }
  return last;
}
