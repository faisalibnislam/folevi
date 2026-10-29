"use client";

import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient, useConvexAuth } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { hostAuth, hostConvexToken } from "@/lib/auth/shellFetch";
import { currentBackendMode, setCurrentBackendMode, type BackendMode } from "@/lib/backendMode";
import { BackendModeContext } from "@/lib/mode";
import type { LocalClient } from "@/lib/local/client";
import { api } from "@/lib/convex/api";
import type { E2eeRouterClient } from "@/lib/e2ee/router/client";
import { setActiveRouter } from "@/lib/e2ee/router/active";
import { adoptSession, pinnedUserId } from "@/lib/places/pin";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

let client: ConvexReactClient | null = null;
/**
 * The account's Convex client, for code outside React (lib/nativePush.ts, lib/nativeDevice.ts). There is
 * none in local mode: nothing may reach Folevi's servers there, so asking for it is a mistake and throws.
 */
export function getConvexClient(): ConvexReactClient {
  if (currentBackendMode() === "local") throw new Error("There's no Convex client in local mode (getConvexClient).");
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  // initialAuthTokenReuse: the first token is always freshly minted (see fetchAccessToken), so once the
  // server accepts it there's no need for Convex's usual second fetch, which also re-ran every query.
  if (!client) client = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false, initialAuthTokenReuse: true });
  return client;
}

/**
 * Where the browser stands with its Folevi session:
 * - `signed_in`: Better Auth confirmed a live session;
 * - `signed_out`: the server answered and there is no session (signed out, revoked or expired);
 * - `offline`: the auth server couldn't be reached, so we genuinely don't know. The app keeps working
 *   from this device's copy instead of claiming the session ended.
 */
export type AuthPhase = "loading" | "signed_in" | "signed_out" | "offline";

/** How long the first session check may take before the app opens from this device's copy instead. */
export const SESSION_CHECK_PATIENCE_MS = 6000;
/**
 * A token request that hasn't answered by now is given up and asked again: a connection that died quietly
 * (after the Mac slept, a network change) otherwise leaves it waiting forever, and the app on its loading
 * screen until it's reloaded.
 */
export const TOKEN_FETCH_TIMEOUT_MS = 10_000;

/**
 * Where the session stands, from Better Auth's session check. Only a definite answer from the server signs
 * anyone out: no session in a successful reply, or 401/403. Everything else that failed (no answer, a
 * gateway or server error, a rate limit, a check that hangs, the device offline) is `offline`, so the app
 * opens with what this device has and shows its sync status, the same as with no network at all.
 */
