import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono, Spectral } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript";

// Type: Instrument Sans for body text and UI; Spectral for titles and larger text (self-hosted by
// next/font, so no third-party requests). The Mac app loads this site, so it uses the same fonts.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans", display: "swap" });
// Only the body font is preloaded. Spectral (8 faces) and the mono font load when a page uses them, so a
// page fetches just the faces it shows and they don't compete with the first image on slow connections.
const spectral = Spectral({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-spectral", display: "swap", preload: false });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-jetbrains-mono", display: "swap", preload: false });

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
    <html lang="en" className={`${instrumentSans.variable} ${spectral.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
