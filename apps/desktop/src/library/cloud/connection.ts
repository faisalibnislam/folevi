// "Sync with Dropbox" and "Sync with Google Drive" as one connection per library: signing in (PKCE in the
// browser, the code back on a loopback listener), the connection's state for the page ("Connected as …",
// "Offline", "Reconnect Dropbox"), the provider's LocalFs for the library layer, watching for changes, and
// signing out (tokens revoked and deleted, sync stopped, the copy on this device kept). Platform neutral: the
// host passes in fetch, the token store, the device copy, the browser and the redirect listener.
import { CloudFs, type CloudFsOptions } from "./cloudFs";
import { availableProviders, type CloudClientConfig } from "./config";
import { DropboxFs, DROPBOX_API, type DropboxFsOptions } from "./dropbox";
import { DRIVE_API, DriveFs, driveClassifier, type DriveFsOptions } from "./drive";
import { jsonOf, RetryingHttp, type RetryOptions } from "./http";
import type { MirrorStore } from "./mirror";
import { AuthedHttp, createPkce, DropboxOAuth, GoogleOAuth, randomToken, TokenManager, type OAuthClient, type TokenStore } from "./oauth";
import { isCloudError, PROVIDER_NAMES, type CloudChange, type CloudProvider, type HttpFetch, type Sleep } from "./types";

export type ConnectionState = "none" | "connecting" | "connected" | "offline" | "reconnect";

export interface ConnectionStatus {
  /** The connections this build offers (hidden without a client id). */
  available: CloudProvider[];
  provider: CloudProvider | null;
  state: ConnectionState;
  /** "faisal@example.com", when the provider says. */
  account: string | null;
}

export interface SavedConnection {
  provider: CloudProvider;
  account: string | null;
  connectedAt: number;
}

export interface RedirectListener {
  redirectUri: string;
  result: Promise<{ code: string }>;
  close(): void;
}

export interface ConnectionDeps {
  config: CloudClientConfig;
  fetch: HttpFetch;
  tokens: TokenStore;
  /** Which provider this device's library is on (a small file next to the settings on the Mac). */
  saved: { load(): Promise<SavedConnection | null>; save(s: SavedConnection | null): Promise<void> };
  mirrorFor(provider: CloudProvider): MirrorStore;
  /** Opens the provider's sign-in page in the person's browser. */
  openBrowser(url: string): Promise<void>;
  /** Starts the listener the sign-in ends on. */
  listen(provider: CloudProvider, state: string): Promise<RedirectListener>;
  log?: (message: string) => void;
  sleep?: Sleep;
  now?: () => number;
  retry?: RetryOptions;
  fsOptions?: { dropbox?: DropboxFsOptions; googleDrive?: DriveFsOptions };
}

export class OneConnectionOnly extends Error {
  override name = "OneConnectionOnly";
}

interface Live {
  provider: CloudProvider;
  tokens: TokenManager;
  http: RetryingHttp;
  api: AuthedHttp;
  fs: CloudFs;
  account: string | null;
}

export class CloudConnections {
  readonly available: CloudProvider[];
  private live: Live | null = null;
  private state: ConnectionState = "none";
  private connecting: RedirectListener | null = null;
  private readonly listeners = new Set<(s: ConnectionStatus) => void>();
  private readonly watchers = new Set<{ stop(): void }>();
  private readonly log: (message: string) => void;

  constructor(private readonly deps: ConnectionDeps) {
    this.log = deps.log ?? (() => undefined);
    this.available = availableProviders(deps.config, this.log);
  }

  status(): ConnectionStatus {
    return { available: [...this.available], provider: this.live?.provider ?? null, state: this.state, account: this.live?.account ?? null };
  }

  onStatus(cb: (s: ConnectionStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(state: ConnectionState) {
    if (state === this.state) return;
    this.state = state;
    const s = this.status();
    for (const cb of this.listeners) cb(s);
  }

  /** The library's LocalFs while connected (also while offline or waiting to reconnect: it answers from the device copy). */
  get fs(): CloudFs | null {
    return this.live?.fs ?? null;
  }

  private client(provider: CloudProvider, http: RetryingHttp): OAuthClient {
    const now = this.deps.now ?? Date.now;
    if (provider === "dropbox") return new DropboxOAuth(this.deps.config.dropboxAppKey!, http, now);
    return new GoogleOAuth(this.deps.config.googleClientId!, http, now, this.deps.config.googleClientSecret);
  }

  private build(provider: CloudProvider, account: string | null): Live {
    const retry: RetryOptions = {
      ...this.deps.retry,
      onReachable: (ok) => {
        if (this.live?.tokens.state === "reconnect") return;
        if (!ok) this.setState("offline");
        else if (this.state === "offline") this.setState("connected");
      },
    };
    const http = new RetryingHttp(this.deps.fetch, retry, provider === "googleDrive" ? driveClassifier : undefined);
    const tokens = new TokenManager(this.client(provider, http), this.deps.tokens, this.deps.now);
    tokens.onState((s) => {
      if (s === "reconnect") {
        this.log(`${PROVIDER_NAMES[provider]} refused Folevi's sign-in: showing "Reconnect ${PROVIDER_NAMES[provider]}".`);
        this.setState("reconnect");
      }
    });
    const api = new AuthedHttp(http, tokens);
    const base: CloudFsOptions = { log: this.log, ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}), ...(this.deps.now ? { now: this.deps.now } : {}) };
    const mirror = this.deps.mirrorFor(provider);
    const fs =
      provider === "dropbox"
        ? new DropboxFs(api, http, mirror, { ...base, ...this.deps.fsOptions?.dropbox })
        : new DriveFs(api, mirror, { ...base, ...this.deps.fsOptions?.googleDrive });
    return { provider, tokens, http, api, fs, account };
  }

