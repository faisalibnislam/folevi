import type { NextConfig } from "next";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const convexSite = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
const auth0 = process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}` : "";
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
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${origin(convexSite)} https:`,
  "font-src 'self'",
  `connect-src 'self' ${convexOrigin} ${convexWs} ${origin(convexSite)} ${auth0}${isDev ? " ws://localhost:* ws://127.0.0.1:* http://127.0.0.1:*" : ""}`,
  `frame-src ${origin(convexSite)}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${appOrigin} ${auth0}`,
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
        source: "/:path(d|documents|tasks|calendar|daily|settings|admin|s|api|shared|templates|starred|archive|trash|folders|tags|onboarding|invite)/:rest*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      { source: "/s/:token*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }, { key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
