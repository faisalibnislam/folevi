// The root layout of the bundled app shell (FOLEVI_BUILD=shell, docs/LOCAL_MODE_PLAN.md §1). Only the shell
// build reads *.shell.tsx files (pageExtensions in next.config.ts); the website never sees this file.
import { Tooltips } from "@/components/ui/Tooltips";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript";
import { shellContentSecurityPolicy } from "@/lib/shell/csp";
import { fontVariables } from "./fonts";

// Baked in at build time, like every NEXT_PUBLIC_* value in the shell.
const csp = shellContentSecurityPolicy({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "",
  dev: process.env.NODE_ENV !== "production",
});

export const metadata: Metadata = { title: "Folevi", applicationName: "Folevi" };
// Next writes its own viewport meta, so the shell's goes through this rather than a second tag.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF6F3" },
    { media: "(prefers-color-scheme: dark)", color: "#15110F" },
  ],
};

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Tooltips />
      </body>
    </html>
  );
}
