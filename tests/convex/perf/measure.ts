// Read costs of one function call in convex-test: documents read, bytes read and index ranges, counted the
// way Convex counts them (convex-test's transaction metrics), with Convex's per-function limits enforced, so
// a query that would fail in production fails here too. Used by the backend performance tests and baseline.
import { convexTest } from "convex-test";
import { TransactionMetricsTracker } from "convex-test/dist/transactionMetrics.js";
import schema from "../../../convex/schema";
import authSchema from "../../../convex/betterAuth/schema";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { authModules, modules } from "../setup";
import { FAKE_LIBRARY } from "../../../convex/lib/fakeLibrary";

export interface Cost {
  name: string;
  ms: number;
  documentsRead: number;
  bytesRead: number;
  databaseQueries: number;
  documentsWritten: number;
  bytesWritten: number;
  error?: string;
}

type Metrics = Omit<Cost, "name" | "ms" | "error">;
type Layer = { metrics: Metrics };
type Tracker = { _layers: Layer[] };

let last: Metrics | null = null;
const proto = TransactionMetricsTracker.prototype as unknown as { commit(): void; rollback(): void };
for (const key of ["commit", "rollback"] as const) {
  const original = proto[key];
  proto[key] = function (this: Tracker) {
    // The outermost layer is the function the test called; keep its totals before it is popped.
    if (this._layers.length === 1) last = { ...this._layers[0]!.metrics };
    return original.call(this);
  };
}

/** A convex-test backend with Convex's transaction limits on (16 MiB and 32,000 documents read, and so on). */
export function limitedSetup() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent("betterAuth", authSchema, authModules);
  return t;
}

/** Runs `fn` (one query or mutation) and returns what it read. */
export async function measure(name: string, fn: () => Promise<unknown>): Promise<Cost & { result?: unknown }> {
  last = null;
  const start = performance.now();
  try {
    const result = await fn();
    return { name, ms: Math.round(performance.now() - start), ...(last ?? zero()), result };
  } catch (e) {
    return { name, ms: Math.round(performance.now() - start), ...(last ?? zero()), error: (e as Error).message.split("\n")[0]!.slice(0, 120) };
  }
}

const zero = (): Metrics => ({ documentsRead: 0, bytesRead: 0, databaseQueries: 0, documentsWritten: 0, bytesWritten: 0 });

/** Fills `email`'s Personal with the generated library (convex/devSeed.ts), `notes` notes of it. */
export async function seedLibrary(t: ReturnType<typeof limitedSetup>, email: string, notes: number = FAKE_LIBRARY.notes) {
  const { folderIds, tagIds } = (await t.mutation(internal.devSeed.seedFolders, { email })) as { folderIds: Id<"folders">[]; tagIds: Id<"tags">[] };
  for (let from = 0; from < notes; from += 100) await t.mutation(internal.devSeed.seedNotes, { email, folderIds, tagIds, from, count: Math.min(100, notes - from) });
  return { folderIds, tagIds };
}

const kb = (b: number) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1 << 20)).toFixed(2)} MB`);

/** A Markdown table of costs. */
export function table(costs: Cost[]): string {
  const rows = costs.map((c) => `| ${c.name} | ${c.documentsRead} | ${kb(c.bytesRead)} | ${c.databaseQueries} | ${c.documentsWritten} | ${c.ms} | ${c.error ? `fails: ${c.error}` : "ok"} |`);
  return ["| Function | Docs read | Bytes read | Index ranges | Docs written | ms (convex-test) | Result |", "|---|---:|---:|---:|---:|---:|---|", ...rows].join("\n");
}
