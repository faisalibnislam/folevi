#!/usr/bin/env node
// How much memory a Folevi build uses once it has settled, on Windows or Linux (GitHub Actions runs it for the Tauri
// build and for the Electron build it replaced, on the same machines). It starts the app on a scratch data folder
// (never anyone's data), waits, then adds up the app's process and every process under it (WebView2's or WebKitGTK's
// helpers, or Electron's renderers and GPU process):
//   node scripts/measure.mjs --label tauri --out measure.json --wait 30 -- <command> [args...]
// Windows: working set and private bytes (what Task Manager shows as "Memory"). Linux: RSS and PSS (PSS shares each
// shared page among the processes using it, the fairest single number).
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const flags = argv.slice(0, sep < 0 ? argv.length : sep);
const command = sep < 0 ? [] : argv.slice(sep + 1);
const flag = (n, d) => (flags.includes(n) ? flags[flags.indexOf(n) + 1] : d);
const label = flag("--label", "app");
const out = flag("--out", `measure-${label}.json`);
const wait = Number(flag("--wait", "30"));
// --expect-ready: the app must say its page started (Folevi's Tauri build prints "FOLEVI READY" with
// FOLEVI_REPORT_READY), else the figures would be a blank window's and the run fails.
const expectReady = flags.includes("--expect-ready");
if (!command.length) throw new Error("measure: give the command after --");

const data = mkdtempSync(join(tmpdir(), "folevi-measure-"));
const env = { ...process.env, FOLEVI_USER_DATA: data, FOLEVI_UPDATES: "off", FOLEVI_SHELL: "1", FOLEVI_REPORT_READY: "1" };
const child = spawn(command[0], command.slice(1), { env, stdio: ["ignore", "pipe", "ignore"], detached: process.platform !== "win32" });
let ready = false;
child.stdout.on("data", (d) => {
  if (/FOLEVI READY main /.test(String(d))) ready = true;
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every process under `root` (and itself): [{ pid, name, ...memory }]. */
function tree(root) {
  if (process.platform === "win32") {
    const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress";
    const all = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    const kids = new Map();
    for (const p of all) kids.set(p.ParentProcessId, [...(kids.get(p.ParentProcessId) ?? []), p]);
    const found = [];
    const walk = (pid) => {
      const self = all.find((p) => p.ProcessId === pid);
      if (self && !found.includes(self)) found.push(self);
      for (const k of kids.get(pid) ?? []) walk(k.ProcessId);
    };
    walk(root);
    // WebView2's processes belong to msedgewebview2.exe trees started by the app; a stray one elsewhere is counted
    // if its command line names the app's data folder (it always carries --user-data-dir).
    const extra = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${data.replace(/'/g, "''")}*' -or $_.CommandLine -like '*com.folevi.desktop*' } | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress`], { encoding: "utf8" }) || "[]");
    for (const p of [extra].flat()) if (p && !found.some((f) => f.ProcessId === p.ProcessId)) walk(p.ProcessId);
    return found.map((p) => ({ pid: p.ProcessId, name: p.Name, workingSetMB: +(p.WorkingSetSize / 1048576).toFixed(1), privateMB: +((p.PrivatePageCount ?? 0) / 1048576).toFixed(1) }));
  }
  const stat = (pid) => {
    try {
      const s = readFileSync(`/proc/${pid}/stat`, "utf8");
      return { ppid: Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]), name: s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")) };
    } catch {
      return null;
    }
  };
  const pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number);
  const info = new Map(pids.map((p) => [p, stat(p)]).filter(([, s]) => s));
  const found = [];
  const walk = (pid) => {
    found.push(pid);
    for (const [p, s] of info) if (s.ppid === pid) walk(p);
  };
  walk(root);
  return found.map((pid) => {
    let rss = 0;
    let pss = 0;
    try {
      const r = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      rss = Number(/^Rss:\s+(\d+)/m.exec(r)?.[1] ?? 0);
      pss = Number(/^Pss:\s+(\d+)/m.exec(r)?.[1] ?? 0);
    } catch {
      /* gone */
    }
    return { pid, name: info.get(pid)?.name ?? "?", rssMB: +(rss / 1024).toFixed(1), pssMB: +(pss / 1024).toFixed(1) };
  });
}

let result;
try {
  await sleep(wait * 1000);
  const procs = tree(child.pid);
  const sum = (k) => +procs.reduce((n, p) => n + (p[k] ?? 0), 0).toFixed(1);
  result =
    process.platform === "win32"
      ? { label, os: process.platform, arch: process.arch, waitSeconds: wait, processes: procs.length, workingSetMB: sum("workingSetMB"), privateMB: sum("privateMB"), detail: procs }
      : { label, os: process.platform, arch: process.arch, waitSeconds: wait, processes: procs.length, rssMB: sum("rssMB"), pssMB: sum("pssMB"), detail: procs };
} finally {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  await sleep(1000);
  rmSync(data, { recursive: true, force: true });
}
result.ready = ready;
writeFileSync(out, JSON.stringify(result, null, 2));
const head = process.platform === "win32" ? `working set ${result.workingSetMB} MB, private ${result.privateMB} MB` : `PSS ${result.pssMB} MB, RSS ${result.rssMB} MB`;
console.log(`${label}: ${result.processes} processes, ${head}${expectReady ? (ready ? ", page ready" : ", PAGE NEVER STARTED") : ""}`);
if (expectReady && !ready) process.exit(1);
