// Pieces both fake providers share: an OAuth server (PKCE codes, short-lived access tokens, refresh tokens,
// revocation), seeded fault injection (rate limits, server errors, dropped connections, offline), and a tiny
// request toolkit. The fakes are `fetch` functions: the providers' real URLs go in, Responses come out.

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FakeFaultRates {
  /** 429 with Retry-After. */
  rateLimit: number;
  /** 500 / 503. */
  serverError: number;
  /** The connection drops (fetch rejects) before an answer. */
  network: number;
  /** An upload chunk only partly arrives, then the connection drops. A download is cut short. */
  partial: number;
  /** A change takes a while to show up in listings and change feeds. */
  lag: number;
}

export const NO_FAKE_FAULTS: FakeFaultRates = { rateLimit: 0, serverError: 0, network: 0, partial: 0, lag: 0 };

export class FakeOAuth {
  readonly codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  readonly access = new Map<string, { refresh: string; expiresAt: number }>();
  readonly refresh = new Set<string>();
  /** Successful refreshes, for assertions. */
  refreshes = 0;
  private n = 0;
  constructor(
    readonly clientId: string,
    public now: () => number,
    public accessTtlMs = 4 * 3600_000,
    readonly prefix = "tok",
  ) {}

  /** What the browser does: checks the request and answers with the redirect (code and state). */
  authorize(url: string, expectHost: string): string {
    const u = new URL(url);
    if (u.host !== expectHost) throw new Error(`authorize host ${u.host}`);
    const p = u.searchParams;
    if (p.get("client_id") !== this.clientId) throw new Error("unknown client");
    if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) throw new Error("PKCE missing");
    const code = `code${++this.n}`;
    this.codes.set(code, { challenge: p.get("code_challenge")!, redirectUri: p.get("redirect_uri")!, clientId: this.clientId });
    const back = new URL(p.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", p.get("state") ?? "");
    return back.toString();
  }

  issue(): { access_token: string; refresh_token: string; expires_in: number } {
    const refresh = `${this.prefix}-r${++this.n}`;
    this.refresh.add(refresh);
    const access = this.newAccess(refresh);
    return { access_token: access, refresh_token: refresh, expires_in: Math.round(this.accessTtlMs / 1000) };
  }

  private newAccess(refresh: string): string {
    const access = `${this.prefix}-a${++this.n}`;
    this.access.set(access, { refresh, expiresAt: this.now() + this.accessTtlMs });
    return access;
  }

  async token(form: URLSearchParams): Promise<Response> {
    if (form.get("client_id") !== this.clientId) return json(400, { error: "invalid_client" });
    if (form.get("grant_type") === "authorization_code") {
      const c = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (!c || c.redirectUri !== form.get("redirect_uri")) return json(400, { error: "invalid_grant", error_description: "code" });
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? "")));
      const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (challenge !== c.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verifier" });
      return json(200, { ...this.issue(), token_type: "bearer" });
    }
    if (form.get("grant_type") === "refresh_token") {
      const r = form.get("refresh_token") ?? "";
      if (!this.refresh.has(r)) return json(400, { error: "invalid_grant", error_description: "refresh token revoked" });
      this.refreshes++;
      return json(200, { access_token: this.newAccess(r), expires_in: Math.round(this.accessTtlMs / 1000), token_type: "bearer" });
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  /** "valid" | "expired" | "invalid". */
  check(header: string | null): "valid" | "expired" | "invalid" {
    const token = /^Bearer (.+)$/.exec(header ?? "")?.[1];
    const t = token ? this.access.get(token) : undefined;
    if (!t || !this.refresh.has(t.refresh)) return "invalid";
    return t.expiresAt <= this.now() ? "expired" : "valid";
  }

  /** The person removes Folevi from their connected apps. */
  revokeAll(): void {
    this.refresh.clear();
    this.access.clear();
  }

  revokeToken(token: string): void {
    const a = this.access.get(token);
    if (a) this.refresh.delete(a.refresh);
    this.refresh.delete(token);
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export async function bodyBytes(init: RequestInit | undefined): Promise<Uint8Array> {
  const b = init?.body;
  if (b === undefined || b === null) return new Uint8Array(0);
  if (typeof b === "string") return new TextEncoder().encode(b);
  if (b instanceof Uint8Array) return b.slice();
  if (b instanceof ArrayBuffer) return new Uint8Array(b.slice(0));
  return new Uint8Array(await new Response(b as BodyInit).arrayBuffer());
}

export async function bodyText(init: RequestInit | undefined): Promise<string> {
  return new TextDecoder().decode(await bodyBytes(init));
}

/**
 * Faults for one request. A request is never failed twice in a row by the same kind of fault (so the client's
 * retry budget always wins in property runs); `offline` fails everything.
 */
export class FaultInjector {
  rates: FakeFaultRates = NO_FAKE_FAULTS;
  offline = false;
  private lastFailed = false;
  /** The request being served follows a failed one: no faults for it. */
  private protect = false;
  readonly stats = { rateLimited: 0, serverErrors: 0, dropped: 0, partial: 0, requests: 0 };
  constructor(readonly random: () => number) {}

  chance(p: number): boolean {
    return p > 0 && this.random() < p;
  }

  /** A failure to answer with, or null to serve the request. Throws for a dropped connection. */
  before(): Response | null {
    this.stats.requests++;
    if (this.offline) throw new TypeError("fetch failed (offline)");
    this.protect = this.lastFailed;
    this.lastFailed = false;
    if (this.protect) return null;
    if (this.chance(this.rates.network)) {
      this.lastFailed = true;
      this.stats.dropped++;
      throw new TypeError("fetch failed (connection reset)");
    }
    if (this.chance(this.rates.rateLimit)) {
      this.lastFailed = true;
      this.stats.rateLimited++;
      return json(429, { error_summary: "too_many_requests/", error: { reason: { ".tag": "too_many_requests" }, retry_after: 1 } }, { "retry-after": "1" });
    }
    if (this.chance(this.rates.serverError)) {
      this.lastFailed = true;
      this.stats.serverErrors++;
      return this.random() < 0.5 ? new Response("oops", { status: 500 }) : new Response("unavailable", { status: 503 });
    }
    return null;
  }

  /** For partial uploads: true means "keep only part of it, then drop the connection". */
  partial(): boolean {
    if (this.protect) return false;
    if (this.chance(this.rates.partial)) {
      this.lastFailed = true;
      this.stats.partial++;
      return true;
    }
    return false;
  }
}

/** Lets other requests run in between (random interleaving for concurrency tests). */
export async function yieldRandomly(random: () => number, maxYields: number): Promise<void> {
  const n = Math.floor(random() * (maxYields + 1));
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
}
