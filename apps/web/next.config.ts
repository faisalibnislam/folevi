import type { NextConfig } from "next";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
// HTTP actions live on *.convex.site; derive it from the deployment URL when not set explicitly.
const convexSite = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? convexUrl.replace(".convex.cloud", ".convex.site");
const isDev = process.env.NODE_ENV !== "production";
const appOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com").origin;
  } catch {
    return "";
  }
})();

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const convexOrigin = origin(convexUrl);
const convexWs = convexOrigin.replace(/^http/, "ws");

// Content Security Policy: no third-party scripts; Convex (https + websocket) and signed file URLs only.
// This is the static policy (no per-request nonce exists for prerendered pages). It must stay identical
// to buildContentSecurityPolicy() without a nonce in src/lib/security/csp.ts, which the request proxy
// uses for the nonce-based policy; test/csp.test.ts enforces that. (next.config.ts is loaded outside the
// app bundler, so it can't import that module.)
export const staticCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${origin(convexSite)} https:`,
  `media-src 'self' blob: ${origin(convexSite)}`,
  "font-src 'self'",
  `connect-src 'self' ${convexOrigin} ${convexWs} ${origin(convexSite)}${isDev ? " ws://localhost:* ws://127.0.0.1:* http://127.0.0.1:*" : ""}`,
  `frame-src ${origin(convexSite)}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${appOrigin}`,
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: staticCsp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // A second local dev server (another port) needs its own build folder.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  env: { NEXT_PUBLIC_CONVEX_SITE_URL: convexSite },
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev only: keep Next's badge out of the tab strip (top right) and the sidebar's account button (bottom left).
  devIndicators: { position: "bottom-right" },
  transpilePackages: ["@folevi/editor-schema", "@folevi/design-tokens"],
  typedRoutes: false,
  allowedDevOrigins: ["app.localhost", "localhost", "127.0.0.1"],
  experimental: {
    externalDir: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Authenticated surfaces and share pages are never cached by shared caches.
        source: "/:path(d|documents|notes|tasks|calendar|daily|settings|admin|s|api|shared|templates|starred|archive|trash|drafts|unsorted|folders|tags|onboarding|invite|share-invite)/:rest*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      // Share pages set robots per link (noindex unless the owner allowed indexing) in their metadata.
      { source: "/s/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      // Artwork, brand marks and icons: cached for a week (they were revalidated on every visit). Not
      // immutable, as the files keep their names when they're replaced.
      {
        source: "/:dir(covers|marketing|brand|icons)/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      { source: "/:file(icon.svg|apple-icon.png)", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
  },
};

export default nextConfig;
