// The clipper's sign-in state. The client registration and the refresh token live in chrome.storage.local
// (they survive a browser restart); the short-lived access token lives in chrome.storage.session (memory
// only). An expired access token is refreshed before use, and a 401 from Folevi triggers one refresh and
// one retry; if the refresh is refused the person is signed out and asked to sign in again. Tokens are
// never logged.
import { OAuthError, refreshTokens, type TokenSet } from "./oauth";

/** The slice of chrome.storage the session needs (an in-memory one in tests). */
export interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Client {
  clientId: string;
  redirectUri: string;
}

export class SignedOutError extends Error {
  constructor(message = "Sign in to Folevi to clip.") {
    super(message);
    this.name = "SignedOutError";
  }
}

const CLIENT = "client";
const REFRESH = "refreshToken";
const ACCESS = "accessToken";

/** Refresh a little before the access token runs out, so a request never carries one about to expire. */
const EARLY_MS = 60_000;

export class Session {
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly deps: { origin: string; local: Store; memory: Store; fetch: typeof fetch; now?: () => number },
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  async client(): Promise<Client | null> {
    const c = (await this.deps.local.get(CLIENT)) as Client | undefined;
    return c && typeof c.clientId === "string" && typeof c.redirectUri === "string" ? c : null;
  }

  async setClient(client: Client): Promise<void> {
    await this.deps.local.set(CLIENT, client);
  }

  async signedIn(): Promise<boolean> {
    if (typeof (await this.deps.local.get(REFRESH)) === "string") return true;
    const access = (await this.deps.memory.get(ACCESS)) as { expiresAt?: number } | undefined;
    return !!access && typeof access.expiresAt === "number" && access.expiresAt > this.now();
  }

  /** Keeps a new token set (a refresh that sends no new refresh token keeps the old one). */
  async save(tokens: TokenSet): Promise<void> {
    await this.deps.memory.set(ACCESS, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    if (tokens.refreshToken) await this.deps.local.set(REFRESH, tokens.refreshToken);
  }

  /** Forgets the tokens (the registration stays, so signing in again doesn't register another client). */
  async signOut(): Promise<void> {
    await this.deps.memory.remove(ACCESS);
    await this.deps.local.remove(REFRESH);
  }

  /** A usable access token: the stored one while it's fresh, else a refreshed one. */
  async accessToken(): Promise<string> {
    const access = (await this.deps.memory.get(ACCESS)) as { token?: string; expiresAt?: number } | undefined;
    if (access?.token && typeof access.expiresAt === "number" && access.expiresAt - EARLY_MS > this.now()) return access.token;
    return await this.refresh();
  }

  /** Refreshes once even when several requests ask at the same time. */
  refresh(): Promise<string> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = await this.deps.local.get(REFRESH);
    const client = await this.client();
    if (typeof refreshToken !== "string" || !client) {
      await this.signOut();
      throw new SignedOutError();
    }
    try {
      const tokens = await refreshTokens(this.deps.origin, { clientId: client.clientId, refreshToken }, this.deps.fetch, this.now());
      await this.save(tokens);
      return tokens.accessToken;
    } catch (e) {
      // Refused (expired, revoked in Settings > Connected apps): sign in again. A network error keeps the tokens.
      if (e instanceof OAuthError) {
        await this.signOut();
        throw new SignedOutError("Your Folevi sign-in has ended. Sign in again to clip.");
      }
      throw e;
    }
  }

  /** `fetch` with the access token; a 401 refreshes once and retries, a second 401 signs out. */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      return this.deps.fetch(url, { ...init, headers, credentials: "omit" });
    };
    const first = await send(await this.accessToken());
    if (first.status !== 401) return first;
    const second = await send(await this.refresh());
    if (second.status !== 401) return second;
    await this.signOut();
    throw new SignedOutError("Folevi no longer accepts this connection. Sign in again to clip.");
  }
}
