// Moving to another Folevi server from a sign-in screen (docs/self-hosting/CONTRACT.md §6). In a browser the
// server's own web app is the right place, so the page goes there. Inside the Mac, iPhone and iPad apps the page
// asks the host to add the server as a new place (`places.addServerPlace`, lib/shell/types.ts), which keeps its
// addresses, security policy and session apart from every other place.
import { shell } from "@/lib/shell";
import { parseServerInfo, SERVER_API_VERSION, type ServerInfo } from "./info";

const TIMEOUT_MS = 6000;

export type LookupResult = { ok: true; info: ServerInfo } | { ok: false; reason: string };

/** Asks a server for its `/.well-known/folevi.json`. */
export async function lookUpServer(origin: string): Promise<LookupResult> {
  let res: Response;
  try {
    res = await fetch(`${origin}/.well-known/folevi.json`, { mode: "cors", credentials: "omit", cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, reason: "We couldn't reach that address. Check it, and that the server is on." };
  }
  if (!res.ok) return { ok: false, reason: "That address answered, but it isn't a Folevi server." };
  let info: ServerInfo | null;
  try {
    info = parseServerInfo(await res.json());
  } catch {
    info = null;
  }
  if (!info) return { ok: false, reason: "That address answered, but it isn't a Folevi server." };
  if (info.apiVersion > SERVER_API_VERSION) return { ok: false, reason: "This server is newer than this version of Folevi. Update Folevi to use it." };
  return { ok: true, info };
}

/** Whether the app around this page can add a server place itself. */
export function canAddServerPlace(): boolean {
  return typeof shell()?.places?.addServerPlace === "function";
}

/**
 * Goes to the server: the host adds it as a place (in the apps), or the browser opens its sign-in page. Returns
 * the host's refusal in words, or null. `origin`
 * is the address the person chose (it may differ from `info.urls.app`, a home-network name for example).
 */
export async function openServer(origin: string, info: ServerInfo | null): Promise<string | null> {
  const places = shell()?.places;
  if (places?.addServerPlace) {
    // The host reloads every window on the server's sign-in screen; a refusal comes back as words to show.
    try {
      await places.addServerPlace({ origin, info });
      return null;
    } catch (e) {
      const message = (e as { message?: unknown } | null)?.message;
      return typeof message === "string" && message ? message : "That server couldn't be added. Try again.";
    }
  }
  const target = info?.needsSetup ? `${origin}/setup` : `${origin}/signin`;
  window.location.assign(target);
  return null;
}
