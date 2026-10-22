#!/usr/bin/env node
// Folevi for Android on the emulators (apps/android/README.md):
//   node scripts/emulator.mjs avds                         create the Folevi phone, tablet and foldable AVDs
//   node scripts/emulator.mjs boot <phone|tablet|foldable> start one (headless unless --window)
//   node scripts/emulator.mjs build                        gradle assembleDebug
//   node scripts/emulator.mjs install [serial]             install the debug build, adb reverse for the dev server
//   node scripts/emulator.mjs run [serial]                 install, then open the app
//   node scripts/emulator.mjs eval '<js>' [serial]         run JavaScript in the app's web view (debug builds)
//   node scripts/emulator.mjs shot <file.png> [serial]     screenshot
//   node scripts/emulator.mjs theme <light|dark> [serial]  the system's dark theme on or off
//   node scripts/emulator.mjs unit                         Kotlin unit tests (gradle testDebugUnitTest)
// Everything uses the SDK in ANDROID_HOME (default ~/Library/Android/sdk) and JAVA_HOME (default Homebrew's
// openjdk). It never downloads SDK packages or system images: the AVDs use the installed android-36 image.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
const javaHome = process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home";
const adbPath = join(sdk, "platform-tools/adb");
const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: javaHome };
const PACKAGE = "com.folevi.android";
const IMAGE = "system-images;android-36;google_apis_playstore;arm64-v8a";
export const AVDS = {
  phone: { name: "Folevi_Phone", device: "pixel_9", port: 5554 },
  tablet: { name: "Folevi_Tablet", device: "pixel_tablet", port: 5556 },
  foldable: { name: "Folevi_Foldable", device: "pixel_9_pro_fold", port: 5558 },
};

const [command, ...args] = process.argv.slice(2);

function adb(serial, ...a) {
  return execFileSync(adbPath, serial ? ["-s", serial, ...a] : a, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function serialOf(arg) {
  if (arg && AVDS[arg]) return `emulator-${AVDS[arg].port}`;
  if (arg) return arg;
  const devices = adb(null, "devices").split("\n").slice(1).map((l) => l.split("\t")[0]).filter(Boolean);
  if (!devices.length) throw new Error("No emulator is running (node scripts/emulator.mjs boot phone).");
  return devices[0];
}

/** Evaluates JavaScript in the app's web view through its DevTools socket (debug builds only). */
export async function evaluate(serial, expression) {
  const pid = adb(serial, "shell", "pidof", PACKAGE).trim();
  if (!pid) throw new Error("Folevi isn't running on " + serial);
  const port = 9300 + (Number(serial.replace(/\D/g, "")) % 600);
  adb(serial, "forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find((p) => p.type === "page" && p.url.startsWith("https://localhost")) ?? pages[0];
  if (!page) throw new Error("No web view page to attach to.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  const result = await new Promise((ok, fail) => {
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== 1) return;
      if (msg.result?.exceptionDetails) fail(new Error(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text));
      else ok(msg.result?.result?.value);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  return result;
}

function gradle(...tasks) {
  execFileSync(join(root, "android/gradlew"), tasks, { cwd: join(root, "android"), env, stdio: "inherit" });
}

const apk = join(root, "android/app/build/outputs/apk/debug/app-debug.apk");

async function main() {
  switch (command) {
    case "avds": {
      const avdmanager = join(sdk, "cmdline-tools/latest/bin/avdmanager");
      for (const { name, device } of Object.values(AVDS)) {
        if (existsSync(join(homedir(), ".android/avd", `${name}.avd`))) continue;
        execFileSync(avdmanager, ["create", "avd", "-n", name, "-k", IMAGE, "-d", device], { env, input: "no\n", stdio: ["pipe", "inherit", "inherit"] });
      }
      break;
    }
    case "boot": {
      const avd = AVDS[args[0] ?? "phone"];
      if (!avd) throw new Error("boot phone | tablet | foldable");
      const flags = ["-avd", avd.name, "-port", String(avd.port), "-no-audio", "-no-boot-anim"];
      if (!args.includes("--window")) flags.push("-no-window", "-gpu", "swiftshader_indirect");
      spawn(join(sdk, "emulator/emulator"), flags, { env, detached: true, stdio: "ignore" }).unref();
      const serial = `emulator-${avd.port}`;
      for (let i = 0; i < 180; i++) {
        try {
          if (adb(serial, "shell", "getprop", "sys.boot_completed").trim() === "1") {
            console.log(`${serial} booted`);
            return;
          }
        } catch {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(`${serial} didn't boot`);
    }
    case "build":
      gradle(":app:assembleDebug");
      break;
    case "unit":
      gradle(":app:testDebugUnitTest");
      break;
    case "install":
    case "run": {
      const serial = serialOf(args[0]);
      // The dev server on the Mac (http://app.localhost:3002) at the emulator's own loopback.
      adb(serial, "reverse", "tcp:3002", "tcp:3002");
      adb(serial, "install", "-r", apk);
      if (command === "run") adb(serial, "shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`);
      console.log(`${command === "run" ? "running" : "installed"} on ${serial}`);
      break;
    }
    case "eval": {
      const value = await evaluate(serialOf(args[1]), args[0] ?? "return location.href");
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      break;
    }
    case "shot": {
      const serial = serialOf(args[1]);
      const png = execFileSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { env, maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(args[0], png);
      console.log(args[0]);
      break;
    }
    case "theme": {
      adb(serialOf(args[1]), "shell", "cmd", "uimode", "night", args[0] === "dark" ? "yes" : "no");
      break;
    }
    default:
      console.log("avds | boot <phone|tablet|foldable> | build | install | run | eval '<js>' | shot <file> | theme <light|dark> | unit");
  }
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) await main();
