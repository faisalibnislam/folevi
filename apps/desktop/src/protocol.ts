// The bundled interface's origin, app://folevi (docs/LOCAL_MODE_PLAN.md §1 and §4.2, WP2; proven in spike S2):
// a privileged scheme on the persist:folevi session that serves the static export built into the app
// (Contents/Resources/web, from apps/web `build:shell`), with
// - the SPA fallback: any path that isn't a file gets index.html, and the client router takes it from there;
// - a Content-Security-Policy header chosen by the mode (local: nothing but the app itself; account: Folevi
//   and Convex), which narrows the export's own meta policy (both apply);
// - /_files/<sha256>: a local library's attachments, through a pluggable reader (the library layer comes in
//   WP9), with Range for audio and video, nosniff and a sandboxing policy of their own;
// - /_folevi-handoff: a blank page for the one-time IndexedDB handoff (handoff.ts).
// The handler itself is plain Request -> Response, so shell.test.ts drives it without Electron.
import { stat, readFile, realpath } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { ShellMode } from "./settings";

export const APP_SCHEME = "app";
export const APP_HOST = "folevi";

/** Privileges for app://: called before `ready` (main.ts). standard + secure give it a real origin. */
export const APP_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } as const;

/** The path the one-time handoff's hidden window opens on both origins (handoff.ts). */
export const HANDOFF_PATH = "/_folevi-handoff";
export const HANDOFF_PAGE = "<!doctype html><meta charset=utf-8><title>Folevi</title>";
/** The handoff page runs nothing of its own: main injects the kit with executeJavaScript. */
export const HANDOFF_CSP = "default-src 'none'";

// ---------------------------------------------------------------- the content security policy

export interface CspOptions {
  /** Folevi's website (SERVICE_URL): signed-in mode talks to its /api/auth. */
  serviceOrigin: string;
  /** More origins signed-in mode may connect to (FOLEVI_SHELL_CONNECT, e.g. a local Convex backend). */
  extraConnect?: readonly string[];
}

/**
 * The header policy for the bundled interface's pages. Local mode (and the first-launch choice, "unset",
 * which needs no network) can reach nothing but app://folevi itself; signed-in mode adds Folevi's website
 * and Convex (any deployment: the export's meta policy names the exact one). Images and embeds from the web
 * stay allowed in both: they're the person's own content. In local mode the session also cancels every
 * request to Folevi and Convex hosts (localModeBlock below), whatever a policy says.
 */
export function shellCsp(mode: ShellMode, o: CspOptions): string {
  const account = mode === "account";
  const connect = account ? ["'self'", o.serviceOrigin, "https://*.convex.cloud", "wss://*.convex.cloud", "https://*.convex.site", ...(o.extraConnect ?? [])] : ["'self'"];
  return [
    "default-src 'self'",
    // Next's inline bootstrap scripts carry no nonce in a static export.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `media-src 'self' blob:${account ? " https:" : ""}`,
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    "frame-src https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Attachments: shown, played or downloaded, never run (an HTML or SVG file opened directly stays inert). */
export const FILES_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

// ---------------------------------------------------------------- the library's attachments

/** One attachment in the library, by the SHA-256 of its (decrypted) bytes. */
export interface LibraryFileInfo {
  size: number;
  /** As stored with it; null when unknown (the request's ?type= is used then, if it's a safe one). */
  mime: string | null;
}

/**
 * The library layer's side of /_files (WP9 implements it over the library folder, decrypting STREAM chunks).
 * `read` returns bytes `start` to `end`, both inclusive.
 */
export interface LibraryFiles {
  stat(sha256: string): Promise<LibraryFileInfo | null>;
  read(sha256: string, start: number, end: number): Promise<Uint8Array | ReadableStream<Uint8Array>>;
}

/** Until the library layer lands: no attachments (every /_files request is a 404). */
export const NO_LIBRARY_FILES: LibraryFiles = {
  stat: async () => null,
  read: async () => {
    throw new Error("Folevi for Mac has no library layer yet (WP9).");
  },
};

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Types an attachment may be served as. Anything else (text/html, image/svg+xml, scripts) goes out as
 * application/octet-stream: the response is on the app's own origin, and nosniff plus the sandbox policy
 * keep it from ever running.
 */
const SAFE_FILE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|heic|heif|bmp|tiff)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf|text\/plain|text\/csv|text\/markdown|application\/json)$/;

