// Shared retry policy for provider HTTP calls.

export const DEFAULT_MAX_ATTEMPTS = 4;
export const MAX_ATTEMPTS_CAP = 8;
export const REQUEST_TIMEOUT_MS = 15_000;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clampAttempts(requested: number | undefined): number {
  return Math.max(1, Math.min(MAX_ATTEMPTS_CAP, Math.floor(requested ?? DEFAULT_MAX_ATTEMPTS)));
}

/** Exponential backoff with jitter, honouring a numeric Retry-After (seconds), capped at 8 s. */
export function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_DELAY_MS);
  }
  const exp = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  // Full jitter on the upper half keeps concurrent senders from synchronising.
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
