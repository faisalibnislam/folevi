import "server-only";
import { cookies } from "next/headers";
import { auth0 } from "./auth0";
import { DEV_COOKIE, mintDevIdToken, readDevSession } from "./dev";
import { isDevAuthEnabled } from "@/lib/env";

export type ViewerSession =
  | { kind: "auth0"; email: string | null; name: string | null }
  | { kind: "dev"; email: string; name: string };

export async function getViewerSession(): Promise<ViewerSession | null> {
  if (auth0) {
    const session = await auth0.getSession();
    if (session) return { kind: "auth0", email: (session.user.email as string | undefined) ?? null, name: (session.user.name as string | undefined) ?? null };
  }
  if (isDevAuthEnabled()) {
    const jar = await cookies();
    const dev = await readDevSession(jar.get(DEV_COOKIE)?.value);
    if (dev) return { kind: "dev", email: dev.email, name: dev.name };
  }
  return null;
}

/**
 * The identity token the Convex client presents. For Auth0 this is the ID token (Convex validates
 * issuer, audience = client id, expiry, signature); it is refreshed with the refresh token when close
 * to expiry. Returned only to same-origin requests with the session cookie.
 */
export async function getConvexToken(forceRefresh: boolean): Promise<{ token: string; expiresAt: number } | null> {
  if (auth0) {
    const session = await auth0.getSession();
    if (session) {
      const idToken = session.tokenSet.idToken;
      const exp = idToken ? decodeExp(idToken) : 0;
      if (idToken && !forceRefresh && exp - Date.now() > 120_000) return { token: idToken, expiresAt: exp };
      try {
        await auth0.getAccessToken({ refresh: true });
      } catch {
        return null;
      }
      const refreshed = await auth0.getSession();
      const token = refreshed?.tokenSet.idToken;
      return token ? { token, expiresAt: decodeExp(token) } : null;
    }
  }
  if (isDevAuthEnabled()) {
    const jar = await cookies();
    const dev = await readDevSession(jar.get(DEV_COOKIE)?.value);
    if (dev) return await mintDevIdToken(dev);
  }
  return null;
}

function decodeExp(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}
