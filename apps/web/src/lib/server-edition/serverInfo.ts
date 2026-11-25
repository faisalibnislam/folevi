import "server-only";
// The server's own description (`server:info`, CONTRACT §7), asked from the web server over the loopback address
// and kept for a few seconds: the root layout, the well-known document and the sign-in page all read it.
import { ConvexHttpClient } from "convex/browser";
import { FOLEVI_VERSION } from "@/lib/version";
import { isServerEdition } from "@/lib/edition";
import { runtimeConfig } from "@/lib/runtime/config";
import { internalConvexUrl } from "@/lib/runtime/internal";
import { CLOUD_FEATURES, SERVER_API_VERSION, serverUrlsFor, type ServerInfo, type ServerInfoCore } from "./info";
import { serverRefs } from "./refs";

const TTL_MS = 10_000;
const TIMEOUT_MS = 2_500;

let cached: { at: number; value: ServerInfoCore | null } | null = null;
let inFlight: Promise<ServerInfoCore | null> | null = null;

async function ask(): Promise<ServerInfoCore | null> {
  const url = internalConvexUrl();
  if (!url) return null;
  try {
    return await Promise.race([
      new ConvexHttpClient(url).query(serverRefs.info, {}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

/** `server:info`, or null when the backend can't be reached (or the cloud edition, which has no such query). */
export async function serverInfoCore(): Promise<ServerInfoCore | null> {
  if (!isServerEdition()) return null;
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  inFlight ??= ask().finally(() => {
    inFlight = null;
  });
  const value = await inFlight;
  // A failed answer is kept for a moment only, so a backend that's starting is asked again soon.
  cached = { at: value ? now : now - TTL_MS + 2_000, value };
  return value;
}

/** Forgets the kept answer (after the setup page or the admin panel changed the settings). */
export function forgetServerInfo(): void {
  cached = null;
}

/** The whole well-known document (CONTRACT §6). */
export async function wellKnownDocument(): Promise<ServerInfo> {
  const config = runtimeConfig();
  if (!isServerEdition()) {
    return {
      kind: "folevi-cloud",
      apiVersion: SERVER_API_VERSION,
      name: "Folevi Cloud",
      version: FOLEVI_VERSION,
      minAppVersion: "",
      urls: { app: config.appUrl.replace(/\/+$/, ""), convex: config.convexUrl, convexSite: config.convexSiteUrl },
      signIn: { password: true, passkey: true, folevi: true, google: true, apple: true, signUp: "open" },
      features: CLOUD_FEATURES,
      connect: { serverId: null, hostnames: [] },
      needsSetup: false,
    };
  }
  const core = await serverInfoCore();
  const urls = serverUrlsFor(config.appUrl);
  if (!core) {
    // The backend isn't answering (still starting, or being updated): say who we are and that nothing is known yet.
    return {
      kind: "folevi-server",
      apiVersion: SERVER_API_VERSION,
      name: "Folevi Server",
      version: process.env.FOLEVI_SERVER_VERSION || FOLEVI_VERSION,
      minAppVersion: "",
      urls,
      signIn: { password: true, passkey: true, folevi: false, google: false, apple: false, signUp: "invite" },
      features: { ai: false, email: false, push: false, publicLinks: true },
      connect: { serverId: null, hostnames: [] },
      needsSetup: false,
    };
  }
  return { ...core, kind: "folevi-server", apiVersion: core.apiVersion ?? SERVER_API_VERSION, version: core.version || process.env.FOLEVI_SERVER_VERSION || FOLEVI_VERSION, urls };
}