export function safeFileType(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const type = (c ?? "").split(";")[0]!.trim().toLowerCase();
    if (SAFE_FILE_TYPES.test(type)) return type;
  }
  return "application/octet-stream";
}

// ---------------------------------------------------------------- ranges

/**
 * A Range header against a size: the bytes to send (inclusive), "unsatisfiable", or null to send the whole
 * thing (no header, or one we don't serve, like several ranges).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // The last N bytes.
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

// ---------------------------------------------------------------- the handler

export interface AppHandlerOptions {
  /** The static export's folder. */
  root: string;
  /** The current mode (changes when the person chooses; main reloads the windows then). */
  mode: () => ShellMode;
  csp: CspOptions;
  files?: LibraryFiles;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", ...headers } });

/**
 * A request path as a list of safe segments, or null: undecodable escapes, "." or ".." segments, backslashes,
 * NUL or control characters, and empty segments in the middle are all refused (no way out of the folder,
 * whatever the encoding).
 */
export function safeSegments(pathname: string): string[] | null {
  if (!pathname.startsWith("/")) return null;
  const raw = pathname.slice(1).split("/");
  // A trailing slash ("/settings/") is the same page.
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
  if (raw.length === 1 && raw[0] === "") return [];
  const out: string[] = [];
  for (const part of raw) {
    let seg: string;
    try {
      seg = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (!seg || seg === "." || seg === ".." || /[\u0000-\u001f\u007f\\/]/.test(seg) || seg.length > 255) return null;
    out.push(seg);
  }
  return out;
}

async function isFile(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

async function bytesResponse(bytes: Uint8Array, request: Request, headers: Record<string, string>): Promise<Response> {
  const size = bytes.byteLength;
  const range = parseRange(request.headers.get("range"), size);
  const base = { "accept-ranges": "bytes", "x-content-type-options": "nosniff", ...headers };
  const head = request.method === "HEAD";
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  if (range) {
    const part = bytes.subarray(range.start, range.end + 1);
    return new Response(head ? null : (part as BodyInit), {
      status: 206,
      headers: { ...base, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(part.byteLength) },
    });
  }
  return new Response(head ? null : (bytes as BodyInit), { status: 200, headers: { ...base, "content-length": String(size) } });
}

/** The app:// handler (protocol.handle on the persist:folevi session). */
export function createAppHandler(o: AppHandlerOptions): (request: Request) => Promise<Response> {
  const root = resolve(o.root);
  const files = o.files ?? NO_LIBRARY_FILES;
  let realRoot: string | null = null;
  const pageHeaders = () => ({ "content-security-policy": shellCsp(o.mode(), o.csp), "cache-control": "no-cache" });

  async function serveStatic(segments: string[], request: Request): Promise<Response | null> {
    const file = join(root, ...segments);
    // join() can't climb out after safeSegments, but a symlink inside the export could: checked for real.
    if (file !== root && !file.startsWith(root + sep)) return null;
    const size = await isFile(file);
    if (size === null) return null;
    realRoot ??= await realpath(root).catch(() => root);
    const real = await realpath(file).catch(() => null);
    if (!real || !real.startsWith(realRoot + sep)) return null;
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers: Record<string, string> = { "content-type": type };
    if (type.startsWith("text/html")) Object.assign(headers, pageHeaders());
    // Next's hashed assets never change under the same name.
    else if (segments[0] === "_next" && segments[1] === "static") headers["cache-control"] = "public, max-age=31536000, immutable";
    return bytesResponse(await readFile(file), request, headers);
  }

  async function serveLibraryFile(sha: string, request: Request, url: URL): Promise<Response> {
    if (!SHA256.test(sha)) return text(400, "Bad file name");
    const info = await files.stat(sha).catch(() => null);
    if (!info) return text(404, "Not found");
    const headers = {
      "content-type": safeFileType(info.mime, url.searchParams.get("type")),
      "content-security-policy": FILES_CSP,
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "private, max-age=31536000, immutable",
    };
    const size = info.size;
    const range = parseRange(request.headers.get("range"), size);
    const base = { "accept-ranges": "bytes", "x-content-type-options": "nosniff", ...headers };
    if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const head = request.method === "HEAD";
    const body = head || size === 0 ? null : await files.read(sha, start, end);
    return new Response(body as BodyInit | null, {
      status: range ? 206 : 200,
      headers: { ...base, "content-length": String(end - start + 1), ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) },
    });
  }

  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return text(400, "Bad address");
    }
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return text(404, "Not found");
    if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method not allowed", { allow: "GET, HEAD" });
    const segments = safeSegments(url.pathname);
    if (!segments) return text(400, "Bad path");

    if (segments[0] === "_files") {
      if (segments.length !== 2) return text(404, "Not found");
      return serveLibraryFile(segments[1]!, request, url);
    }
    if (url.pathname === HANDOFF_PATH) {
      return new Response(request.method === "HEAD" ? null : HANDOFF_PAGE, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": HANDOFF_CSP, "x-content-type-options": "nosniff", "cache-control": "no-store" },
      });
    }

    const file = segments.length ? await serveStatic(segments, request) : null;
    if (file) return file;
    // Missing assets stay missing (index.html in place of a script would only confuse), and the website's
    // server routes don't exist here.
    const last = segments[segments.length - 1] ?? "";
    if (segments[0] === "_next" || segments[0] === "api" || /\.[A-Za-z0-9]{1,8}$/.test(last)) return text(404, "Not found");
    // The SPA fallback: index.html for "/" and every app path.
    const index = await serveStatic(["index.html"], request);
    return index ?? text(503, "The interface built into Folevi is missing. Reinstall Folevi.");
  };
}

