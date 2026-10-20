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
  // Embed blocks (EMBED_FRAME_ORIGINS in packages/editor-schema/src/embeds.ts).
  `frame-src ${origin(convexSite)} https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://www.figma.com https://maps.google.com`,
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

// FOLEVI_BUILD=shell: the app shell the Mac, iPhone and iPad apps carry built in (docs/LOCAL_MODE_PLAN.md §1):
// a static export of src/app/*.shell.tsx only, so every page.tsx, layout.tsx, route.ts and proxy.ts (admin,
// marketing, /api, share pages, auth pages) is left out. Static export has no headers or redirects.
const isShell = process.env.FOLEVI_BUILD === "shell";
const shellConfig: NextConfig = {
  pageExtensions: ["shell.tsx", "shell.ts"],
  images: { unoptimized: true },
  ...(isDev
    ? {
        // `pnpm dev:shell` (local-mode e2e, trying the shell in a browser): the same pages under `next dev`, in
        // their own build folder, with the hosts' SPA fallback as a rewrite (every path but /api/* gets the one
        // page; Next's own files are matched before fallback rewrites).
        distDir: process.env.NEXT_DIST_DIR ?? ".next-shell",
        rewrites: async () => ({ beforeFiles: [], afterFiles: [], fallback: [{ source: "/:path((?!api/).*)", destination: "/" }] }),
      }
    : {
        output: "export",
        distDir: process.env.NEXT_DIST_DIR ?? "out-shell",
        // tsc --noEmit checks the same files; the shell build doesn't need to again.
        typescript: { ignoreBuildErrors: true },
      }),
};

const nextConfig: NextConfig = {
  // A second local dev server (another port) needs its own build folder.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  ...(isShell ? shellConfig : {}),
  env: { NEXT_PUBLIC_CONVEX_SITE_URL: convexSite, ...(isShell ? { NEXT_PUBLIC_FOLEVI_SHELL: "1" } : {}) },
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev only: keep Next's badge out of the tab strip (top right) and the sidebar's account button (bottom left).
  devIndicators: { position: "bottom-right" },
  transpilePackages: ["@folevi/editor-schema", "@folevi/design-tokens", "@folevi/local-store"],
  typedRoutes: false,
  allowedDevOrigins: ["app.localhost", "localhost", "127.0.0.1"],
  experimental: {
    externalDir: true,
  },
  ...(isShell ? {} : { redirects, headers }),
};

async function redirects() {
  return [
    // Note styles were renamed note themes; old links keep working.
    { source: "/features/note-styles", destination: "/features/note-themes", permanent: true },
    // The Foli page became the Foli AI page.
    { source: "/foli", destination: "/foli-ai", permanent: true },
  ];
}

async function headers() {
  return [
    { source: "/:path*", headers: securityHeaders },
    {
      // Authenticated surfaces and share pages are never cached by shared caches.
      source: "/:path(d|ai|graph|documents|notes|tasks|calendar|review|changes|daily|settings|admin|s|api|shared|templates|starred|archive|trash|drafts|unsorted|folders|tags|onboarding|invite|share-invite|share|share-target)/:rest*",
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
}

export default nextConfig;
