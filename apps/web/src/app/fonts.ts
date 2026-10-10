import { Andika, DM_Sans, Figtree, Fraunces, IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Sans, Inter, JetBrains_Mono, Lora, Mali, Newsreader, Nunito, Plus_Jakarta_Sans, Roboto_Mono, Rubik, Source_Code_Pro, Source_Serif_4, Space_Mono, Spectral } from "next/font/google";

// Every typeface the site uses, self-hosted by next/font (no requests go to Google). Instrument Sans is the
// app's own (UI and body text) and the only one preloaded. The rest are the note themes' typefaces
// (FONT_POOL in convex/lib/themes.ts): regular, bold and italic each, and a browser downloads a face only
// when a note on screen uses it. The Mac app loads this site, so it gets the same fonts.

const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans", display: "swap" });

// Modern
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-dm-sans" });
const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-plus-jakarta-sans" });
const figtree = Figtree({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-figtree" });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-ibm-plex-sans" });
// Serif (Spectral is also the app's display face: titles and larger text)
const spectral = Spectral({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], weight: ["400", "500", "600", "700"], variable: "--font-spectral" });
const newsreader = Newsreader({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-newsreader" });
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-fraunces" });
const lora = Lora({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-lora" });
const sourceSerif4 = Source_Serif_4({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-source-serif-4" });
// Mono
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-jetbrains-mono" });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], weight: ["400", "500", "600", "700"], variable: "--font-ibm-plex-mono" });
const sourceCodePro = Source_Code_Pro({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-source-code-pro" });
const robotoMono = Roboto_Mono({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-roboto-mono" });
const spaceMono = Space_Mono({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], weight: ["400", "700"], variable: "--font-space-mono" });
// Soft
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-nunito" });
const rubik = Rubik({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--font-rubik" });
const andika = Andika({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], weight: ["400", "700"], variable: "--font-andika" });
const mali = Mali({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], weight: ["400", "500", "600", "700"], variable: "--font-mali" });

/** The class names that define every --font-* variable, for <html>. */
export const fontVariables = [
  instrumentSans,
  inter,
  dmSans,
  plusJakartaSans,
  figtree,
  ibmPlexSans,
  spectral,
  newsreader,
  fraunces,
  lora,
  sourceSerif4,
  jetbrainsMono,
  ibmPlexMono,
  sourceCodePro,
  robotoMono,
  spaceMono,
  nunito,
  rubik,
  andika,
  mali,
]
  .map((f) => f.variable)
  .join(" ");
