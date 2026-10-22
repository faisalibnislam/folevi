// Folevi for Android (docs/ANDROID_PLAN.md): the interface built into the app (the web app's static shell
// export, `node apps/web/scripts/build-shell.mjs --platform android`, copied to web/) served by Capacitor from
// https://localhost, like the Mac app's app://folevi. Local mode never contacts Folevi; account mode signs in
// with a bearer token kept by the app (docs/LOCAL_MODE_PLAN.md §1). Kotlin adds the bridge (window.foleviShell
// and window.foleviNative, android/app/src/main/assets/folevi-bridge.js) and the native extras.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.folevi.android",
  appName: "Folevi",
  webDir: "web",
  android: {
    path: "android",
    // The page draws under the status and navigation bars and lays itself out with the safe-area insets
    // (MainActivity sets them; WebView reports them to env(safe-area-inset-*)).
    adjustMarginsForEdgeToEdge: "disable",
    // Debug builds only: lets chrome://inspect attach to the web view.
    webContentsDebuggingEnabled: process.env.FOLEVI_RELEASE !== "1",
    allowMixedContent: false,
    captureInput: false,
    appendUserAgent: "FoleviAndroid/1.0",
  },
  plugins: {
    // The app lays out the system bars and the keyboard itself (MainActivity.kt, folevi-bridge.js), not
    // Capacitor's SystemBars plugin, which would pad the window on WebViews older than 140.
    SystemBars: { insetsHandling: "disable" },
  },
  server: {
    androidScheme: "https",
    hostname: "localhost",
  },
};

export default config;
