// Which Convex functions the product calls, and from where: every `api.<module>.<fn>` in apps/web/src's
// components and lib, without admin and marketing (the bundled shell doesn't ship them) and without lib/local
// itself (the local implementation, not a caller). The local-mode coverage test (coverage.test.ts) and the
// shell's API snapshot (tests/contract/api-snapshot.test.ts) both read this list.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WEB_SRC = join(ROOT, "apps/web/src");
const SCAN = ["components", "lib"];
const SKIP_DIRS = new Set(["admin", "marketing"]);
const SKIP_PATHS = [join(WEB_SRC, "lib/local")];
const REF = /\bapi\.(\w+)\.(\w+)/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_PATHS.includes(path) || entry.name === "node_modules") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Function name ("documents:get") → the files that call it (relative to apps/web/src). */
export function scanCallers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const base of SCAN) {
    for (const file of sourceFiles(join(WEB_SRC, base))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(REF)) {
        const name = `${m[1]}:${m[2]}`;
        const where = relative(WEB_SRC, file);
        const list = found.get(name) ?? [];
        if (!list.includes(where)) list.push(where);
        found.set(name, list);
      }
    }
  }
  return found;
}

/** Whether convex/<module>.ts exports the function (so a URL like api.example.com isn't counted). */
const moduleText = new Map<string, string | null>();
export function isConvexFunction(name: string): boolean {
  const [mod, fn] = name.split(":") as [string, string];
  if (!moduleText.has(mod)) {
    try {
      moduleText.set(mod, readFileSync(join(ROOT, "convex", `${mod}.ts`), "utf8"));
    } catch {
      moduleText.set(mod, null);
    }
  }
  const text = moduleText.get(mod);
  return text != null && new RegExp(`export const ${fn}\\b`).test(text);
}

/** The Convex functions the product calls, sorted. */
export function calledFunctions(): string[] {
  return [...scanCallers().keys()].filter(isConvexFunction).sort();
}
