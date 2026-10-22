#!/usr/bin/env node
// Builds bridge/index.ts (the shared Dropbox and Google Drive code, packages/cloud-folders, through the Android
// app's bridge kit) into ios/App/Native/Shell/folevi-cloud.js (git-ignored): an IIFE that defines FoleviCloudKit,
// which FoleviViewController places inside bridge.js's own function, never on the page's window. Run by
// `pnpm shell`, `pnpm release` and `node scripts/simulator.mjs build`. Without it the app doesn't offer
// Dropbox and Google Drive.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const esbuild = resolve(root, "../../node_modules/.bin/esbuild");
if (!existsSync(esbuild)) throw new Error("bundle-cloud: esbuild isn't installed (run pnpm install at the repository root).");
execFileSync(
  esbuild,
  [resolve(root, "bridge/index.ts"), "--bundle", "--format=iife", "--global-name=FoleviCloudKit", "--target=safari17", "--legal-comments=none", "--minify", `--outfile=${resolve(root, "ios/App/Native/Shell/folevi-cloud.js")}`, "--log-level=warning"],
  { stdio: "inherit" },
);
