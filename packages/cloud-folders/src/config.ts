// Which built-in connections this build offers. The OAuth client ids are public (they ship in every copy of
// the app) but they are not committed: the build reads them from the environment and writes
// dist/cloud-config.json (scripts/cloud-config.mjs), and a development run may set them in the environment.
// A provider without a client id is hidden, with one clear line in the log. Platform neutral.
import type { CloudProvider } from "./types";

export interface CloudClientConfig {
  /** FOLEVI_DROPBOX_APP_KEY: the Dropbox app's "App key" (App Console > Settings). */
  dropboxAppKey?: string;
  /** FOLEVI_GOOGLE_DESKTOP_CLIENT_ID: the "Desktop app" OAuth client in Google Cloud. */
  googleClientId?: string;
  /** FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET: optional (see oauth.ts GoogleOAuth). */
  googleClientSecret?: string;
}

export const ENV_KEYS = {
  dropboxAppKey: "FOLEVI_DROPBOX_APP_KEY",
  googleClientId: "FOLEVI_GOOGLE_DESKTOP_CLIENT_ID",
  googleClientSecret: "FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET",
} as const;

const DROPBOX_KEY = /^[a-z0-9]{8,32}$/;
const GOOGLE_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const GOOGLE_SECRET = /^[A-Za-z0-9_-]{10,64}$/;

function clean(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return pattern.test(v) ? v : undefined;
}

/** The environment wins over the build's file (so a development run can try other clients). */
export function readCloudConfig(env: Record<string, string | undefined>, fromFile: unknown): CloudClientConfig {
  const file = (fromFile && typeof fromFile === "object" ? fromFile : {}) as Record<string, unknown>;
  const pick = (k: keyof CloudClientConfig, pattern: RegExp) => clean(env[ENV_KEYS[k]], pattern) ?? clean(file[k], pattern);
  const out: CloudClientConfig = {};
  const dropbox = pick("dropboxAppKey", DROPBOX_KEY);
  const google = pick("googleClientId", GOOGLE_ID);
  const secret = pick("googleClientSecret", GOOGLE_SECRET);
  if (dropbox) out.dropboxAppKey = dropbox;
  if (google) out.googleClientId = google;
  if (secret) out.googleClientSecret = secret;
  return out;
}

/** The providers this build can offer, logging once for each one it can't. */
export function availableProviders(config: CloudClientConfig, log: (message: string) => void = () => undefined): CloudProvider[] {
  const out: CloudProvider[] = [];
  if (config.dropboxAppKey) out.push("dropbox");
  else log(`"Sync with Dropbox" is hidden: this build has no Dropbox app key (set ${ENV_KEYS.dropboxAppKey} when building; docs/LOCAL_MODE.md).`);
  if (config.googleClientId) out.push("googleDrive");
  else log(`"Sync with Google Drive" is hidden: this build has no Google desktop client id (set ${ENV_KEYS.googleClientId} when building; docs/LOCAL_MODE.md).`);
  return out;
}
