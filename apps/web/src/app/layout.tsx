import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript";
// Type (./fonts.ts, self-hosted by next/font): Instrument Sans for the UI, Spectral for titles and larger
// text, and the note themes' typefaces.
import { fontVariables } from "./fonts";

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";

export const metadata: Metadata = {
  metadataBase: new URL(marketingUrl),
  title: { default: "Folevi: a quiet notes app for ideas that keep growing", template: "%s · Folevi" },
  description:
    "Folevi is a calm writing and notes workspace for the web, with a Mac app coming soon: block documents, nested pages, tasks, calendar, offline editing and real-time sync.",
  applicationName: "Folevi",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: "/apple-icon.png" },
  formatDetection: { telephone: false, email: false, address: false },
};

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
      </head>
      <body>{children}</body>
    </html>
  );
}
