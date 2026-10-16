"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

let client: ConvexReactClient | null = null;
export function getConvexClient(): ConvexReactClient {
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
// Opening the app asks for the session and then a token for it. Both need a round trip to the auth server,
// so the token request starts at once, alongside the session check, and the first fetch uses its answer.
let early: { at: number; result: Promise<TokenResult> } | null = null;
let earlyStarted = false;
function startTokenFetch() {
  if (earlyStarted) return;
  earlyStarted = true;
  early = { at: Date.now(), result: authClient.convex.token({ fetchOptions: { throw: false } }) };
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
        const res = (forceRefreshToken ? null : await takeEarlyToken()) ?? (await authClient.convex.token({ fetchOptions: { throw: false } }));
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