// ---------------------------------------------------------------- local mode: never contacting Folevi

/** Hosts local mode never talks to: Folevi's own and Convex's (its backend). */
const BLOCKED_HOSTS = [/(^|\.)folevi\.com$/i, /\.convex\.cloud$/i, /\.convex\.site$/i];

/**
 * Whether local mode cancels a request: anything to Folevi or Convex, over any scheme, plus the website the
 * app was pointed at (SERVICE_URL, a development server in tests).
 */
export function isBlockedInLocalMode(raw: string, serviceHost: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  return host === serviceHost.toLowerCase() || BLOCKED_HOSTS.some((re) => re.test(host));
}

/** The webRequest filter for the block (the listener checks each request with isBlockedInLocalMode too). */
export function localModeBlockPatterns(serviceHost: string): string[] {
  const hosts = ["folevi.com", "*.folevi.com", "*.convex.cloud", "*.convex.site", serviceHost];
  return [...new Set(hosts)].flatMap((h) => ["http", "https", "ws", "wss"].map((s) => `${s}://${h}/*`));
}

/** Directory of the export: the app's Resources/web, or for a development run FOLEVI_SHELL_DIR or apps/desktop/web. */
export function shellRoot(o: { packaged: boolean; resourcesPath: string; appDir: string; env: NodeJS.ProcessEnv }): string {
  if (o.packaged) return join(o.resourcesPath, "web");
  if (o.env.FOLEVI_SHELL_DIR) return resolve(o.env.FOLEVI_SHELL_DIR);
  return join(o.appDir, "web");
}
