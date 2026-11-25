// The best connection to a Folevi Server for the Android app's bridge script (docs/self-hosting/CONTRACT.md §6.1):
// the web's own module, bundled as FoleviServerReach by scripts/bundle-bridge.mjs, so Android, the browser and the
// Windows and Linux shells pick a server's name the same way (the Mac, iPhone and iPad apps do it in Swift).
export { bestOrigin, candidateOrigins, urlsAt, watchBestOrigin } from "../../web/src/lib/server-edition/connection";
