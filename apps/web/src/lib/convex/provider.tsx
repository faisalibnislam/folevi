"use client";

import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { hostAuth, hostConvexToken } from "@/lib/auth/shellFetch";
import { currentBackendMode, setCurrentBackendMode, type BackendMode } from "@/lib/backendMode";
import { BackendModeContext } from "@/lib/mode";
import type { LocalClient } from "@/lib/local/client";

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

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      // A token belongs to one session: after a password change or re-verification the session is
      // replaced, and the old token would be refused by the backend.
      const cached = cache.current?.sessionId === sessionId || !sessionId ? cache.current : null;
      if (!forceRefreshToken && cached && cached.exp - Date.now() > 60_000) return cached.token;
      try {
        const res = (forceRefreshToken ? null : await takeEarlyToken()) ?? (await requestToken());
        const token = res.data?.token ?? null;
        if (token) {
          cache.current = { token, exp: tokenExpiry(token), sessionId };
          return token;
        }
        const status = (res.error as { status?: number } | null)?.status;
        if (status === 401 || status === 403) {
          cache.current = null;
          return null;
        }
      } catch {
        // Network trouble: fall through to the cached token while it's still valid.
      }
      return cached && cached.exp > Date.now() ? cached.token : null;
    },
    // A new session (sign-in, 2FA completed, password changed) must produce a new token.
    [sessionId],
  );

  const phase = authPhaseOf({ hasSession: Boolean(session?.session), isPending, error, online, slow });
  const auth = useMemo(
    () => ({
      isLoading: phase === "loading",
      isAuthenticated: phase === "signed_in" || (phase === "offline" && cache.current !== null),
      fetchAccessToken,
    }),
    [phase, fetchAccessToken],
  );
  return { auth, phase };
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
  return (
    <AuthPhaseContext.Provider value={phase}>
      <ConvexProviderWithAuth client={getConvexClient()} useAuth={useAuth}>
        {children}
      </ConvexProviderWithAuth>
    </AuthPhaseContext.Provider>
  );
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
