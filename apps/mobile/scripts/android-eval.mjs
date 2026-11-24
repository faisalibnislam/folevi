#!/usr/bin/env node
// Debug builds on an Android emulator or phone: runs JavaScript in the app's web view through Chrome's DevTools
// protocol (the debug build turns on web contents debugging) and prints the answer.
//   node scripts/android-eval.mjs '<expression>' [adb serial]
// The expression may be async (it's awaited). ANDROID_HOME defaults to ~/Library/Android/sdk.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const [expression = "location.href", serial] = process.argv.slice(2);
const adb = resolve(process.env.ANDROID_HOME ?? resolve(homedir(), "Library/Android/sdk"), "platform-tools/adb");
const dev = serial ? ["-s", serial] : [];
const pid = execFileSync(adb, [...dev, "shell", "pidof", "com.folevi.android"], { encoding: "utf8" }).trim();
if (!pid) throw new Error("android-eval: Folevi isn't running.");
const port = 9300 + (Number(pid) % 500);
execFileSync(adb, [...dev, "forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === "page" && p.url.startsWith("https://localhost")) ?? pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  ws.onopen = ok;
  ws.onerror = fail;
});
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  const r = msg.result?.result;
  console.log(msg.result?.exceptionDetails ? `error: ${msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text}` : JSON.stringify(r?.value ?? r?.description ?? null));
  ws.close();
  process.exit(0);
};
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true } }));
setTimeout(() => {
  console.log("no answer within 20 s");
  process.exit(1);
}, 20000);
