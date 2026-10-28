#!/usr/bin/env node
// A memory watchdog for builds and test runs. A Swift compile that runs away (a big literal the type checker
// can't solve) took about 350 GB and froze the Mac (2026-10-28); this stops the build long before that.
//
//   import { guardMemory } from "./memguard.mjs"; const stop = guardMemory("apps/mac/build"); ...; stop();
//
// Every 2 s it reads the free memory level (kern.memorystatus_level, the percentage memory_pressure prints) and
// every compiler's memory (swift-frontend, swift-build, clang, ld, xcodebuild, SWBBuildService). When free memory
// falls under MIN_FREE % or one of them passes MAX_GB, it kills them all and the process that started it, and
// prints what was compiling. It runs as its own process, so it works while the caller blocks in execFileSync.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIN_FREE = 30;
const MAX_GB = 8;
const HEAVY = /\/(swift-frontend|swift-build|swift-driver|clang|ld|xcodebuild|SWBBuildService|XCBBuildService)( |$)/;

/** Starts the watchdog for the calling process; returns a function that stops it. */
export function guardMemory() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), String(process.pid)], { stdio: ["ignore", "inherit", "inherit"] });
  child.unref();
  return () => child.kill();
}

function heavy() {
  const out = execFileSync("ps", ["-axo", "pid=,rss=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return m && HEAVY.test(m[3]) ? [{ pid: Number(m[1]), gb: Number(m[2]) / 1048576, command: m[3] }] : [];
  });
}

function stopAll(parent, why, procs) {
  const top = [...procs].sort((a, b) => b.gb - a.gb)[0];
  const files = top?.command.match(/-primary-file \S+(\\ \S+)*/g)?.map((f) => f.replace("-primary-file ", "").replace(/\\ /g, " ")) ?? [];
  console.error(`\nmemguard: ${why}; stopping the build.`);
  if (top) console.error(`memguard: largest: ${top.gb.toFixed(1)} GB, ${top.command.split(" ")[0]}${files.length ? `\n  compiling ${files.join("\n  compiling ")}` : ""}`);
  for (const p of procs) {
    try {
      process.kill(p.pid, "SIGKILL");
    } catch {}
  }
  try {
    process.kill(parent, "SIGTERM");
  } catch {}
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const parent = Number(process.argv[2]);
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
    const free = Number(execFileSync("sysctl", ["-n", "kern.memorystatus_level"], { encoding: "utf8" }).trim());
    const procs = heavy();
    const big = procs.find((p) => p.gb > MAX_GB);
    if (free < MIN_FREE) stopAll(parent, `free memory is ${free}% (under ${MIN_FREE}%)`, procs);
    else if (big) stopAll(parent, `a compiler is using ${big.gb.toFixed(1)} GB (over ${MAX_GB} GB)`, procs);
  }, 2000);
}
