// Shared pieces for the library layer's tests (src/library/*.test.ts). Outside src/, so tsc never ships it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const DESKTOP = resolve(__dirname, "..");
export const LOCAL_STORE = resolve(DESKTOP, "../../packages/local-store");

const temps: string[] = [];

/** A fresh folder (real path: /var → /private/var resolved), removed by cleanupTemps. */
export function tempDir(prefix = "folevi-lib-"): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(d);
  return d;
}

export function cleanupTemps() {
  for (const d of temps.splice(0)) {
    try {
      execFileSync("chmod", ["-R", "u+rwx", d]);
    } catch {
      // Gone already.
    }
    rmSync(d, { recursive: true, force: true });
  }
}

export const hasSwift = (() => {
  try {
    execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
    return process.platform === "darwin";
  } catch {
    return false;
  }
})();

/**
 * folevi-files for this Mac's architecture, built from native/folevi-files.swift into a cache folder keyed by
 * the source's hash (a few seconds the first time). Null without Xcode's tools.
 */
export function helperBinary(): string | null {
  if (!hasSwift) return null;
  const source = join(DESKTOP, "native", "folevi-files.swift");
  const hash = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 16);
  const dir = join(tmpdir(), "folevi-files-test-build");
  const out = join(dir, `folevi-files-${hash}`);
  if (existsSync(out)) return out;
  mkdirSync(dir, { recursive: true });
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  execFileSync("xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos13.0`, source, "-o", `${out}.part`], { stdio: "inherit" });
  execFileSync("mv", [`${out}.part`, out]);
  return out;
}

/** src/ compiled to plain JavaScript (for child processes), cached by the sources' modification times. */
export function compiledSrc(): string {
  const files = ["fs.ts", "journal.ts", "paths.ts", "types.ts", "helper.ts"].map((f) => join(DESKTOP, "src", "library", f));
  const stamp = createHash("sha256")
    .update(files.map((f) => `${f}:${statSync(f).mtimeMs}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const out = join(tmpdir(), `folevi-desktop-dist-${stamp}`);
  if (!existsSync(join(out, "library", "fs.js"))) {
    execFileSync(join(DESKTOP, "node_modules", ".bin", "tsc"), ["-p", join(DESKTOP, "tsconfig.json"), "--outDir", out], { stdio: "inherit" });
  }
  return out;
}

/** safeStorage for tests: reversible, and says so. */
export const fakeSealer = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`sealed:${Buffer.from(s).toString("hex")}`),
  decryptString: (b: Buffer) => {
    const t = b.toString();
    if (!t.startsWith("sealed:")) throw new Error("not sealed");
    return Buffer.from(t.slice(7), "hex").toString();
  },
};

export const utf8 = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
export const text = (b: Uint8Array) => Buffer.from(b).toString("utf8");

export async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
