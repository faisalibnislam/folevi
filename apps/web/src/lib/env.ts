// Host configuration. The same Next.js app serves the marketing site (folevi.com) and the product
// (app.folevi.com, including /admin). Locally: http://localhost:3000 and http://app.localhost:3000.
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com";

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export const MARKETING_HOST = hostOf(MARKETING_URL);
export const APP_HOST = hostOf(APP_URL);

/**
 * The address public links (/s/<token>) are given out on: the real web address on every platform (folevi.com, the
 * owner's choice), never the page's own origin, which in the apps is app://folevi or capacitor://localhost.
 * folevi.com/s/… forwards to the product host (proxy.ts), and the browser keeps an encrypted link's #fragment.
 */
export const SHARE_ORIGIN = MARKETING_URL.replace(/\/$/, "");

/**
 * Where public links are given out right now: SHARE_ORIGIN, or on Folevi Server (lib/serverEdition.ts) the
 * address this page was opened on, since one server build runs at any address.
 */
export function shareOrigin(): string {
  if (process.env.NEXT_PUBLIC_FOLEVI_EDITION === "server" && typeof window !== "undefined") return window.location.origin;
  return SHARE_ORIGIN;
}

/** The product's address for links to a note: APP_URL, or on Folevi Server the address this page was opened on. */
export function appUrlHere(): string {
  if (process.env.NEXT_PUBLIC_FOLEVI_EDITION === "server" && typeof window !== "undefined") return window.location.origin;
  return APP_URL.replace(/\/$/, "");
}

/** A public link's whole address. */
export function publicLinkUrl(token: string): string {
  return `${shareOrigin()}/s/${token}`;
}

/** The same link (its path, query and fragment) on the share origin. */
export function onShareOrigin(url: string): string {
  const u = new URL(url);
  return `${shareOrigin()}${u.pathname}${u.search}${u.hash}`;
}
