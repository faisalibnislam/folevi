// Folevi for iPhone and iPad: a Capacitor shell around the web app, like the Mac app's Electron window.
//
// By default the app carries the interface built in (docs/LOCAL_MODE_PLAN.md §1): the web app's static shell
// export (`pnpm shell`, copied into web/), served from capacitor://localhost, so both modes start offline and
// "Keep notes on my devices" never needs Folevi's servers. Signed in, the page talks to Folevi through the app
// (Native/Shell/ShellAuth.swift, bearer sign-in) and Convex directly.
//
// For development:
//   FOLEVI_SHELL_URL=http://localhost:3003 npx cap sync ios   the built-in interface from `next dev` (dev:shell),
//                                                            signed in against FOLEVI_SERVICE_URL (default the
//                                                            dev server, http://app.localhost:3002)
//   FOLEVI_URL=http://app.localhost:3002 npx cap sync ios     the website in the app, as before the built-in interface
import type { CapacitorConfig } from "@capacitor/cli";

const shellDev = process.env.FOLEVI_SHELL_URL ? new URL(process.env.FOLEVI_SHELL_URL) : null;
const website = !shellDev && process.env.FOLEVI_URL ? new URL(process.env.FOLEVI_URL) : null;
const bundled = website === null;
// Where sign-in and /api/auth live for the built-in interface.
const service = new URL(process.env.FOLEVI_SERVICE_URL ?? (shellDev ? "http://app.localhost:3002" : "https://app.folevi.com"));
const dev = (shellDev ?? website)?.protocol === "http:";

const config: CapacitorConfig = {
  appId: "com.folevi.ios",
  appName: "Folevi",
  // The built-in interface (the shell export, `pnpm shell` writes web/, git-ignored), or only the offline page
  // (www/) when the app shows the website.
  webDir: bundled && !shellDev ? "web" : "www",
  server: shellDev
    ? { url: shellDev.origin, cleartext: true }
    : website
      ? {
          // Straight to the app's start page (the site's "/" is a server redirect to it): the service worker
          // keeps app pages like /documents for offline launches, not that redirect.
          url: `${website.origin}/documents`,
          cleartext: dev,
          // Shown when neither the network nor the service worker's cache has the page (first launch offline).
          errorPath: "offline.html",
        }
      : {},
  ios: {
    // The page lays itself out under the status bar and home indicator (viewport-fit=cover, safe-area insets).
    contentInset: "never",
    // WKAppBoundDomains in Info.plist: the bridge only on the app's own pages (and service workers for the website).
    limitsNavigationsToAppBoundDomains: true,
    // iPad gets the desktop layout (and its keyboard shortcuts); iPhone the phone one.
    preferredContentMode: "recommended",
    allowsLinkPreview: false,
    appendUserAgent: "FoleviiOS/1.0",
    // Notifications are the app's own (Native/PushNotifications.swift is the notification center's
    // delegate from launch), not Capacitor's router, which would take them and show nothing in front.
    handleApplicationNotifications: false,
  },
  plugins: {
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
    // Native/Shell: `window.foleviShell` for the built-in interface, and where it signs in.
    // Sync with Dropbox and Google Drive: public client ids from the build (FOLEVI_DROPBOX_APP_KEY and
    // FOLEVI_GOOGLE_IOS_CLIENT_ID, never the repository); a provider without one isn't offered.
    FoleviShell: { bundled, serviceUrl: service.origin, dropboxAppKey: process.env.FOLEVI_DROPBOX_APP_KEY ?? "", googleClientId: process.env.FOLEVI_GOOGLE_IOS_CLIENT_ID ?? "" },
  },
};

export default config;
