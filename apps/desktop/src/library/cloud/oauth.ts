// Signing in to Dropbox and Google from the device: OAuth 2 authorization code with PKCE (S256) and no client
// secret, refresh tokens, and the "Reconnect" state when a refresh is refused (the person revoked Folevi's
// access, or the grant expired). No Folevi server takes part. Platform neutral: WebCrypto and fetch only.
//
// Redirects (see docs/LOCAL_MODE.md, "Dropbox and Google Drive"): Google desktop clients use a loopback
// listener on any free port (http://127.0.0.1:<port>/, Google matches loopback redirects without the port).
// Dropbox matches redirect URIs exactly, port included, so the Mac listens on one of a few fixed loopback
// ports that are all registered in the Dropbox App Console.
import { jsonOf, RetryingHttp } from "./http";
import { CloudError, type CloudProvider } from "./types";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope?: string;
}

/** Where tokens are kept (safeStorage on the Mac, the Keychain on iOS). Never the page. */
export interface TokenStore {
  load(provider: CloudProvider): Promise<TokenSet | null>;
  save(provider: CloudProvider, tokens: TokenSet): Promise<void>;
  clear(provider: CloudProvider): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  readonly tokens = new Map<CloudProvider, TokenSet>();
  async load(p: CloudProvider) {
    return this.tokens.get(p) ?? null;
  }
  async save(p: CloudProvider, t: TokenSet) {
    this.tokens.set(p, { ...t });
  }
  async clear(p: CloudProvider) {
    this.tokens.delete(p);
  }
}

// ---------------------------------------------------------------- PKCE

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64Url(b);
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** A 43-character verifier (RFC 7636's minimum; both providers accept 43 to 128) and its S256 challenge. */
export async function createPkce(verifier = randomToken(32)): Promise<Pkce> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64Url(digest) };
}

// ---------------------------------------------------------------- the two providers

export interface OAuthClient {
  readonly provider: CloudProvider;
  readonly clientId: string;
  authorizeUrl(o: { redirectUri: string; state: string; challenge: string }): string;
  exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<TokenSet>;
  /** A new access token (and, with Google sometimes, a new refresh token). */
  refresh(refreshToken: string): Promise<TokenSet>;
  /** Best effort: tells the provider to forget this grant. */
  revoke(tokens: TokenSet): Promise<void>;
}

type TokenAnswer = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

/** Refusals that mean the grant itself is gone: connect again. */
const REVOKED = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "access_denied"]);

async function tokenRequest(http: RetryingHttp, url: string, form: Record<string, string>, now: () => number, previousRefresh?: string): Promise<TokenSet> {
  const res = await http.send(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await jsonOf<TokenAnswer>(res)) ?? {};
  if (!res.ok || !body.access_token) {
    if ((res.status === 400 || res.status === 401) && (REVOKED.has(body.error ?? "") || res.status === 401))
      throw new CloudError("reconnect", `The sign-in was refused (${body.error ?? res.status}): ${body.error_description ?? "connect again"}.`, res.status);
    throw new CloudError("protocol", `Unexpected token answer (HTTP ${res.status}${body.error ? `, ${body.error}` : ""}).`, res.status);
  }
  const refreshToken = body.refresh_token ?? previousRefresh;
  if (!refreshToken) throw new CloudError("protocol", "The provider didn't return a refresh token.");
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    ...(body.scope ? { scope: body.scope } : {}),
  };
}

export const DROPBOX_AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_REVOKE = "https://api.dropboxapi.com/2/auth/token/revoke";

export class DropboxOAuth implements OAuthClient {
  readonly provider = "dropbox" as const;
  constructor(
    readonly clientId: string,
    private readonly http: RetryingHttp,
    private readonly now: () => number = Date.now,
  ) {}

  authorizeUrl(o: { redirectUri: string; state: string; challenge: string }): string {
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: o.redirectUri,
      code_challenge: o.challenge,
      code_challenge_method: "S256",
      // A refresh token: short-lived access tokens are renewed without asking again.
      token_access_type: "offline",
      state: o.state,
    });
    return `${DROPBOX_AUTHORIZE}?${q}`;
  }

  exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<TokenSet> {
    return tokenRequest(this.http, DROPBOX_TOKEN, { grant_type: "authorization_code", code: o.code, code_verifier: o.verifier, client_id: this.clientId, redirect_uri: o.redirectUri }, this.now);
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return tokenRequest(this.http, DROPBOX_TOKEN, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.clientId }, this.now, refreshToken);
  }

  async revoke(tokens: TokenSet): Promise<void> {
    await this.http.send(DROPBOX_REVOKE, { method: "POST", headers: { authorization: `Bearer ${tokens.accessToken}` } }).catch(() => undefined);
  }
}

