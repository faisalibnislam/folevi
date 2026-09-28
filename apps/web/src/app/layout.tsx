import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono, Spectral } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/bootScript";

// Type: Instrument Sans for body text and UI; Spectral for titles and larger text (self-hosted by
// next/font, so no third-party requests). The Mac app should bundle the same families when it follows.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans", display: "swap" });
const spectral = Spectral({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-spectral", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-jetbrains-mono", display: "swap" });

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";

export const metadata: Metadata = {
  metadataBase: new URL(marketingUrl),
  title: { default: "Folevi — a quieter place for ideas that keep growing", template: "%s · Folevi" },
  description:
    "Folevi is a calm writing and notes workspace for the web and a fully native Mac app: block documents, nested pages, tasks, calendar, offline editing and real-time sync.",
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
