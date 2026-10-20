// @vitest-environment node
// Every Convex function the product calls must be classified for local mode (docs/LOCAL_MODE_PLAN.md
// §2.5.2): ported (in LOCAL_FUNCTIONS) or hidden (in LOCAL_HIDDEN, naming the capability that gates its
// interface), or planned for a later phase (LOCAL_PLANNED). Scans apps/web/src/components and src/lib, without admin and marketing (the shell doesn't
// ship them) and without lib/local itself (the implementation, not a caller).
//
// Until WP5's registry exists this only reports the list; after that, a function in none of the three
// lists fails. PARITY_LIST=1 prints every function with its status and callers.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { canonicalName, loadRegistry } from "./registry";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
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

/** Function name ("documents:get") → the files that call it. */
function scan(): Map<string, string[]> {
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
function isConvexFunction(name: string): boolean {
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

describe("local mode coverage", () => {
  test("every Convex function the product calls is ported or hidden for local mode", async () => {
    const found = scan();
    const functions = [...found.keys()].filter(isConvexFunction).sort();
    const notFunctions = [...found.keys()].filter((n) => !isConvexFunction(n));
    expect(functions.length, "the scan found the product's Convex calls").toBeGreaterThan(100);

    const registry = await loadRegistry();
    const byModule = (list: string[]) => {
      const counts = new Map<string, number>();
      for (const n of list) counts.set(n.split(":")[0]!, (counts.get(n.split(":")[0]!) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m} ${c}`).join(", ");
    };

    if (!registry.ready) {
      console.info(
        [
          `[parity coverage] ${functions.length} Convex functions called by the product; registry not available (${registry.reason}).`,
          `[parity coverage] classified 0, unclassified ${functions.length} (reported, not failing until the registry exists).`,
          `[parity coverage] by module: ${byModule(functions)}`,
          ...(process.env.PARITY_LIST === "1" ? functions.map((n) => `  ${n}  (${found.get(n)!.join(", ")})`) : [`[parity coverage] PARITY_LIST=1 prints every function with its callers.`]),
          ...(notFunctions.length ? [`[parity coverage] matched but not Convex functions: ${notFunctions.join(", ")}`] : []),
        ].join("\n"),
      );
      return;
    }

    const groups = { ported: [] as string[], hidden: [] as string[], planned: [] as string[], unclassified: [] as string[] };
    const phases = new Map<string, number>();
    const noCapability: string[] = [];
    const unknownCapability: string[] = [];
    for (const name of functions) {
      const s = registry.status(name);
      groups[s.kind].push(name);
      if (s.kind === "planned") phases.set(s.phase, (phases.get(s.phase) ?? 0) + 1);
      if (s.kind === "hidden") {
        if (!s.capability) noCapability.push(name);
        else if (registry.capabilities && !registry.capabilities.has(s.capability)) unknownCapability.push(`${name} (${s.capability})`);
      }
    }
    const classified = groups.ported.length + groups.hidden.length + groups.planned.length;
    console.info(
      [
        `[parity coverage] ${functions.length} Convex functions called by the product: ${classified} classified (${groups.ported.length} ported, ${groups.hidden.length} hidden, ${groups.planned.length} planned: ${[...phases].sort().map(([p, c]) => `${p} ${c}`).join(", ")}), ${groups.unclassified.length} unclassified.`,
        ...(groups.unclassified.length ? [`[parity coverage] unclassified by module: ${byModule(groups.unclassified)}`] : []),
        ...(registry.handlerErrors.length ? [`[parity coverage] handler modules that failed to load: ${registry.handlerErrors.join("; ")}`] : []),
        ...(process.env.PARITY_LIST === "1" ? functions.map((n) => `  ${registry.status(n).kind.padEnd(12)} ${n}  (${found.get(n)!.join(", ")})`) : []),
      ].join("\n"),
    );
    const withCallers = (list: string[]) => list.map((n) => `${n}  (${(found.get(canonicalName(n.split(" ")[0]!)) ?? []).join(", ")})`);
    expect(withCallers(groups.unclassified), "add each to lib/local/registry.ts: a handler (LOCAL_FUNCTIONS), LOCAL_HIDDEN with its capability, or LOCAL_PLANNED with its phase").toEqual([]);
    expect(noCapability, "a hidden function must name the capability that hides its interface").toEqual([]);
    expect(unknownCapability, "a hidden function's capability must be one lib/backendMode.ts CAPABILITIES lists").toEqual([]);
    expect(registry.handlerErrors, "every lib/local/functions module loads").toEqual([]);
  });
});
