// Shared pieces for the library layer's tests (src/library/*.test.ts). Outside src/, so tsc never ships it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
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

/**
 * Folevi for Windows has no coordinated file helper (the Mac's folevi-files was for iCloud Drive), so the tests
 * that need one skip. Kept so the library's tests read as they did.
 */
export const hasSwift = false;
export function helperBinary(): string | null {
  return null;
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