  /** At startup: the saved connection and its tokens. No network. */
  async restore(): Promise<ConnectionStatus> {
    const saved = await this.deps.saved.load();
    if (!saved || !this.available.includes(saved.provider)) {
      if (saved) this.log(`The library is on ${PROVIDER_NAMES[saved.provider]}, which this build can't connect to.`);
      return this.status();
    }
    this.live = this.build(saved.provider, saved.account);
    const has = await this.live.tokens.load();
    await this.live.fs.open();
    this.setState(has ? "connected" : "reconnect");
    return this.status();
  }

  /**
   * Signs in to the provider in the browser and makes it this library's sync. Reconnecting (after a revoked
   * or expired sign-in) is the same call. Rejects when cancelled, timed out or refused; the state goes back.
   */
  async connect(provider: CloudProvider): Promise<ConnectionStatus> {
    if (!this.available.includes(provider)) throw new Error(`${PROVIDER_NAMES[provider]} isn't available in this build of Folevi.`);
    if (this.live && this.live.provider !== provider)
      throw new OneConnectionOnly(`This library syncs with ${PROVIDER_NAMES[this.live.provider]}. Sign out of ${PROVIDER_NAMES[this.live.provider]} first.`);
    this.connecting?.close();
    const before = this.state;
    this.setState("connecting");
    try {
      const pkce = await createPkce();
      const state = randomToken(16);
      const listener = await this.deps.listen(provider, state);
      this.connecting = listener;
      const live = this.live ?? this.build(provider, null);
      const url = live.tokens.client.authorizeUrl({ redirectUri: listener.redirectUri, state, challenge: pkce.challenge });
      await this.deps.openBrowser(url);
      const { code } = await listener.result;
      const tokens = await live.tokens.client.exchange({ code, verifier: pkce.verifier, redirectUri: listener.redirectUri });
      await live.tokens.set(tokens);
      live.account = await this.account(live).catch(() => live.account);
      this.live = live;
      await this.deps.saved.save({ provider, account: live.account, connectedAt: (this.deps.now ?? Date.now)() });
      this.log(`Connected to ${PROVIDER_NAMES[provider]}${live.account ? ` as ${live.account}` : ""}.`);
      this.setState("connected");
      return this.status();
    } catch (error) {
      this.setState(this.live ? (before === "connecting" ? "reconnect" : before) : "none");
      throw error;
    } finally {
      this.connecting = null;
    }
  }

  /** Stops a sign-in that is waiting for the browser. */
  cancelConnect(): void {
    this.connecting?.close();
  }

  private async account(live: Live): Promise<string | null> {
    if (live.provider === "dropbox") {
      const res = await live.api.send(`${DROPBOX_API}/users/get_current_account`, { method: "POST", headers: { "content-type": "application/json" }, body: "null" });
      const body = await jsonOf<{ email?: string; name?: { display_name?: string } }>(res);
      return body?.email ?? body?.name?.display_name ?? null;
    }
    const res = await live.api.send(`${DRIVE_API}/about?fields=${encodeURIComponent("user(emailAddress,displayName)")}`);
    const body = await jsonOf<{ user?: { emailAddress?: string; displayName?: string } }>(res);
    return body?.user?.emailAddress ?? body?.user?.displayName ?? null;
  }

  /**
   * Signs out of the provider: tells it to forget Folevi's grant (best effort), deletes the tokens, stops
   * watching. The library's copy on this device stays where it is.
   */
  async signOut(): Promise<ConnectionStatus> {
    this.cancelConnect();
    for (const w of this.watchers) w.stop();
    this.watchers.clear();
    const live = this.live;
    if (live) {
      const t = live.tokens.current();
      if (t) await live.tokens.client.revoke(t).catch(() => undefined);
      await live.tokens.clear();
      this.log(`Signed out of ${PROVIDER_NAMES[live.provider]}; the library stays on this Mac.`);
    }
    this.live = null;
    await this.deps.saved.save(null);
    this.setState("none");
    return this.status();
  }

  /** Reports the provider's changes until the returned function is called (or the connection ends). */
  watch(cb: (changes: CloudChange[]) => void): () => void {
    const live = this.live;
    if (!live) return () => undefined;
    const handle = live.fs.watch(cb, (error) => {
      if (isCloudError(error, "offline")) this.setState("offline");
      else if (!isCloudError(error, "reconnect")) this.log(`Watching ${PROVIDER_NAMES[live.provider]}: ${(error as Error)?.message ?? error}`);
    });
    this.watchers.add(handle);
    return () => {
      handle.stop();
      this.watchers.delete(handle);
    };
  }
}
