// @vitest-environment node
// Every Convex function the product calls must be classified for local mode (docs/LOCAL_MODE_PLAN.md
// §2.5.2): ported (in LOCAL_FUNCTIONS) or hidden (in LOCAL_HIDDEN, naming the capability that gates its
// interface), or planned for a later phase (LOCAL_PLANNED). Scans apps/web/src/components and src/lib, without admin and marketing (the shell doesn't
// ship them) and without lib/local itself (the implementation, not a caller).
//
// Until WP5's registry exists this only reports the list; after that, a function in none of the three
// lists fails. PARITY_LIST=1 prints every function with its status and callers.
import { describe, expect, test } from "vitest";
import { isConvexFunction, scanCallers as scan } from "./callers";
import { canonicalName, loadRegistry } from "./registry";

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
