// Folevi for iPhone and iPad: a Capacitor shell that loads the web app (https://app.folevi.com) in a
// WKWebView, like the Mac app's Electron window. The site's own service worker caches the shell for offline
// use; App-Bound Domains (Info.plist WKAppBoundDomains) are what let a service worker run in WKWebView.
// FOLEVI_URL points the app at the local dev server for the Simulator: FOLEVI_URL=http://app.localhost:3002 npx cap sync ios
import type { CapacitorConfig } from "@capacitor/cli";

const url = new URL(process.env.FOLEVI_URL ?? "https://app.folevi.com");
const dev = url.protocol === "http:";

const config: CapacitorConfig = {
  appId: "com.folevi.ios",
  appName: "Folevi",
  // Only the offline page lives in the app; everything else comes from the site.
  webDir: "www",
  server: {
    // Straight to the app's start page (the site's "/" is a server redirect to it): the service worker
    // keeps app pages like /documents for offline launches, not that redirect.
    url: `${url.origin}/documents`,
    // Plain http only for the local dev server (the Debug build also lets App Transport Security allow it).
    cleartext: dev,
    // Shown when neither the network nor the service worker's cache has the page (first launch offline).
    errorPath: "offline.html",
  },
  ios: {
    // The page lays itself out under the status bar and home indicator (viewport-fit=cover, safe-area insets).
    contentInset: "never",
    // WKAppBoundDomains in Info.plist: service workers, and the bridge only on Folevi's own pages.
    limitsNavigationsToAppBoundDomains: true,
    // iPad gets the desktop layout (and its keyboard shortcuts); iPhone the phone one.
    preferredContentMode: "recommended",
    allowsLinkPreview: false,
    appendUserAgent: "FoleviiOS/1.0",
  },
  plugins: {
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
