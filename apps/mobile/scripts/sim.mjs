#!/usr/bin/env node
// Debug builds in the iOS Simulator: runs JavaScript in the app's page (apps/ios SimulatorEval.swift) and prints the
// answer. The script is an async function body, so it can `await` and `return`.
//   node scripts/sim.mjs eval '<js>' <udid>
//   node scripts/sim.mjs open 'folevi://...' <udid>      (a link, as if another app had opened it)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [command, arg, udid = "booted"] = process.argv.slice(2);
const container = execFileSync("xcrun", ["simctl", "get_app_container", udid, "com.folevi.ios", "data"], { encoding: "utf8" }).trim();
const tmp = resolve(container, "tmp");
const out = resolve(tmp, "eval-result.json");
rmSync(out, { force: true });
writeFileSync(resolve(tmp, "eval.js"), command === "open" ? `//open ${arg}` : (arg ?? "return location.href"));
execFileSync("xcrun", ["simctl", "spawn", udid, "notifyutil", "-p", "com.folevi.ios.eval"]);
const started = Date.now();
while (!existsSync(out) && Date.now() - started < 20000) execFileSync("sleep", ["0.2"]);
console.log(existsSync(out) ? readFileSync(out, "utf8") : "no answer within 20 s");
