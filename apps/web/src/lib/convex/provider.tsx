"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

let client: ConvexReactClient | null = null;
export function getConvexClient(): ConvexReactClient {
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  if (!client) client = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false });
  return client;
}

/**
 * Where the browser stands with its Folevi session:
 * - `signed_in`: Better Auth confirmed a live session;
 * - `signed_out`: the server answered and there is no session (signed out, revoked or expired);
 * - `offline`: the auth server couldn't be reached, so we genuinely don't know — the app keeps working
 *   from this device's copy instead of claiming the session ended.
 */
export type AuthPhase = "loading" | "signed_in" | "signed_out" | "offline";
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

/**
 * Bridges Better Auth to Convex. Convex asks for a short-lived JWT (15 minutes) from
 * /api/auth/convex/token; the session cookie itself is HTTP-only and never readable here.
 */
function useFoleviAuth() {
  const { data: session, isPending, error } = authClient.useSession();
  const online = useOnline();
  const cache = useRef<{ token: string; exp: number; sessionId: string | undefined } | null>(null);
  const sessionId = session?.session?.id;
  const networkFailure = Boolean(error) && (!online || !(error as { status?: number }).status);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      // A token belongs to one session: after a password change or re-verification the session is
      // replaced, and the old token would be refused by the backend.
      const cached = cache.current?.sessionId === sessionId || !sessionId ? cache.current : null;
      if (!forceRefreshToken && cached && cached.exp - Date.now() > 60_000) return cached.token;
      try {
        const res = await authClient.convex.token({ fetchOptions: { throw: false } });
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

  const phase: AuthPhase = session?.session ? "signed_in" : isPending ? "loading" : networkFailure || !online ? "offline" : "signed_out";
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
