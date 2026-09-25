import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });

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
    { media: "(prefers-color-scheme: light)", color: "#F4F1E9" },
    { media: "(prefers-color-scheme: dark)", color: "#101411" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

// Applies the saved appearance before first paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem("folevi:appearance");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}else if(window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.dataset.theme="dark";}else{document.documentElement.dataset.theme="light";}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
