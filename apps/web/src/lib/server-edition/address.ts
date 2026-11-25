// "Your own server" at sign-in (docs/SELF_HOSTING_PLAN.md §8): what someone types into the address field, made
// into an origin, and whether it may be used. Plain http only for addresses on this device or the home network
// (localhost, a name with no dots, .local names, private, link-local and 100.64/10 addresses, CONTRACT §6.1);
// anywhere else a server must use https.

export type AddressCheck = { ok: true; origin: string } | { ok: false; reason: string };

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** On this device or the home network: where plain http is allowed. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  // A name with no dots (a NAS's own name on the home network).
  if (host && !host.includes(".") && !host.includes(":")) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".home.arpa")) return true;
  const v4 = ipv4(host);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) {
    if (host === "::1") return true;
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    // fc00::/7 (unique local) and fe80::/10 (link local).
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

/**
 * The origin for what was typed: "nas.local:8460", "192.168.1.20:8460", "notes.example.com" or a full address.
 * Without a scheme, a home-network address gets http and anything else https.
 */
export function checkServerAddress(input: string): AddressCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "Enter your server's address." };
  if (/\s/.test(raw)) return { ok: false, reason: "An address has no spaces." };
  let url: URL;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    if (hasScheme) url = new URL(raw);
    else {
      const guess = new URL(`https://${raw}`);
      url = isPrivateHost(guess.hostname) ? new URL(`http://${raw}`) : guess;
    }
  } catch {
    return { ok: false, reason: "That doesn't look like an address. Try something like notes.example.com." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Use an http or https address." };
  if (url.username || url.password) return { ok: false, reason: "Leave the name and password out of the address." };
  if (!url.hostname) return { ok: false, reason: "Enter your server's address." };
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
    return { ok: false, reason: "Outside your home network, your server needs a secure (https) address. Set one up in its admin panel under Remote access." };
  }
  return { ok: true, origin: url.origin };
}

/** The Connect name of a linked server (CONTRACT §9): `<id>.folevi.app`. */
export function connectOrigin(hostname: string): string {
  return `https://${hostname.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
}
