// Folevi Server's release manifest (docs/SELF_HOSTING_PLAN.md §3): the /server page reads it on the server and
// takes every download link from it. It lives in the update bucket beside the Mac downloads, at
// folevi.com/download/server/latest.json (the rewrite in next.config.ts). Anything missing or malformed shows as
// "Coming soon" on the page, never as a dead link.

/** The update bucket's own address (DOWNLOAD_ORIGIN in next.config.ts), so the page's fetch skips a hop. */
const DOWNLOAD_ORIGIN = "https://pub-e55d5e1b47314fcbbbe3664ed7aed1c2.r2.dev";
/** FOLEVI_SERVER_MANIFEST_URL overrides it, for trying the page with a sample manifest. */
export const SERVER_MANIFEST_URL = `${DOWNLOAD_ORIGIN}/server/latest.json`;
/** Where Synology's Package Center finds Folevi's package source. */
export const SYNOLOGY_PACKAGE_SOURCE_URL = "https://folevi.com/download/server/synology/";
/** How often the page reads the manifest again, in seconds. */
export const SERVER_MANIFEST_REVALIDATE = 600;

export const SERVER_PLATFORMS = ["synology", "qnap", "asustor", "terramaster", "ugreen", "unraid", "deb", "rpm"] as const;
export const SERVER_ARCHES = ["x86_64", "aarch64"] as const;
export type ServerPlatform = (typeof SERVER_PLATFORMS)[number];
export type ServerArch = (typeof SERVER_ARCHES)[number];

export interface ServerFile {
  platform: ServerPlatform;
  arch: ServerArch;
  name: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

export interface ServerManifest {
  version: string;
  releasedAt: string | null;
  channel: string;
  notesUrl: string | null;
  files: ServerFile[];
  unraidPluginUrl: string | null;
  installScript: string | null;
  dockerImage: string | null;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, max = 200): string | null => (typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null);

/** An https address on folevi.com or one of its subdomains, with no login part; anything else is dropped. */
export function safeFoleviUrl(value: unknown): string | null {
  const raw = str(value, 500);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host !== "folevi.com" && !host.endsWith(".folevi.com")) return null;
  return url.toString();
}

/** A container image reference such as ghcr.io/folevi/server:1.2.0 (letters, digits and . _ - / : @ only). */
function imageRef(value: unknown): string | null {
  const raw = str(value, 200);
  return raw && /^[a-z0-9][a-z0-9._\-/]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/.test(raw) ? raw : null;
}

function parseFile(value: unknown): ServerFile | null {
  if (!isObject(value)) return null;
  const platform = SERVER_PLATFORMS.find((p) => p === value.platform);
  const arch = SERVER_ARCHES.find((a) => a === value.arch);
  const name = str(value.name, 160);
  const url = safeFoleviUrl(value.url);
  const sha256 = typeof value.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(value.sha256) ? value.sha256.toLowerCase() : null;
  const size = value.sizeBytes;
  const sizeBytes = typeof size === "number" && Number.isSafeInteger(size) && size > 0 ? size : null;
  if (!platform || !arch || !name || !url || !sha256 || !sizeBytes) return null;
  return { platform, arch, name, url, sha256, sizeBytes };
}

/**
 * The manifest, checked field by field: null when it has no usable version; a file entry that fails any check is
 * left out (so it shows as "Coming soon"), as is any address that isn't https on folevi.com.
 */
export function parseServerManifest(value: unknown): ServerManifest | null {
  if (!isObject(value)) return null;
  const version = str(value.version, 40);
  if (!version || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) return null;
  const releasedAt = str(value.releasedAt, 40);
  const files: ServerFile[] = [];
  for (const entry of Array.isArray(value.files) ? value.files.slice(0, 100) : []) {
    const file = parseFile(entry);
    if (file && !files.some((f) => f.platform === file.platform && f.arch === file.arch)) files.push(file);
  }
  return {
    version,
    releasedAt: releasedAt && !Number.isNaN(Date.parse(releasedAt)) ? releasedAt : null,
    channel: str(value.channel, 20) ?? "beta",
    notesUrl: safeFoleviUrl(value.notesUrl),
    files,
    unraidPluginUrl: safeFoleviUrl(value.unraidPluginUrl),
    installScript: safeFoleviUrl(value.installScript),
    dockerImage: imageRef(value.dockerImage),
  };
}

/** The file for a platform and chip, or null ("Coming soon"). */
export function serverFile(manifest: ServerManifest | null, platform: ServerPlatform, arch: ServerArch): ServerFile | null {
  return manifest?.files.find((f) => f.platform === platform && f.arch === arch) ?? null;
}

/** The one-line Linux install command, built from the manifest's script address. */
export function installCommand(manifest: ServerManifest | null): string | null {
  return manifest?.installScript ? `curl -fsSL ${manifest.installScript.replace(/\/$/, "")} | sh` : null;
}

/** 734003200 → "700 MB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "2026-11-25T10:00:00Z" → "November 25, 2026". */
export function formatReleaseDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Reads the manifest (cached for SERVER_MANIFEST_REVALIDATE); null when it can't be had in a few seconds. */
export async function fetchServerManifest(fetcher: typeof fetch = fetch): Promise<ServerManifest | null> {
  const url = process.env.FOLEVI_SERVER_MANIFEST_URL || SERVER_MANIFEST_URL;
  try {
    const response = await fetcher(url, {
      next: { revalidate: SERVER_MANIFEST_REVALIDATE },
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" },
    } as RequestInit);
    if (!response.ok) return null;
    return parseServerManifest(await response.json());
  } catch {
    return null;
  }
}
