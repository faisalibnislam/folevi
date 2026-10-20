// Reads WP5's registry (apps/web/src/lib/local/registry.ts): which Convex functions local mode runs
// (LOCAL_FUNCTIONS), which it hides behind a capability (LOCAL_HIDDEN) and which are planned for a later
// phase (LOCAL_PLANNED). The handler modules in lib/local/functions/ register themselves when imported, so
// they're loaded first. Until the registry exists the harness reports instead of failing.
//
// The registry's own `localStatus(name)` is the answer when it's exported. Otherwise the exports are read
// directly; names are "documents:get" or "documents.get", and "module:*" covers a whole module.

const registryModules = import.meta.glob<Record<string, unknown>>("../../apps/web/src/lib/local/registry.ts");
const handlerModules = import.meta.glob("../../apps/web/src/lib/local/functions/**/*.ts");
const modeModules = import.meta.glob<Record<string, unknown>>("../../apps/web/src/lib/backendMode.ts");

export type Status = { kind: "ported" } | { kind: "hidden"; capability: string } | { kind: "planned"; phase: string } | { kind: "unclassified" };

export type Registry =
  | {
      ready: true;
      status(name: string): Status;
      ported(name: string): boolean;
      /** The capability names useCapabilities() knows (lib/backendMode.ts CAPABILITIES), when exported. */
      capabilities: Set<string> | null;
      /** Handler modules that failed to import (they register nothing). */
      handlerErrors: string[];
    }
  | { ready: false; reason: string };

/** "documents.get" and "documents:get" both become "documents:get". */
export function canonicalName(name: string): string {
  return name.includes(":") ? name : name.replace(/\.(?=[^.]+$)/, ":");
}

function keys(value: unknown): string[] {
  if (value instanceof Map) return [...value.keys()].map(String);
  if (value instanceof Set || Array.isArray(value)) return [...value].map(String);
  if (value && typeof value === "object") return Object.keys(value);
  return [];
}

function lookup(table: unknown, name: string): unknown {
  const get = (k: string) => (table instanceof Map ? table.get(k) : table && typeof table === "object" ? (table as Record<string, unknown>)[k] : undefined);
  return get(name) ?? get(`${name.split(":")[0]}:*`);
}

let cached: Promise<Registry> | undefined;

export function loadRegistry(): Promise<Registry> {
  cached ??= (async (): Promise<Registry> => {
    const load = Object.values(registryModules)[0];
    if (!load) return { ready: false, reason: "apps/web/src/lib/local/registry.ts (WP5) doesn't exist yet" };
    let mod: Record<string, unknown>;
    try {
      mod = await load();
    } catch (error) {
      return { ready: false, reason: `lib/local/registry.ts failed to load: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!("LOCAL_FUNCTIONS" in mod) || !("LOCAL_HIDDEN" in mod)) return { ready: false, reason: "lib/local/registry.ts doesn't export LOCAL_FUNCTIONS and LOCAL_HIDDEN yet" };
    const handlerErrors: string[] = [];
    for (const [path, loadHandler] of Object.entries(handlerModules)) {
      try {
        await loadHandler();
      } catch (error) {
        handlerErrors.push(`${path.replace("../../apps/web/src/", "")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let capabilities: Set<string> | null = null;
    const loadMode = Object.values(modeModules)[0];
    if (loadMode) {
      try {
        const m = await loadMode();
        if (m.CAPABILITIES) capabilities = new Set(keys(m.CAPABILITIES));
      } catch {
        capabilities = null;
      }
    }
    const own = typeof mod.localStatus === "function" ? (mod.localStatus as (n: string) => { kind: string; capability?: string; phase?: string }) : null;
    const status = (raw: string): Status => {
      const name = canonicalName(raw);
      if (own) {
        const s = own(name);
        if (s.kind === "ported") return { kind: "ported" };
        if (s.kind === "hidden") return { kind: "hidden", capability: String(s.capability ?? "") };
        if (s.kind === "planned") return { kind: "planned", phase: String(s.phase ?? "") };
        return { kind: "unclassified" };
      }
      if (keys(mod.LOCAL_FUNCTIONS).map(canonicalName).includes(name)) return { kind: "ported" };
      const hidden = lookup(mod.LOCAL_HIDDEN, name);
      if (hidden !== undefined) return { kind: "hidden", capability: typeof hidden === "string" ? hidden : String((hidden as { capability?: unknown })?.capability ?? "") };
      const planned = lookup(mod.LOCAL_PLANNED, name);
      if (planned !== undefined) return { kind: "planned", phase: String(planned) };
      return { kind: "unclassified" };
    };
    return { ready: true, status, ported: (name) => status(name).kind === "ported", capabilities, handlerErrors };
  })();
  return cached;
}