export function authPhaseOf(s: { hasSession: boolean; isPending: boolean; error: unknown; online: boolean; slow: boolean }): AuthPhase {
  if (s.hasSession) return "signed_in";
  if (!s.online) return "offline";
  if (s.isPending) return s.slow ? "offline" : "loading";
  if (s.error) {
    const status = (s.error as { status?: number }).status;
    return status === 401 || status === 403 ? "signed_out" : "offline";
  }
  return "signed_out";
}
const AuthPhaseContext = createContext<AuthPhase>("loading");
export function useAuthPhase(): AuthPhase {
  return useContext(AuthPhaseContext);
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

function tokenExpiry(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

type TokenResult = Awaited<ReturnType<typeof authClient.convex.token>>;
/** A Convex token: from Better Auth, or in the apps' built-in interface from the host, which keeps the session. */
function requestToken(): Promise<TokenResult> {
  if (hostAuth()) return hostConvexToken(TOKEN_FETCH_TIMEOUT_MS) as Promise<TokenResult>;
  return authClient.convex.token({ fetchOptions: { throw: false, timeout: TOKEN_FETCH_TIMEOUT_MS } });
}
// Opening the app asks for the session and then a token for it. Both need a round trip to the auth server,
// so the token request starts at once, alongside the session check, and the first fetch uses its answer.
let early: { at: number; result: Promise<TokenResult> } | null = null;
let earlyStarted = false;
function startTokenFetch() {
  if (earlyStarted) return;
  earlyStarted = true;
  early = { at: Date.now(), result: requestToken() };
}
/** The early answer, if it's a token and still fresh (a "no session" from before signing in never counts). */
async function takeEarlyToken(): Promise<TokenResult | null> {
  const pending = early;
  early = null;
  if (!pending || Date.now() - pending.at > 30_000) return null;
  const res = await pending.result.catch(() => null);
  return res?.data?.token ? res : null;
}

/**
 * Whether this device holds a signed-in account's copy (the offline snapshot's marker, removed on sign-out):
 * there's a session worth waiting for when the network is away.
 */
function knownAccount(): boolean {
  try {
    return typeof localStorage !== "undefined" && Boolean(localStorage.getItem("folevi:last-account"));
  } catch {
    return false;
  }
}

/** Resolves after `ms`, or sooner once the device says it's back online. */
function waitForNetwork(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}

/**
 * Bridges Better Auth to Convex. Convex asks for a short-lived JWT (15 minutes) from
 * /api/auth/convex/token; the session cookie itself is HTTP-only and never readable here.
 */
function useFoleviAuth() {
  if (typeof window !== "undefined") startTokenFetch();
  const { data: session, isPending, error } = authClient.useSession();
  const online = useOnline();
  const cache = useRef<{ token: string; exp: number; sessionId: string | undefined } | null>(null);
  const sessionId = session?.session?.id;
  // A session check that takes this long (a network that swallows requests) counts as no answer.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!isPending || slow) return;
    const timer = setTimeout(() => setSlow(true), SESSION_CHECK_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [isPending, slow]);

  // The session the token is for, read inside the token fetch. The fetch itself changes only when one known
  // session gives way to another (a password change, re-verification): its first becoming known (after an
  // offline start) or the session check going quiet offline don't, since each change makes Convex drop the
  // sign-in and start again, and in that moment everything subscribed runs as nobody and is refused.
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const epoch = useRef({ id: sessionId, n: 0 });
  if (sessionId && epoch.current.id && sessionId !== epoch.current.id) epoch.current = { id: sessionId, n: epoch.current.n + 1 };
  else if (sessionId && !epoch.current.id) epoch.current = { id: sessionId, n: epoch.current.n };
  const sessionEpoch = epoch.current.n;

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      for (let attempt = 0; ; attempt++) {
        // A token belongs to one session: after a password change or re-verification the session is
        // replaced, and the old token would be refused by the backend.
        const current = sessionRef.current;
        const cached = cache.current?.sessionId === current || !current ? cache.current : null;
        if (!forceRefreshToken && cached && cached.exp - Date.now() > 60_000) return cached.token;
        try {
          const res = (forceRefreshToken || attempt ? null : await takeEarlyToken()) ?? (await requestToken());
          const token = res.data?.token ?? null;
          if (token) {
            cache.current = { token, exp: tokenExpiry(token), sessionId: sessionRef.current };
            return token;
          }
          const status = (res.error as { status?: number } | null)?.status;
          if (status === 401 || status === 403) {
            cache.current = null;
            return null;
          }
        } catch {
          // Network trouble: below.
        }
        if (cached && cached.exp > Date.now()) return cached.token;
        // No answer and no token that still works (offline, or the token ran out while it was): wait for the
        // network and ask again, rather than going on as nobody. Convex holds back every query and mutation
        // while it waits for this, so nothing is refused for want of a sign-in; this device's copy shows
        // meanwhile. Only a definite "no session" (401/403) ends it. (An account never seen on this device
        // goes on as nobody, as before, so the sign-in pages work offline.)
        if (!knownAccount()) return null;
        await waitForNetwork(Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000));
      }
    },
    // A new session (sign-in, 2FA completed, password changed) must produce a new token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionEpoch],
  );

  // A tab that opened on the browser's active session (no account named yet) stays with it from now on.
  const userId = session?.user?.id;
  useEffect(() => {
    if (userId) adoptSession(userId);
  }, [userId]);

  const phase = authPhaseOf({ hasSession: Boolean(session?.session), isPending, error, online, slow });
  // Offline (or still asking) on a device that has this account's copy: signed in as far as Convex is
  // concerned, its token on its way (fetchAccessToken waits for the network). Switching to "not signed in"
  // for those moments would run every query as nobody, and the app would show "This page couldn't load".
  const known = knownAccount();
  const auth = useMemo(
    () => ({
      isLoading: phase === "loading" && !known,
      isAuthenticated: phase === "signed_in" || ((phase === "offline" || phase === "loading") && (known || cache.current !== null)),
      fetchAccessToken,
    }),
    [phase, fetchAccessToken, known],
  );
  return { auth, phase };
}

