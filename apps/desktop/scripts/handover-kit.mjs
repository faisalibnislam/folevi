#!/usr/bin/env node
// Writes the handoff kit (src/handoffKit.ts, as tsc compiles it into dist/) for the native Folevi for Mac, which
// imports the handover with the very same code (apps/mac/Folevi/Migration/handover-kit.js, run by
// HandoverImport.swift in a hidden WebKit view). Run after `pnpm build` whenever handoffKit.ts changes; --check
// says whether the committed copy is current (src/handover.test.ts also runs the copy against the kit).
//
//   node scripts/handover-kit.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "../mac/Folevi/Migration/handover-kit.js");
const { handoffKit } = createRequire(import.meta.url)(join(root, "dist", "handoffKit.js"));
const text = `// Made by apps/desktop/scripts/handover-kit.mjs from apps/desktop/src/handoffKit.ts (as tsc compiles it): edit
// that file and run the script, never this one. HandoverImport.swift calls (<this function>)()[fn](storage, ...args).
${handoffKit.toString()}
`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    /* missing */
  }
  if (current !== text) {
    console.error(`${target} isn't current: run node apps/desktop/scripts/handover-kit.mjs after pnpm build.`);
    process.exit(1);
  }
  console.log("handover-kit.js is current.");
} else {
  writeFileSync(target, text);
  console.log(target);
}
