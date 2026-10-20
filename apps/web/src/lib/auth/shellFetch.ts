// Signed-in mode inside the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4). The page lives on
// app://folevi (or capacitor://localhost), where a session cookie for the service can't work, so Better
// Auth's client hands every request to the host instead: `shell().auth.fetch(path, init)`. Native code allows
// only the service's /api/auth/*, adds the bearer session it keeps in the Keychain (the page never sees it),
// sends no cookies, and stores a rotated token if one comes back. This file is only used by shell builds.
import { isShell, shell } from "@/lib/shell";

/** Folevi's website, where /api/auth lives. The built-in interface has no server of its own. */
export function serviceUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com").replace(/\/$/, "");
}

/** Statuses a Response can't carry a body with. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function abortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("The operation was aborted.", "AbortError")
    : Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

/** The init the bridge takes: plain values only (it crosses into native code). */
export type ShellFetchInit = { method: string; headers: Record<string, string>; body?: string };

/** The path and query of an /api/auth URL on the service, or null for anything else. */
export function shellAuthPath(input: string | URL): string | null {
  let url: URL;
  try {
    url = new URL(String(input), `${serviceUrl()}/`);
  } catch {
    return null;
  }
  if (url.origin !== new URL(serviceUrl()).origin || !url.pathname.startsWith("/api/auth/"))
    return null;
  return `${url.pathname}${url.search}`;
}

/**
 * A `fetch` for Better Auth's client (`fetchOptions.customFetchImpl`) that goes through the host. Errors
 * from the host (no network) reject like a failed fetch, so the auth phase reads them as "offline".
 */
export async function shellAuthFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const host = shell();
  if (!host) throw new TypeError("Failed to fetch: no app bridge");
  const path = shellAuthPath(input instanceof Request ? input.url : input);
  if (!path) throw new TypeError("Failed to fetch: only the service's /api/auth is reachable here");
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const body = init.body;
  if (body != null && typeof body !== "string")
    throw new TypeError("Failed to fetch: only text bodies reach the app bridge");
  const request: ShellFetchInit = {
    method: (init.method ?? "GET").toUpperCase(),
    headers,
    ...(body != null ? { body } : {}),
  };

  const signal = init.signal;
  if (signal?.aborted) throw abortError();
  const answer = host.auth.fetch(path, request as RequestInit);
  const res = signal
    ? await new Promise<Awaited<typeof answer>>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        answer.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
      })
    : await answer;
  const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
  return new Response(NULL_BODY.has(status) ? null : res.body, { status, headers: res.headers });
}

/** Better Auth's fetch in shell builds: the host's, or the page's own when no host is there (a plain browser). */
export function authFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return shell()?.auth ? shellAuthFetch(input, init) : fetch(input, init);
}

/** Whether sign-in, sign-out and session tokens go through the host (the built-in interface with a bridge). */
export function hostAuth(): boolean {
  return isShell() && Boolean(shell()?.auth);
}

/**
 * Signs in through the host: the website opens in the browser (or the sign-in sheet on iOS), and the app
 * comes back signed in. The page reloads so every query starts with the new session.
 */
export async function shellSignIn(): Promise<boolean> {
  const host = shell();
  if (!host) return false;
  const ok = await host.auth.signIn();
  if (ok) window.location.reload();
  return ok;
}

/**
 * Where a web page in the product links to one of the website's own pages (/forgot-password,
 * /verify-email): the page itself on the website, or the full address in the built-in interface, where the
 * host opens it in the browser.
 */
export function websitePage(path: string): string {
  return isShell() ? `${serviceUrl()}${path}` : path;
}

/**
 * A Convex token from the host, shaped like Better Auth's answer: the token, or a 401 when the host has no
 * live session. A host that can't reach the service rejects (and so does one that takes too long), which
 * the token fetch treats as "offline", never as signed out.
 */
export async function hostConvexToken(
  timeoutMs: number,
): Promise<{ data: { token: string } | null; error: { status: number } | null }> {
  const host = shell();
  if (!host) throw new TypeError("Failed to fetch: no app bridge");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      host.auth.convexToken(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(abortError()), timeoutMs);
      }),
    ]);
    return token ? { data: { token }, error: null } : { data: null, error: { status: 401 } };
  } finally {
    clearTimeout(timer);
  }
}
