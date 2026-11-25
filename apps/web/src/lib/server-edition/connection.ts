// The best connection to a Folevi Server (docs/SELF_HOSTING_PLAN.md §4, §8; CONTRACT §6.1), shared by the shells
// that run the web app without native code for it (Android, Windows, Linux) and by the browser. The Mac and
// iPhone/iPad apps do the same in Swift (`ShellServer.candidates`, `ServerReach`); keep the two in step.
//
// Order: home names first (Connect's `192-168-1-20.<id>.folevi.app`, the NAS's LAN address with a real
// certificate), then the address the person added, then every other name (`<id>.folevi.app`, which Connect
// points at the public address when the server is reachable from the internet, else at Folevi Relay). Every
// candidate is asked at once; the first in this order that answers as this server wins. The session belongs to
// the server, not the name, so switching names never signs anyone out.
import { isPrivateHost } from "./address";

export interface ServerUrls {
  app: string;
  convex: string;
  convexSite: string;
}

/** What a place remembers about its server (the fields of `ShellServerInfo` this needs). */
export interface ServerPlaceAddresses {
  /** The address the person added (an origin). */
  addedOrigin: string;
  /** Connect's names for the server (`host` or `host:port`, always https), from folevi.json `connect.hostnames`. */
  hostnames: readonly string[];
  /** The Connect server id, when linked: another server answering on a home address must not be taken for it. */
  serverId: string | null;
}

/** An origin from a `connect.hostnames` entry or a typed origin, or null when it isn't one Folevi would use. */
export function originOf(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) return null;
  return url.origin;
}

/** A Connect home name: its first label is a dashed IPv4 address (`https://192-168-1-20.abc.folevi.app`). */
export function isHomeName(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  const first = host.split(".")[0] ?? "";
  return host.includes(".") && /^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/.test(first);
}

/** Every origin the server can be reached at, in the order to prefer them. */
export function candidateOrigins(place: ServerPlaceAddresses): string[] {
  const named = place.hostnames.map((h) => originOf(`https://${h.replace(/^https?:\/\//i, "")}`)).filter((o): o is string => !!o);
  const added = originOf(place.addedOrigin);
  const ordered = [...named.filter(isHomeName), ...(added ? [added] : []), ...named];
  return [...new Set(ordered)];
}

/** The server's addresses moved to `origin`: each URL on the added origin keeps its path on the new one. */
export function urlsAt(urls: ServerUrls, addedOrigin: string, origin: string): ServerUrls {
  const from = originOf(addedOrigin);
  const move = (u: string): string => {
    if (!from) return u;
    try {
      const url = new URL(u);
      if (url.origin !== from) return u;
      return `${origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    } catch {
      return u;
    }
  };
  return { app: move(urls.app), convex: move(urls.convex), convexSite: move(urls.convexSite) };
}

export type Fetcher = (url: string, init: { signal: AbortSignal; cache: RequestCache }) => Promise<Response>;

/** Whether `origin` answers folevi.json as this server, within `timeoutMs`. */
export async function answersAsServer(origin: string, place: Pick<ServerPlaceAddresses, "serverId">, opts: { timeoutMs?: number; fetcher?: Fetcher } = {}): Promise<boolean> {
  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4_000);
  try {
    const res = await fetcher(`${origin}/.well-known/folevi.json`, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return false;
    const info = (await res.json()) as { kind?: unknown; connect?: { serverId?: unknown } } | null;
    if (info?.kind !== "folevi-server") return false;
    return place.serverId ? info.connect?.serverId === place.serverId : true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The best origin now: every candidate is asked at once, and the first in preference order that answers wins.
 * Null when none answers (offline, or the server is down): keep using the current one.
 */
export async function bestOrigin(place: ServerPlaceAddresses, opts: { timeoutMs?: number; fetcher?: Fetcher } = {}): Promise<string | null> {
  const list = candidateOrigins(place);
  if (list.length === 0) return null;
  const answers = await Promise.all(list.map((o) => answersAsServer(o, place, opts)));
  const i = answers.findIndex(Boolean);
  return i >= 0 ? list[i]! : null;
}

/**
 * Re-checks the best origin at start, when the device comes back online and when the page becomes visible again
 * (a laptop that left home), at most once per `minGapMs`. `onChange` gets each new best origin. Returns a stop
 * function. Only for places with more than one candidate.
 */
export function watchBestOrigin(
  place: ServerPlaceAddresses,
  current: string,
  onChange: (origin: string) => void,
  opts: { timeoutMs?: number; fetcher?: Fetcher; minGapMs?: number; target?: Pick<Window, "addEventListener" | "removeEventListener">; doc?: Pick<Document, "visibilityState"> } = {},
): () => void {
  if (candidateOrigins(place).length < 2) return () => {};
  const target = opts.target ?? (typeof window !== "undefined" ? window : undefined);
  const doc = opts.doc ?? (typeof document !== "undefined" ? document : undefined);
  const minGap = opts.minGapMs ?? 15_000;
  let active = current;
  let stopped = false;
  let running = false;
  let again = false;
  let last = 0;

  const check = async (force = false): Promise<void> => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (!force && Date.now() - last < minGap) return;
    running = true;
    last = Date.now();
    try {
      const best = await bestOrigin(place, opts);
      if (!stopped && best && best !== active) {
        active = best;
        onChange(best);
      }
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        void check(true);
      }
    }
  };
  const onOnline = () => void check(true);
  const onVisible = () => {
    if (!doc || doc.visibilityState === "visible") void check();
  };
  target?.addEventListener("online", onOnline);
  target?.addEventListener("visibilitychange", onVisible);
  void check(true);
  return () => {
    stopped = true;
    target?.removeEventListener("online", onOnline);
    target?.removeEventListener("visibilitychange", onVisible);
  };
}
