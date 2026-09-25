"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

let client: ConvexReactClient | null = null;
export function getConvexClient(): ConvexReactClient {
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  if (!client) client = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false });
  return client;
}

/**
 * Bridges the server-side session (Auth0 or local dev sign-in) to Convex: the browser fetches a
 * short-lived identity token from our same-origin /api/auth/token route. Tokens never touch storage.
 */
function useServerSessionAuth(signedIn: boolean) {
  const [authFailed, setAuthFailed] = useState(false);
  const cache = useRef<{ token: string; expiresAt: number } | null>(null);
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    const cached = cache.current;
    if (!forceRefreshToken && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    try {
      const res = await fetch(`/api/auth/token${forceRefreshToken ? "?refresh=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) {
        cache.current = null;
        setAuthFailed(true);
        return null;
      }
      if (!res.ok) return cached?.token ?? null;
      const json = (await res.json()) as { token: string; expiresAt: number };
      cache.current = json;
      return json.token;
    } catch {
      // Offline: keep using the cached token until it expires; Convex will retry when back online.
      return cached && cached.expiresAt > Date.now() ? cached.token : null;
    }
  }, []);
  return useMemo(
    () => ({ isLoading: false, isAuthenticated: signedIn && !authFailed, fetchAccessToken }),
    [signedIn, authFailed, fetchAccessToken],
  );
}

export function ConvexClientProvider({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const useAuth = useCallback(function useAuth() {
    return useServerSessionAuth(signedIn);
  }, [signedIn]);
  if (!convexUrl) {
    return (
      <div role="alert" className="m-8 rounded-xl border border-line bg-surface p-6">
        Folevi isn&apos;t connected to a backend yet (NEXT_PUBLIC_CONVEX_URL is missing). See docs/DEPLOYMENT.md.
      </div>
    );
  }
  return (
    <ConvexProviderWithAuth client={getConvexClient()} useAuth={useAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
