// Subscribed calendars in local mode (docs/LOCAL_MODE_PLAN.md WP14): the page asks for a calendar's text
// (`foleviShell.http.calendar`) and this Mac fetches it straight from the calendar's own site. Never through
// Folevi: Folevi's own hosts are refused, so local mode never contacts Folevi this way either.
//
// The same rules as the server's fetch (convex/lib/icsFetch.ts), with the same words, but https only (webcal://
// is read as https://; a plain http link or redirect is refused, since nothing protects it on the way), the
// standard port, no user name or password, never a private, loopback
// or link-local address, written as an IP or reached through DNS (this Mac's resolver), at most
// MAX_REDIRECTS redirects with every hop checked again, 10 seconds in all and 5 MB at most. No cookies or
// credentials are sent. The address can carry a secret (private calendar links do), so it's never logged.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type CalendarDownload =
  | { kind: "ok"; text: string; etag: string | null; lastModified: string | null }
  | { kind: "notModified" }
  | { kind: "error"; message: string };

const failed = (why: string): CalendarDownload => ({ kind: "error", message: `Couldn't load this calendar: ${why}` });

/** Folevi's own hosts: the app's service, folevi.com and its subdomains, and the backend's. */
export function isFoleviHost(host: string, serviceHost: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const service = serviceHost.toLowerCase();
  return h === service || h === "folevi.com" || h.endsWith(".folevi.com") || h.endsWith(".convex.cloud") || h.endsWith(".convex.site");
}

// ---- addresses (the same checks as packages/editor-schema publicUrl.ts) ------------------------------------

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

function ipv6(raw: string): number[] | null {
  let host = raw.replace(/^\[|\]$/g, "").toLowerCase();
  const zone = host.indexOf("%");
  if (zone >= 0) host = host.slice(0, zone);
  if (!host.includes(":")) return null;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted) {
    const v4 = ipv4(dotted[1]!);
    if (!v4) return null;
    host = `${host.slice(0, -dotted[1]!.length)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out.length === 8 ? out : null;
}

function privateV6(g: number[]): boolean {
  const v4At = (i: number) => [g[i]! >> 8, g[i]! & 255, g[i + 1]! >> 8, g[i + 1]! & 255];
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  if ((g[0]! & 0xfe00) === 0xfc00) return true;
  if ((g[0]! & 0xffc0) === 0xfe80) return true;
  if ((g[0]! & 0xff00) === 0xff00) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return privateV4(v4At(6));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(v4At(6));
  return false;
}

/** Whether an IP address may never be fetched from. Unparseable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4(ip);
  if (v4) return privateV4(v4);
  const v6 = ipv6(ip);
  return v6 ? privateV6(v6) : true;
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".onion"];

/** Why an address can't be fetched (before DNS), in the words the server uses, or null. */
export function addressProblem(raw: string, serviceHost: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "the address isn't a web link it can open.";
  }
  if (url.protocol === "http:") return "this Mac only reads calendars from secure (https) links.";
  if (url.protocol !== "https:") return "the address isn't a web link it can open.";
  if (url.username || url.password) return "the address isn't a web link it can open.";
  if (url.port && url.port !== "443") return "the address isn't a web link it can open.";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isFoleviHost(host, serviceHost)) return "Folevi's own addresses can't be subscribed to.";
  if (ipv4(host) || host.startsWith("[")) return isPrivateAddress(host) ? "addresses on private or local networks can't be used." : null;
  if (!host.includes(".") || host === "localhost" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s)) || /^[\d.]+$/.test(host)) return "addresses on private or local networks can't be used.";
  return null;
}

export type Lookup = (host: string) => Promise<string[]>;

const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** The host's addresses: none may be private. Null when fine, else why not. */
async function hostProblem(url: URL, lookup: Lookup): Promise<string | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return "the address couldn't be found.";
  }
  if (!addresses.length) return "the address couldn't be found.";
  if (addresses.some(isPrivateAddress)) return "addresses on private or local networks can't be used.";
  return null;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) {
      void reader.cancel().catch(() => undefined);
      break;
    }
  }
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - at);
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return out;
}

export interface CalendarFetchDeps {
  /** The app's service host (urls.ts SERVICE_URL): never fetched. */
  serviceHost: string;
  fetch?: typeof fetch;
  lookup?: Lookup;
}

/** Fetches a calendar's text, conditionally when an ETag or Last-Modified from last time is given. */
export async function downloadCalendar(rawUrl: unknown, previous: unknown, deps: CalendarFetchDeps): Promise<CalendarDownload> {
  if (typeof rawUrl !== "string" || rawUrl.length > 2000) return failed("the address isn't a web link it can open.");
  const prev = (previous && typeof previous === "object" ? previous : {}) as { etag?: unknown; lastModified?: unknown };
  const etag = typeof prev.etag === "string" && prev.etag.length <= 500 ? prev.etag : null;
  const lastModified = typeof prev.lastModified === "string" && prev.lastModified.length <= 100 ? prev.lastModified : null;
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? systemLookup;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = rawUrl.trim().replace(/^webcals?:\/\//i, "https://");
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const problem = addressProblem(current, deps.serviceHost);
      if (problem) return failed(problem);
      const target = new URL(current);
      const dns = await hostProblem(target, lookup);
      if (dns) return failed(dns);
      const headers: Record<string, string> = {
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
        "user-agent": "Mozilla/5.0 (compatible; FoleviCalendar/1.0; +https://folevi.com)",
      };
      // Conditional only on the address it was saved for, not on a redirect's target.
      if (hop === 0 && etag) headers["if-none-match"] = etag;
      if (hop === 0 && lastModified) headers["if-modified-since"] = lastModified;
      let res: Response;
      try {
        res = await doFetch(target.href, { method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal, headers });
      } catch {
        return failed(controller.signal.aborted ? "the address took too long to answer." : "the address couldn't be reached.");
      }
      if (res.status === 304) {
        void res.body?.cancel().catch(() => undefined);
        return { kind: "notModified" };
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        void res.body?.cancel().catch(() => undefined);
        if (!location) return failed(`the address returned ${res.status}.`);
        current = new URL(location, target).href.replace(/^webcals?:\/\//i, "https://");
        continue;
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        return failed(`the address returned ${res.status}.`);
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_CALENDAR_BYTES) {
        void res.body?.cancel().catch(() => undefined);
        return failed("it's larger than 5 MB.");
      }
      const bytes = await readCapped(res, MAX_CALENDAR_BYTES + 1);
      if (bytes.length > MAX_CALENDAR_BYTES) return failed("it's larger than 5 MB.");
      const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
      if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) return failed("the address didn't return a calendar.");
      return { kind: "ok", text, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
    }
    return failed("the address redirected too many times.");
  } catch {
    return failed(controller.signal.aborted ? "the address took too long to answer." : "the address couldn't be read.");
  } finally {
    clearTimeout(timer);
  }
}
