// Requests to Dropbox and Google with the retry rules both providers ask for: on 429 (and 503) wait for
// Retry-After when given, otherwise exponential backoff with jitter; other 5xx answers back off the same way;
// a request that can't reach the network is retried a few times, then reported as "offline". Platform neutral.
import { CloudError, realSleep, type HttpFetch, type Sleep } from "./types";

export interface RetryOptions {
  /** Attempts for 429 and 5xx answers before giving up with "busy". */
  maxAttempts?: number;
  /** Attempts when the network can't be reached before giving up with "offline". */
  networkAttempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: Sleep;
  random?: () => number;
  /** Told whether the provider could be reached (for the "offline" state). */
  onReachable?: (reachable: boolean) => void;
}

export type RetryVerdict = { retry: false } | { retry: true; afterMs?: number };

/** Provider specific: Drive's 403 rateLimitExceeded is a rate limit, for instance. */
export type RetryClassifier = (res: Response) => Promise<RetryVerdict>;

const DEFAULTS = { maxAttempts: 6, networkAttempts: 3, baseMs: 500, maxMs: 32_000 };

/** Retry-After in seconds or as an HTTP date; undefined when absent or unusable. Capped at 10 minutes. */
export function retryAfterMs(res: Response, now = Date.now()): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(600_000, seconds * 1000);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(600_000, Math.max(0, at - now));
  return undefined;
}

export const defaultClassifier: RetryClassifier = async (res) => {
  if (res.status === 429 || res.status === 503) return { retry: true, afterMs: retryAfterMs(res) };
  if (res.status >= 500) return { retry: true };
  return { retry: false };
};

export class RetryingHttp {
  private readonly o: Required<Omit<RetryOptions, "onReachable">> & Pick<RetryOptions, "onReachable">;

  constructor(
    private readonly fetchImpl: HttpFetch,
    options: RetryOptions = {},
    private readonly classify: RetryClassifier = defaultClassifier,
  ) {
    this.o = {
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      networkAttempts: options.networkAttempts ?? DEFAULTS.networkAttempts,
      baseMs: options.baseMs ?? DEFAULTS.baseMs,
      maxMs: options.maxMs ?? DEFAULTS.maxMs,
      sleep: options.sleep ?? realSleep,
      random: options.random ?? Math.random,
      onReachable: options.onReachable,
    };
  }

  backoffMs(attempt: number): number {
    const base = Math.min(this.o.maxMs, this.o.baseMs * 2 ** Math.max(0, attempt - 1));
    return Math.round(base * (0.5 + this.o.random() / 2));
  }

  /** Sends until an answer that isn't a rate limit or server error; the body must be re-sendable. */
  async send(url: string, init: RequestInit = {}): Promise<Response> {
    let networkFailures = 0;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") throw error;
        networkFailures++;
        if (networkFailures >= this.o.networkAttempts) {
          this.o.onReachable?.(false);
          throw new CloudError("offline", `Can't reach ${hostOf(url)}: ${(error as Error)?.message ?? error}`);
        }
        await this.o.sleep(this.backoffMs(networkFailures));
        continue;
      }
      this.o.onReachable?.(true);
      const verdict = await this.classify(res);
      if (!verdict.retry) return res;
      if (attempt >= this.o.maxAttempts) {
        await res.body?.cancel().catch(() => undefined);
        throw new CloudError("busy", `${hostOf(url)} is busy (HTTP ${res.status}); try again later.`, res.status);
      }
      await res.body?.cancel().catch(() => undefined);
      await this.o.sleep(verdict.afterMs ?? this.backoffMs(attempt));
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the provider";
  }
}

/** Reads a JSON answer, or null for an empty or non-JSON body. */
export async function jsonOf<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Copies bytes into a fresh ArrayBuffer-backed array (a request body `fetch` accepts everywhere). */
export function bodyOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

export async function bytesOf(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}
