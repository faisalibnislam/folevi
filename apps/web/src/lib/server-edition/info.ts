// What a Folevi server says about itself: `/.well-known/folevi.json` (docs/self-hosting/CONTRACT.md §6). The
// backend's `server:info` query answers everything but `urls`, which the web server adds from its own runtime
// addresses. Types and pure helpers only, so the browser, the route handler and the tests share them.

export const SERVER_API_VERSION = 1;

export interface ServerSignIn {
  password: boolean;
  passkey: boolean;
  folevi: boolean;
  google: boolean;
  apple: boolean;
  signUp: "invite" | "open" | "domains";
}

export interface ServerFeatures {
  ai: boolean;
  email: boolean;
  push: boolean;
  publicLinks: boolean;
}

/** `server:info` (CONTRACT §7): the well-known document without `urls`. */
export interface ServerInfoCore {
  kind: "folevi-server" | "folevi-cloud";
  apiVersion: number;
  name: string;
  version: string;
  minAppVersion: string;
  signIn: ServerSignIn;
  features: ServerFeatures;
  connect: { serverId: string | null; hostnames: string[] };
  needsSetup: boolean;
}

export interface ServerUrls {
  app: string;
  convex: string;
  convexSite: string;
}

/** The whole `/.well-known/folevi.json`. */
export interface ServerInfo extends ServerInfoCore {
  urls: ServerUrls;
}

/** Everything on: what Folevi Cloud offers, and the safe guess while a server's own answer is unknown. */
export const CLOUD_FEATURES: ServerFeatures = { ai: true, email: true, push: true, publicLinks: true };

/** A server whose backend can't be asked yet: nothing optional is on, and it may still need setting up. */
export const UNKNOWN_SERVER_FEATURES: ServerFeatures = { ai: false, email: false, push: false, publicLinks: true };

/** The addresses of a server on one origin (CONTRACT §2): the app at `/`, Convex at `/convex`, HTTP actions at `/convex-site`. */
export function serverUrlsFor(origin: string): ServerUrls {
  const app = origin.replace(/\/+$/, "");
  return { app, convex: `${app}/convex`, convexSite: `${app}/convex-site` };
}

/**
 * Reads a well-known document someone else's server sent: anything that isn't shaped like one is null, and so is a
 * server speaking an API version this build doesn't know.
 */
export function parseServerInfo(value: unknown): ServerInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ServerInfo>;
  if (v.kind !== "folevi-server" && v.kind !== "folevi-cloud") return null;
  if (typeof v.apiVersion !== "number" || typeof v.name !== "string") return null;
  const urls = v.urls as Partial<ServerUrls> | undefined;
  if (!urls || typeof urls.app !== "string" || typeof urls.convex !== "string" || typeof urls.convexSite !== "string") return null;
  const features = (v.features ?? {}) as Partial<ServerFeatures>;
  const signIn = (v.signIn ?? {}) as Partial<ServerSignIn>;
  return {
    kind: v.kind,
    apiVersion: v.apiVersion,
    name: v.name.slice(0, 120),
    version: typeof v.version === "string" ? v.version : "",
    minAppVersion: typeof v.minAppVersion === "string" ? v.minAppVersion : "",
    urls: { app: urls.app, convex: urls.convex, convexSite: urls.convexSite },
    signIn: {
      password: signIn.password !== false,
      passkey: signIn.passkey === true,
      folevi: signIn.folevi === true,
      google: signIn.google === true,
      apple: signIn.apple === true,
      signUp: signIn.signUp === "open" || signIn.signUp === "domains" ? signIn.signUp : "invite",
    },
    features: { ai: features.ai === true, email: features.email === true, push: features.push === true, publicLinks: features.publicLinks !== false },
    connect: {
      serverId: typeof v.connect?.serverId === "string" ? v.connect.serverId : null,
      hostnames: Array.isArray(v.connect?.hostnames) ? v.connect.hostnames.filter((h): h is string => typeof h === "string") : [],
    },
    needsSetup: v.needsSetup === true,
  };
}

/** "1.6.0" < "1.10.0": dotted numbers, missing parts are 0, anything else counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
