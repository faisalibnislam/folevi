// Content Security Policy for Folevi web. Shared by next.config.ts (static header for every route)
// and the request proxy (per-request nonce policy for dynamically rendered app routes).
//
// With a nonce, `script-src` drops 'unsafe-inline': only scripts carrying the per-request nonce (Next.js
// adds it to its own scripts automatically when it finds `'nonce-…'` in the request's CSP header) and
// scripts they load ('strict-dynamic') can run. Without a nonce (statically prerendered pages, where no
// per-request value exists) the policy keeps 'unsafe-inline' for Next's inline bootstrap scripts.

export interface CspOptions {
  /** Base64 nonce for this request; omit for the static policy. */
  nonce?: string;
  dev: boolean;
  convexUrl: string;
  convexSiteUrl: string;
  appUrl: string;
  /** Hash sources (`'sha256-…'`) for known inline scripts rendered without a nonce. */
  scriptHashes?: string[];
  /** Extra origins allowed for connect-src/form-action (none today; sign-in is served by the app itself). */
  extraOrigins?: string[];
}

export function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** A fresh, unguessable nonce (16 random bytes, base64). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildContentSecurityPolicy(opts: CspOptions): string {
  const convex = origin(opts.convexUrl);
  const convexWs = convex.replace(/^http/, "ws");
  const site = origin(opts.convexSiteUrl);
  const app = origin(opts.appUrl);
  const extra = (opts.extraOrigins ?? []).map(origin).filter(Boolean).join(" ");
  const scriptSrc = opts.nonce
    ? `script-src 'self' 'nonce-${opts.nonce}' ${(opts.scriptHashes ?? []).join(" ")} 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`
    : `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    scriptSrc,
    // Inline style attributes are used throughout the UI (CSS variables per document), so styles stay
    // 'unsafe-inline'; styles cannot execute script.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${site} https:`,
    // Audio recordings: blob: while one waits to upload, then signed file URLs.
    `media-src 'self' blob: ${site}`,
    "font-src 'self'",
    `connect-src 'self' ${convex} ${convexWs} ${site} ${extra}${opts.dev ? " ws://localhost:* ws://127.0.0.1:* http://127.0.0.1:*" : ""}`,
    `frame-src ${site}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self' ${app} ${extra}`,
    "object-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(opts.dev ? [] : ["upgrade-insecure-requests"]),
  ]
    .map((d) => d.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ");
}
