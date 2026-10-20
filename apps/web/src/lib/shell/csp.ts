// The bundled shell's Content Security Policy, delivered as a <meta> tag by src/app/layout.shell.tsx (a static
// export can't send headers). It is the website's policy (lib/security/csp.ts, static form) adjusted for a page
// that lives on app://folevi or capacitor://localhost:
// - `folevi-file:` for a local library's attachments on iOS (app://folevi/_files is 'self' on the Mac);
// - no frame-ancestors, sandbox or report directives, which browsers ignore in a meta tag (the hosts never
//   frame the page anyway), and no manifest-src (the shell has no web manifest);
// - no upgrade-insecure-requests: it would rewrite nothing useful and the dev shell talks to http://127.0.0.1.
// In local mode the Mac host also sends `connect-src 'self'` as a header (docs/LOCAL_MODE.md S2): both policies
// apply, so the header narrows this one. This is the account-mode ceiling.
import { EMBED_FRAME_ORIGINS } from "@folevi/editor-schema";
import { origin } from "@/lib/security/csp";

export interface ShellCspOptions {
  convexUrl: string;
  convexSiteUrl: string;
  /** `next dev` with FOLEVI_BUILD=shell: React's dev tools need eval, and HMR a local WebSocket. */
  dev: boolean;
}

export function shellContentSecurityPolicy(opts: ShellCspOptions): string {
  const convex = origin(opts.convexUrl);
  const convexWs = convex.replace(/^http/, "ws");
  const site = origin(opts.convexSiteUrl);
  return [
    "default-src 'self'",
    // Next's inline bootstrap scripts carry no nonce in a static export.
    `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: folevi-file: ${site} https:`,
    `media-src 'self' blob: folevi-file: ${site}`,
    "font-src 'self'",
    `connect-src 'self' folevi-file: ${convex} ${convexWs} ${site}${opts.dev ? " ws://localhost:* ws://127.0.0.1:* http://127.0.0.1:*" : ""}`,
    `frame-src ${site} ${EMBED_FRAME_ORIGINS.join(" ")}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ]
    .map((d) => d.replace(/\s+/g, " ").trim())
    .join("; ");
}
