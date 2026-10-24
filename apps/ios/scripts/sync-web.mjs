#!/usr/bin/env node
// Puts the page and its settings into the Xcode project (what `cap sync ios` did before the app left Capacitor,
// docs/NATIVE_APP_PLAN.md N1): the web folder into ios/App/App/public (served at capacitor://localhost by
// Native/Host/AppScheme.swift) and ios/App/App/folevi-host.json (read by WebHost's HostConfig). Both git-ignored.
//
//   node scripts/sync-web.mjs                       the built-in interface (web/, from `pnpm shell`), signing in
//                                                   against FOLEVI_SERVICE_URL (default https://app.folevi.com)
//   FOLEVI_SHELL_URL=http://localhost:3003 ...      the built-in interface from `next dev` (dev:shell), signed in
//                                                   against FOLEVI_SERVICE_URL (default http://app.localhost:3002)
//   FOLEVI_URL=http://app.localhost:3002 ...        the website in the app, with the offline page from www/
//
// Dropbox and Google Drive: public client ids from FOLEVI_DROPBOX_APP_KEY and FOLEVI_GOOGLE_IOS_CLIENT_ID (never
// the repository); a provider without one isn't offered.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "ios/App/App");

const shellDev = process.env.FOLEVI_SHELL_URL ? new URL(process.env.FOLEVI_SHELL_URL) : null;
const website = !shellDev && process.env.FOLEVI_URL ? new URL(process.env.FOLEVI_URL) : null;
const service = new URL(process.env.FOLEVI_SERVICE_URL ?? (shellDev ? "http://app.localhost:3002" : "https://app.folevi.com"));

const mode = shellDev ? "shellDev" : website ? "website" : "bundled";
// The built-in interface, or only the offline page (www/) when the app shows a server's page.
const webDir = resolve(root, mode === "bundled" ? "web" : "www");
if (!existsSync(resolve(webDir, "index.html"))) {
  throw new Error(mode === "bundled" ? "sync-web: web/ has no export yet. Run `pnpm shell` first." : "sync-web: www/ is missing.");
}

const host = {
  mode,
  // Straight to the app's start page for the website (its "/" is a server redirect the service worker doesn't keep).
  serverUrl: shellDev ? shellDev.origin : website ? `${website.origin}/documents` : "capacitor://localhost",
  serviceUrl: service.origin,
  errorPath: website ? "offline.html" : "",
  dropboxAppKey: process.env.FOLEVI_DROPBOX_APP_KEY ?? "",
  googleClientId: process.env.FOLEVI_GOOGLE_IOS_CLIENT_ID ?? "",
};

const publicDir = resolve(app, "public");
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(webDir, publicDir, { recursive: true });
writeFileSync(resolve(app, "folevi-host.json"), JSON.stringify(host, null, 2) + "\n");
console.log(`sync-web: ${mode} (${host.serverUrl}), signing in at ${host.serviceUrl}; ${webDir.slice(root.length + 1)}/ copied to ios/App/App/public`);
