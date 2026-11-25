#!/usr/bin/env node
// Builds what the app's bridge script needs beside bridge/mobile-bridge.js, into bridge/build/ (git-ignored):
//   folevi-cloud.js: the Dropbox and Google Drive kit shared with the iPhone and iPad app and the Android app
//     (apps/android/bridge/cloud.ts over packages/cloud-folders), an IIFE defining FoleviCloudKit, which the app
//     places inside the bridge's own function, never on the page's window.
// Then copies folevi-cloud.js into the Android app's assets (android/app/src/main/assets, beside its folevi-bridge.js).
// The iOS app reads it from bridge/build, and the shell half shared with the Mac app from apps/ios in place.
// Run by `pnpm sync`.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "bridge/build");
mkdirSync(out, { recursive: true });
const esbuild = [resolve(root, "node_modules/.bin/esbuild"), resolve(root, "../../node_modules/.bin/esbuild")].find((p) => existsSync(p));
if (!esbuild) throw new Error("bundle-bridge: esbuild isn't installed (pnpm install in apps/mobile).");
execFileSync(
  esbuild,
  [resolve(root, "../ios/bridge/index.ts"), "--bundle", "--format=iife", "--global-name=FoleviCloudKit", "--target=safari17,chrome120", "--legal-comments=none", "--minify", `--outfile=${resolve(out, "folevi-cloud.js")}`, "--log-level=warning"],
  { stdio: "inherit" },
);
const assets = resolve(root, "android/app/src/main/assets");
if (existsSync(resolve(root, "android/app"))) {
  mkdirSync(assets, { recursive: true });
  copyFileSync(resolve(out, "folevi-cloud.js"), resolve(assets, "folevi-cloud.js"));
}
console.log("bundle-bridge: bridge/build and the Android assets are up to date.");
