// Which web addresses Folevi may read on someone's behalf (a page Foli AI opens, a subscribed calendar): http
// or https on the standard ports, no user name or password, and never a private, loopback, link-local or
// otherwise internal address. Pure, so the server (convex/lib/ai/web.ts, lib/icsFetch.ts) and the local
// backend, which fetches subscribed calendars on the device, check links the same way. DNS answers are
// checked where the fetch happens (the server's DNS-over-HTTPS lookup, the Mac app's resolver).

/** An IPv4 address as four numbers, or null. */
export function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata lives here)
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224 // multicast, reserved, broadcast
  );
}

/** An IPv6 address as eight 16-bit groups, or null. */
export function ipv6(raw: string): number[] | null {
  let host = raw.replace(/^\[|\]$/g, "").toLowerCase();
  const zone = host.indexOf("%");
  if (zone >= 0) host = host.slice(0, zone);
  if (!host.includes(":")) return null;
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups.
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
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return privateV4(v4At(6));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(v4At(6));
  return false;
}

/** Whether an IP address (v4 or v6) is one a page may never be read from. Unparseable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4(ip);
  if (v4) return privateV4(v4);
  const v6 = ipv6(ip);
  return v6 ? privateV6(v6) : true;
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".onion"];

/**
 * A link checked before anything is fetched: http or https, no user name or password in it, the
 * standard port, and a public host name or a public IP address. Returns the URL, or why not.
 */
export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That isn't a web address." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Only http and https pages can be read." };
  if (url.username || url.password) return { ok: false, error: "Links with a user name or password can't be read." };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, error: "Pages on unusual ports can't be read." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (ipv4(host) || host.startsWith("[")) {
    if (isPrivateAddress(host)) return { ok: false, error: "Pages on private or local addresses can't be read." };
    return { ok: true, url };
  }
  if (!host.includes(".") || host === "localhost" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s)) || /^[\d.]+$/.test(host)) {
    return { ok: false, error: "Pages on private or local addresses can't be read." };
  }
  return { ok: true, url };
}

/** A pasted calendar link as the address to fetch: trimmed, webcal(s):// read as https://. */
export function normalizeCalendarUrl(raw: string): string {
  return raw.trim().replace(/^webcals?:\/\//i, "https://");
}

/** Why a calendar link can't be subscribed to (checked before anything is fetched), or null when it can. */
export function calendarUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Paste a calendar link that starts with https://, http:// or webcal://.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Paste a calendar link that starts with https://, http:// or webcal://.";
  const checked = checkUrl(url);
  if (checked.ok) return null;
  if (/private or local/.test(checked.error)) return "Calendars on private or local networks can't be added.";
  if (/user name or password/.test(checked.error)) return "Links with a user name or password in them can't be added.";
  if (/ports/.test(checked.error)) return "Calendars on unusual ports can't be added.";
  return "Paste a calendar link that starts with https://, http:// or webcal://.";
}
