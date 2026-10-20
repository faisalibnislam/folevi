// The root layout of the bundled app shell (FOLEVI_BUILD=shell, docs/LOCAL_MODE_PLAN.md §1). Only the shell
// build reads *.shell.tsx files (pageExtensions in next.config.ts); the website never sees this file.
// SPIKE S1: the CSP below is the spike's; WP1 derives it from the build's Convex and service URLs.
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript";
import { fontVariables } from "./fonts";

const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const convexSite = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: folevi-file:`,
  `media-src 'self' blob: folevi-file:`,
  "font-src 'self'",
  `connect-src 'self' ${origin(convex)} ${origin(convex).replace(/^http/, "ws")} ${origin(convexSite)} folevi-file:`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export const metadata = { title: "Folevi" };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "light dark" };

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
