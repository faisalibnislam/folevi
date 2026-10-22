#!/usr/bin/env node
// Builds the bridge's TypeScript half (bridge/index.ts, with packages/cloud-folders) into
// android/app/src/main/assets/folevi-cloud.js, an IIFE that defines FoleviCloudKit inside the bridge's own
// wrapper (BridgeScript.kt), never on the page's window. Run by Gradle before every build (bundleBridge).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const esbuild = resolve(root, "../../node_modules/.bin/esbuild");
if (!existsSync(esbuild)) throw new Error("bundle-bridge: esbuild isn't installed (run pnpm install at the repository root).");
execFileSync(
  esbuild,
  [resolve(root, "bridge/index.ts"), "--bundle", "--format=iife", "--global-name=FoleviCloudKit", "--target=chrome111", "--legal-comments=none", `--outfile=${resolve(root, "android/app/src/main/assets/folevi-cloud.js")}`, "--log-level=warning"],
  { stdio: "inherit" },
);
