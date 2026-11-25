// Host configuration. The same Next.js app serves the marketing site (folevi.com) and the product
// (app.folevi.com, including /admin). Locally: http://localhost:3000 and http://app.localhost:3000.
//
// These are functions, not constants: in Folevi Server (lib/edition.ts) the addresses come from the runtime
// environment (lib/runtime/config.ts), which a module can't read when it's first loaded in the browser. In Folevi
// Cloud they return the NEXT_PUBLIC_* values inlined at build time, as the constants did.
import { isServerEdition } from "@/lib/edition";
import { runtimeConfig } from "@/lib/runtime/config";

/** The marketing site. In the server edition there is none, and this is the server's own address. */
export function marketingUrl(): string {
  return runtimeConfig().marketingUrl;
}

/** The product. */
export function appUrl(): string {
  return runtimeConfig().appUrl;
}

/**
 * Folevi's public website, for help pages and policies (Terms, Privacy, the AI policy). The cloud's marketing site;
 * a server links to folevi.com for these, since it has no marketing pages of its own.
 */
export function websiteUrl(): string {
  return isServerEdition() ? "https://folevi.com" : marketingUrl();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function marketingHost(): string {
  return hostOf(marketingUrl());
}

export function appHost(): string {
  return hostOf(appUrl());
}

/**
 * The address public links (/s/<token>) are given out on: the real web address on every platform (folevi.com, the
 * owner's choice), never the page's own origin, which in the apps is app://folevi or capacitor://localhost.
 * folevi.com/s/… forwards to the product host (proxy.ts), and the browser keeps an encrypted link's #fragment.
 * A server gives them out on its own public address.
 */
export function shareOrigin(): string {
  return runtimeConfig().shareOrigin.replace(/\/$/, "");
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
