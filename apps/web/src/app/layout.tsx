import { Tooltips } from "@/components/ui/Tooltips";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript";
import { SIGNED_IN_CHECK_SCRIPT } from "@/lib/auth/signedInCheck";
// Type (./fonts.ts, self-hosted by next/font): Instrument Sans for the UI, Spectral for titles and larger
// text, and the note themes' typefaces.
import { fontVariables } from "./fonts";
import { connection } from "next/server";
import { isServerEdition } from "@/lib/edition";
import { runtimeConfig } from "@/lib/runtime/config";
import { serverInfoCore } from "@/lib/server-edition/serverInfo";
import { RuntimeConfigProvider } from "@/components/runtime/RuntimeConfigProvider";

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";

const metadata: Metadata = {
  metadataBase: new URL(marketingUrl),
  title: { default: "Folevi: a quiet notes app for ideas that keep growing", template: "%s · Folevi" },
  description:
    "Folevi is a notes and writing workspace for the web, Mac, Windows, Linux, iPhone and iPad: block documents, nested pages, tasks, calendar, offline editing and real-time sync.",
  applicationName: "Folevi",
  manifest: "/manifest.webmanifest",
  // The app icon (packages/design-tokens/scripts/app-icon.mjs).
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  formatDetection: { telephone: false, email: false, address: false },
};

// Folevi Cloud: the metadata above, as it always was. Folevi Server: its own address and name, read at run time
// (the server has no marketing site, and its address can change without a rebuild).
export async function generateMetadata(): Promise<Metadata> {
  if (!isServerEdition()) return metadata;
  const info = await serverInfoCore();
  const name = info?.name?.trim();
  return {
    ...metadata,
    metadataBase: new URL(runtimeConfig().appUrl),
    title: { default: name ? `${name} · Folevi` : "Folevi", template: "%s · Folevi" },
    description: "Folevi on your own server.",
    robots: { index: false, follow: false },
  };
}

/** Server edition: the runtime addresses and what the owner turned on, for the browser (lib/runtime/config.ts). */
async function ServerRuntime({ children }: { children: React.ReactNode }) {
  // Every page reads the environment on each request, never at build time.
  await connection();
  const info = await serverInfoCore();
  const value = { ...runtimeConfig(), features: info?.features ?? null, serverName: info?.name ?? null };
  return <RuntimeConfigProvider value={value}>{children}</RuntimeConfigProvider>;
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF6F3" },
    { media: "(prefers-color-scheme: dark)", color: "#15110F" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* folevi.com/ opens your notes when this browser is signed in, even without the hint cookie. */}
        <script dangerouslySetInnerHTML={{ __html: SIGNED_IN_CHECK_SCRIPT }} />
      </head>
      <body>
        {isServerEdition() ? (
          <ServerRuntime>
            {children}
            <Tooltips />
          </ServerRuntime>
        ) : (
          <>
            {children}
            <Tooltips />
          </>
        )}
      </body>
    </html>
  );
}
