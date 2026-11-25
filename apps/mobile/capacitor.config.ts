// Folevi for iPhone, iPad, iPhone Duo and Android (docs/MOBILE.md): one Capacitor app around the interface built
// into it (the web app's static shell export, `pnpm shell` writes web/, git-ignored). The page is the same web app
// as everywhere else; it picks the phone layout or the sidebar layout by the window's width (lib/iphone.ts), so an
// iPad, an unfolded iPhone Duo or an Android tablet gets the sidebar and a phone, a folded Duo or a narrow window
// the phone layout with its bottom bar.
//
// The native side is small: Capacitor's own plugins (haptics, status bar, keyboard, links, share, push, app
// events) and Folevi's plugins for what has no stock plugin (the library on the device, sign-in and the session in
// the Keychain or Keystore, the share extension's inbox, the Face ID or fingerprint lock). The page reaches all of
// them through window.foleviNative and window.foleviShell (bridge/mobile-bridge.js), the same contract the Mac
// app answers.
//
// iOS keeps the identity of the iPhone and iPad app (com.folevi.ios, capacitor://localhost, its App Group and
// Keychain group) and Android the Android app's (com.folevi.android, https://localhost), so the app updates in
// place over them.
import type { CapacitorConfig } from "@capacitor/cli";

/** Where signing in and /api/auth live. FOLEVI_SERVICE_URL=http://app.localhost:3002 for the dev server. */
const service = new URL(process.env.FOLEVI_SERVICE_URL ?? "https://app.folevi.com");
/** Development: the shell from `next dev` (FOLEVI_BUILD=shell, port 3003) instead of the export in web/. */
const shellDev = process.env.FOLEVI_SHELL_URL ? new URL(process.env.FOLEVI_SHELL_URL) : null;
const release = process.env.FOLEVI_RELEASE === "1";

const config: CapacitorConfig = {
  appId: "com.folevi.ios",
  appName: "Folevi",
  webDir: "web",
  server: {
    ...(shellDev ? { url: shellDev.origin, cleartext: true } : {}),
    iosScheme: "capacitor",
    androidScheme: "https",
    hostname: "localhost",
  },
  ios: {
    // The page lays itself out under the status bar and the home indicator (viewport-fit=cover, safe areas).
    contentInset: "never",
    // An iPad asks for the desktop site, so the page sees a Mac with a touch screen and takes the sidebar layout.
    preferredContentMode: "recommended",
    allowsLinkPreview: false,
    appendUserAgent: "FoleviiOS/2.0",
    // Notifications go to the app's own delegate (FoleviPush.swift), so a reminder shows while the app is open.
    handleApplicationNotifications: false,
    webContentsDebuggingEnabled: !release,
  },
  android: {
    webContentsDebuggingEnabled: !release,
    allowMixedContent: false,
    captureInput: false,
    appendUserAgent: "FoleviAndroid/2.0",
  },
  plugins: {
    // The page draws under the bars and reads the insets (env() on iOS, --android-inset-* on Android).
    SystemBars: { insetsHandling: "disable" },
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
    SplashScreen: { launchAutoHide: false, backgroundColor: "#ffffff", showSpinner: false },
    PushNotifications: { presentationOptions: ["banner", "sound", "badge"] },
    FoleviShell: {
      serviceUrl: service.origin,
      dropboxAppKey: process.env.FOLEVI_DROPBOX_APP_KEY ?? "",
      googleClientId: process.env.FOLEVI_GOOGLE_IOS_CLIENT_ID ?? "",
    },
  },
  // Capacitor's own logging would write what crosses the bridge (note text, library files) to the system log.
  loggingBehavior: release ? "none" : "debug",
};

export default config;
