// Downloading a subscribed calendar (convex/externalCalendars.ts) without letting the address reach
// anything private: http or https only (webcal:// is read as https://), the standard ports, no user name
// or password, never a private, loopback or link-local address, whether written as an IP or reached
// through DNS (looked up first, via lib/ai/web.ts), at most MAX_REDIRECTS redirects with every hop checked
// again, 10 seconds in all and 5 MB at most. No cookies or credentials are sent. The address itself can
// carry a secret (private calendar links do), so it's never logged.
import { calendarUrlProblem, normalizeCalendarUrl } from "@folevi/editor-schema/publicUrl";
import { isPrivateAddress, lookup, readCapped } from "./ai/web";

export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type Download =
  | { kind: "ok"; text: string; etag: string | null; lastModified: string | null }
  | { kind: "notModified" }
  | { kind: "error"; message: string };

const failed = (why: string): Download => ({ kind: "error", message: `Couldn't load this calendar: ${why}` });

// Which links can be subscribed to is shared with the local backend (packages/editor-schema publicUrl.ts).
export { calendarUrlProblem, normalizeCalendarUrl } from "@folevi/editor-schema/publicUrl";

/** The host's addresses checked: none may be private. Null when fine, else why not. */
async function hostProblem(url: URL): Promise<string | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // IP literals were checked by checkUrl already.
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null;
  const addresses = await lookup(host);
  if (!addresses || !addresses.length) return "the address couldn't be found.";
  if (addresses.some(isPrivateAddress)) return "addresses on private or local networks can't be used.";
  return null;
}

/** Fetches a calendar's text, conditionally when an ETag or Last-Modified from last time is given. */
export async function downloadCalendar(url: string, previous: { etag?: string; lastModified?: string } = {}): Promise<Download> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = normalizeCalendarUrl(url);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const problem = calendarUrlProblem(current);
      if (problem) return failed(/private or local/.test(problem) ? "addresses on private or local networks can't be used." : "the address isn't a web link it can open.");
      const target = new URL(current);
      const dns = await hostProblem(target);
      if (dns) return failed(dns);
      const headers: Record<string, string> = {
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
        "user-agent": "Mozilla/5.0 (compatible; FoleviCalendar/1.0; +https://folevi.com)",
      };
      // Conditional only on the address it was saved for, not on a redirect's target.
      if (hop === 0 && previous.etag) headers["if-none-match"] = previous.etag;
      if (hop === 0 && previous.lastModified) headers["if-modified-since"] = previous.lastModified;
      let res: Response;
      try {
        res = await fetch(target.href, { method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal, headers });
      } catch {
        console.warn(JSON.stringify({ event: "calendar.fetch_failed", reason: controller.signal.aborted ? "timeout" : "network" }));
        return failed(controller.signal.aborted ? "the address took too long to answer." : "the address couldn't be reached.");
      }
      if (res.status === 304) {
        void res.body?.cancel().catch(() => {});
        return { kind: "notModified" };
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        void res.body?.cancel().catch(() => {});
        if (!location) return failed(`the address returned ${res.status}.`);
        current = normalizeCalendarUrl(new URL(location, target).href);
        continue;
      }
      if (!res.ok) {
        console.warn(JSON.stringify({ event: "calendar.fetch_failed", status: res.status }));
        void res.body?.cancel().catch(() => {});
        return failed(`the address returned ${res.status}.`);
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_CALENDAR_BYTES) {
        void res.body?.cancel().catch(() => {});
        return failed("it's larger than 5 MB.");
      }
      const bytes = await readCapped(res, MAX_CALENDAR_BYTES + 1);
      if (bytes.length > MAX_CALENDAR_BYTES) return failed("it's larger than 5 MB.");
      const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
      if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) return failed("the address didn't return a calendar.");
      console.log(JSON.stringify({ event: "calendar.fetched", status: res.status, bytes: bytes.length, redirects: hop }));
      return { kind: "ok", text, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
    }
    return failed("the address redirected too many times.");
  } catch {
    return failed(controller.signal.aborted ? "the address took too long to answer." : "the address couldn't be read.");
  } finally {
    clearTimeout(timer);
  }
}