/**
 * This browser has seen the signed-in account with E2EE set up: start with the router, so nothing remounts. Per
 * account (`folevi:e2ee:<user id>`, several accounts in one browser); the browser-wide key from before is read
 * by an account with no hint of its own yet.
 */
const E2EE_HINT = "folevi:e2ee";
const hintKey = () => {
  const user = pinnedUserId();
  return user ? `${E2EE_HINT}:${user}` : E2EE_HINT;
};

function readHint(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const own = localStorage.getItem(hintKey());
    return (own ?? localStorage.getItem(E2EE_HINT)) === "1";
  } catch {
    return false;
  }
}

function writeHint(on: boolean) {
  try {
    if (on) localStorage.setItem(hintKey(), "1");
    else localStorage.setItem(hintKey(), "0");
    if (hintKey() !== E2EE_HINT) localStorage.removeItem(E2EE_HINT);
  } catch {
    /* storage unavailable */
  }
}

type StatusWatch = { onUpdate(cb: () => void): () => void; localQueryResult(): unknown };

/** Builds the router (loaded on demand: Standard accounts never download it, docs/E2EE_DESIGN.md §6.4). */
export async function makeE2eeRouter(raw: ConvexReactClient): Promise<E2eeRouterClient> {
  const [{ E2eeRouterClient }, keys] = await Promise.all([import("@/lib/e2ee/router/client"), import("@/lib/e2ee/keys")]);
  const session = keys.getKeySession();
  return new E2eeRouterClient(raw, {
    session,
    keyring: keys.getKeyRing(),
    // A public or shared computer keeps nothing readable: its replicas stay in memory (§6.10).
    persist: () => !(session as { isPublic?: () => boolean }).isPublic?.(),
  });
}

/**
 * The client the account's pages use (§6.4): the raw ConvexReactClient, unless the account has end-to-end
 * encryption set up (e2ee.keys.status().setUp), in which case the E2eeRouterClient wrapping it. Standard
 * accounts get exactly the raw client and never load the router (test/e2ee/provider.test.tsx).
 */
export function useAccountClient(raw: ConvexReactClient, make: (raw: ConvexReactClient) => Promise<E2eeRouterClient> = makeE2eeRouter): { client: ConvexReactClient; ready: boolean } {
  const [hinted] = useState(readHint);
  const [router, setRouter] = useState<E2eeRouterClient | null>(null);
  const [wanted, setWanted] = useState(hinted);
  useEffect(() => {
    const w = (raw.watchQuery as unknown as (r: unknown, a: unknown) => StatusWatch)(api.e2ee.keys.status, {});
    const read = () => {
      let s: { setUp?: boolean } | undefined;
      try {
        s = w.localQueryResult() as { setUp?: boolean } | undefined;
      } catch {
        // Not signed in yet, or no answer: nothing changes.
        return;
      }
      if (s === undefined) return;
      writeHint(s.setUp === true);
      setWanted(s.setUp === true);
    };
    const off = w.onUpdate(read);
    read();
    return off;
  }, [raw]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    let made: E2eeRouterClient | null = null;
    void make(raw).then(
      (r) => {
        made = r;
        if (!live) return void r.dispose();
        setActiveRouter(r);
        setRouter(r);
      },
      (e) => {
        console.warn("[e2ee] The encrypted notes router couldn't start.", e instanceof Error ? e.name : typeof e);
        if (live) setWanted(false);
      },
    );
    return () => {
      live = false;
      if (made) {
        setActiveRouter(null);
        void made.dispose();
      }
      setRouter(null);
    };
  }, [wanted, raw, make]);
  if (!wanted) return { client: raw, ready: true };
  return { client: (router as unknown as ConvexReactClient) ?? raw, ready: router !== null };
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("loading");
  const useAuth = useCallback(function useAuth() {
    const { auth, phase: current } = useFoleviAuth();
    // Surface the phase to the app without re-creating the Convex provider.
    useEffect(() => setPhase(current), [current]);
    return auth;
  }, []);
  if (!convexUrl) {
    return (
      <div role="alert" className="ui-card m-8 p-6">
        Folevi isn&apos;t connected to a backend yet (NEXT_PUBLIC_CONVEX_URL is missing). See docs/DEPLOYMENT.md.
      </div>
    );
  }
  return <AccountConvex phase={phase} useAuth={useAuth}>{children}</AccountConvex>;
}