export const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
/** Only files Folevi created (or the person opened with Folevi): never the rest of their Drive. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export class GoogleOAuth implements OAuthClient {
  readonly provider = "googleDrive" as const;
  constructor(
    readonly clientId: string,
    private readonly http: RetryingHttp,
    private readonly now: () => number = Date.now,
    /**
     * Google's "Desktop app" clients come with a client secret that Google itself says isn't confidential
     * in an installed app. PKCE is what protects the exchange; the secret is sent only when the build has one
     * (FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET), for clients whose token endpoint still asks for it.
     */
    private readonly clientSecret?: string,
  ) {}

  authorizeUrl(o: { redirectUri: string; state: string; challenge: string }): string {
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: o.redirectUri,
      scope: DRIVE_SCOPE,
      code_challenge: o.challenge,
      code_challenge_method: "S256",
      state: o.state,
      // A refresh token every time (Google only sends one on consent).
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTHORIZE}?${q}`;
  }

  private withSecret(form: Record<string, string>): Record<string, string> {
    return this.clientSecret ? { ...form, client_secret: this.clientSecret } : form;
  }

  exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<TokenSet> {
    return tokenRequest(this.http, GOOGLE_TOKEN, this.withSecret({ grant_type: "authorization_code", code: o.code, code_verifier: o.verifier, client_id: this.clientId, redirect_uri: o.redirectUri }), this.now);
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return tokenRequest(this.http, GOOGLE_TOKEN, this.withSecret({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.clientId }), this.now, refreshToken);
  }

  async revoke(tokens: TokenSet): Promise<void> {
    await this.http
      .send(GOOGLE_REVOKE, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.refreshToken }).toString() })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------- tokens in use

export type AuthState = "connected" | "reconnect" | "disconnected";

/** Keeps a provider's tokens fresh: refreshes a minute before expiry, or at once after a 401. */
export class TokenManager {
  private tokens: TokenSet | null = null;
  private refreshing: Promise<TokenSet> | null = null;
  private _state: AuthState = "disconnected";
  private readonly listeners = new Set<(s: AuthState) => void>();

  constructor(
    readonly client: OAuthClient,
    private readonly store: TokenStore,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): AuthState {
    return this._state;
  }

  onState(cb: (s: AuthState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(s: AuthState) {
    if (s === this._state) return;
    this._state = s;
    for (const cb of this.listeners) cb(s);
  }

  /** Reads stored tokens; true when there are some. */
  async load(): Promise<boolean> {
    this.tokens = await this.store.load(this.client.provider);
    this.setState(this.tokens ? "connected" : "disconnected");
    return !!this.tokens;
  }

  async set(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
    await this.store.save(this.client.provider, tokens);
    this.setState("connected");
  }

  current(): TokenSet | null {
    return this.tokens;
  }

  /** Forgets the tokens here and in the store. */
  async clear(): Promise<void> {
    this.tokens = null;
    this.refreshing = null;
    await this.store.clear(this.client.provider);
    this.setState("disconnected");
  }

  /** The grant is gone: tokens are dropped and the person is asked to reconnect. */
  async markRevoked(): Promise<void> {
    this.tokens = null;
    this.refreshing = null;
    await this.store.clear(this.client.provider);
    this.setState("reconnect");
  }

  private reconnectError(): CloudError {
    return new CloudError("reconnect", `${this.client.provider === "dropbox" ? "Dropbox" : "Google Drive"} needs to be connected again.`);
  }

  async accessToken(): Promise<string> {
    const t = this.tokens;
    if (!t) throw this.reconnectError();
    if (t.expiresAt - this.now() > 60_000) return t.accessToken;
    return (await this.refreshNow(t.accessToken)).accessToken;
  }

  /** Refreshes once even when many requests ask at the same time. `stale` skips it if another refresh already replaced that token. */
  async refreshNow(stale?: string): Promise<TokenSet> {
    if (this.refreshing) return this.refreshing;
    const t = this.tokens;
    if (!t) throw this.reconnectError();
    if (stale !== undefined && t.accessToken !== stale && t.expiresAt - this.now() > 60_000) return t;
    this.refreshing = (async () => {
      try {
        const next = await this.client.refresh(t.refreshToken);
        if (this.tokens !== t) throw this.reconnectError(); // signed out meanwhile
        await this.set(next);
        return next;
      } catch (error) {
        if (error instanceof CloudError && error.kind === "reconnect") await this.markRevoked();
        throw error;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}

/** Sends API requests with the access token; a 401 refreshes once and retries, a second 401 means reconnect. */
export class AuthedHttp {
  constructor(
    readonly http: RetryingHttp,
    readonly tokens: TokenManager,
  ) {}

  async send(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const token = await this.tokens.accessToken();
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      const res = await this.http.send(url, { ...init, headers });
      if (res.status !== 401) return res;
      await res.body?.cancel().catch(() => undefined);
      if (attempt >= 2) {
        await this.tokens.markRevoked();
        throw new CloudError("reconnect", "The provider no longer accepts Folevi's sign-in.", 401);
      }
      await this.tokens.refreshNow(token);
    }
  }
}
