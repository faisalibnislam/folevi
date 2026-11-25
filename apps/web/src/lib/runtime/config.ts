// The addresses this web app talks to (docs/self-hosting/CONTRACT.md §4).
//
// Folevi Cloud: the NEXT_PUBLIC_* values inlined at build time, exactly as before.
// Folevi Server: one public origin read from the runtime environment (FOLEVI_PUBLIC_URL), which can change
// without a rebuild (a new domain, a Connect name). On the server it's read from process.env; the root layout
// hands it to the browser (RuntimeConfigProvider, a JSON script tag), and the browser reads it from there.
import { isServerEdition } from "@/lib/edition";
import { serverUrlsFor, type ServerFeatures } from "@/lib/server-edition/info";

export interface RuntimeConfig {
  /** Convex's client API (queries, mutations, the sync socket). */
  convexUrl: string;
  /** Convex HTTP actions (Better Auth, signed file URLs). */
  convexSiteUrl: string;
  /** The product's own address. */
  appUrl: string;
  /** The marketing site; in the server edition the server itself (there is no marketing site). */
  marketingUrl: string;
  /** Where public links (/s/<token>) are given out. */
  shareOrigin: string;
  /** Server edition: what the owner turned on (server:info). Null in the cloud, and while unknown. */
  features: ServerFeatures | null;
  /** Server edition: the server's name, for page titles and the sign-in screen. */
  serverName: string | null;
}

/** The id of the JSON script tag the root layout writes the browser's copy into. */
export const RUNTIME_CONFIG_ELEMENT_ID = "folevi-runtime";

const DEFAULT_SERVER_ORIGIN = "http://localhost:8460";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Folevi Cloud's addresses, read the way the code read them before the server edition existed. */
export function cloudRuntimeConfig(): RuntimeConfig {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
  return {
    convexUrl,
    convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? convexUrl.replace(".convex.cloud", ".convex.site"),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com",
    marketingUrl,
    shareOrigin: trimSlash(marketingUrl),
    features: null,
    serverName: null,
  };
}

/** A server on one public origin (CONTRACT §2). */
export function serverRuntimeConfig(publicUrl: string | undefined, extra?: { features?: ServerFeatures | null; serverName?: string | null }): RuntimeConfig {
  const origin = originOf(publicUrl) ?? DEFAULT_SERVER_ORIGIN;
  const urls = serverUrlsFor(origin);
  return {
    convexUrl: urls.convex,
    convexSiteUrl: urls.convexSite,
    appUrl: urls.app,
    marketingUrl: urls.app,
    shareOrigin: urls.app,
    features: extra?.features ?? null,
    serverName: extra?.serverName ?? null,
  };
}

let browserCopy: RuntimeConfig | null = null;

/** RuntimeConfigProvider (and tests) put the browser's copy here before anything below it renders. */
export function setBrowserRuntimeConfig(config: RuntimeConfig | null): void {
  browserCopy = config;
}

function readBrowserCopy(): RuntimeConfig {
  if (browserCopy) return browserCopy;
  try {
    const text = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID)?.textContent;
    if (text) {
      const parsed = JSON.parse(text) as RuntimeConfig;
      if (parsed && typeof parsed.convexUrl === "string" && typeof parsed.appUrl === "string") {
        browserCopy = parsed;
        return parsed;
      }
    }
  } catch {
    /* fall through to the page's own origin */
  }
  // Nothing handed over (a page rendered before the layout, an error page): on one origin the page's own origin
  // is the server's.
  return serverRuntimeConfig(window.location.origin);
}

/** The addresses for this process (server) or this page (browser). */
export function runtimeConfig(): RuntimeConfig {
  if (!isServerEdition()) return cloudRuntimeConfig();
  if (typeof window === "undefined") return serverRuntimeConfig(process.env.FOLEVI_PUBLIC_URL);
  return readBrowserCopy();
}

/** The JSON for the script tag: `<` escaped so the text can never close the tag. */
export function serializeRuntimeConfig(config: RuntimeConfig): string {
  return JSON.stringify(config).replace(/</g, "\\u003c").replace(/ /g, "\\u2028").replace(/ /g, "\\u2029");
}

/** Whether the public address is served over HTTPS (HSTS and upgrade-insecure-requests only then). */
export function servedOverHttps(config: RuntimeConfig = runtimeConfig()): boolean {
  return config.appUrl.startsWith("https:");
}