const noSubscribe = () => () => {};

function AccountConvex({ phase, useAuth, children }: { phase: AuthPhase; useAuth: Parameters<typeof ConvexProviderWithAuth>[0]["useAuth"]; children: ReactNode }) {
  const { client, ready } = useAccountClient(getConvexClient());
  // The E2EE hint lives in this browser's storage, so the server can't know `ready`: the server and the
  // hydrating render both show nothing, and the app starts right after (an account with the hint set no
  // longer renders differently from the server's HTML, React error #418).
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return (
    <AuthPhaseContext.Provider value={phase}>
      <ConvexProviderWithAuth client={client} useAuth={useAuth}>
        <BackendAuthed>{hydrated && ready ? children : null}</BackendAuthed>
      </ConvexProviderWithAuth>
    </AuthPhaseContext.Provider>
  );
}

/**
 * Whether the backend has taken this page's sign-in (Convex confirmed the token). Until it has, anything sent is
 * sent as nobody and refused as "unauthenticated": after an offline start, reconnecting, or a token that ran out
 * while the device was offline, the sync engine and outbox wait for this instead of sending into that refusal
 * (lib/app/state.tsx). Always true in local mode (no sign-in) and outside the account's provider.
 */
const BackendAuthedContext = createContext(true);
export function useBackendAuthed(): boolean {
  return useContext(BackendAuthedContext);
}
function BackendAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  return <BackendAuthedContext.Provider value={isAuthenticated}>{children}</BackendAuthedContext.Provider>;
}

const LocalClientContext = createContext<LocalClient | null>(null);

/** The LocalClient in local mode (its `local` extras: putFile, setup), else null. */
export function useLocalClient(): LocalClient | null {
  return useContext(LocalClientContext);
}

/**
 * The page's backend (docs/LOCAL_MODE_PLAN.md §2.1). `account`: today's Convex client with Better Auth.
 * `local`: ConvexProvider gets this page's LocalClient (lib/local), so every useQuery, useMutation and
 * useAction runs against the library on this device and no ConvexReactClient is ever made. A page keeps
 * the backend it started with.
 */
export function BackendProvider({ backend = "account", children }: { backend?: BackendMode; children: ReactNode }) {
  // Set before anything below renders, for code that reads it outside React (canPurchaseHere, getConvexClient).
  setCurrentBackendMode(backend);
  if (backend === "account") {
    return (
      <BackendModeContext.Provider value="account">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </BackendModeContext.Provider>
    );
  }
  return <LocalBackendProvider>{children}</LocalBackendProvider>;
}

function LocalBackendProvider({ children }: { children: ReactNode }) {
  // Loaded on demand: the website (account mode only) never downloads the local backend.
  const [local, setLocal] = useState<LocalClient | null>(null);
  useEffect(() => {
    let live = true;
    void import("@/lib/local").then((m) => {
      if (live) setLocal(m.localLibrary().client);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!local) return null;
  return (
    <BackendModeContext.Provider value="local">
      <AuthPhaseContext.Provider value="signed_in">
        <LocalClientContext.Provider value={local}>
          {/* The one place a LocalClient stands in for a ConvexReactClient (test/local-client.test.tsx keeps it honest). */}
          <ConvexProvider client={local as unknown as ConvexReactClient}>{children}</ConvexProvider>
        </LocalClientContext.Provider>
      </AuthPhaseContext.Provider>
    </BackendModeContext.Provider>
  );
}
