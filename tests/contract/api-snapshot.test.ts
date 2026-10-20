// @vitest-environment node
// The apps carry their interface built in (docs/LOCAL_MODE_PLAN.md §5.3, risk R1), so a Mac app from months
// ago still calls today's backend the way it was built to. This records, for every Convex function the
// product calls (the parity harness's list, tests/parity/callers.ts), its kind, its argument validator and
// its result type, in api-snapshot.json, and fails when a change would break an app that shipped with the
// recorded version:
// - arguments: the new validator must accept everything the recorded one did (no new required argument, no
//   argument removed, nothing narrowed), since old apps keep sending what they sent;
// - results: everything the function can return now must fit the recorded type (no field removed or made
//   optional, nothing widened), since old apps keep reading what they read. New fields are fine.
// A function the product stops calling, or that changes kind, is a break too. Additions pass and are listed.
//
// After an intentional change, update the record:
//   pnpm contract:update        (UPDATE_API_SNAPSHOT=1 npx vitest run --project contract)
// and for a breaking one also raise MIN_SHELL_VERSIONS in convex/lib/shellVersions.ts to the first app version
// that copes with it, so older apps ask to be updated ("Update Folevi to keep syncing") instead of failing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { calledFunctions, ROOT } from "../parity/callers";
import { fromType, fromValidator, notSubset, type Shape } from "./shape";

type Kind = "query" | "mutation" | "action";
type Entry = { kind: Kind; args: Shape; returns: Shape };
type Snapshot = { functions: Record<string, Entry> };

const SNAPSHOT = join(ROOT, "tests/contract/api-snapshot.json");
const UPDATE = "pnpm contract:update";
const modules = import.meta.glob<Record<string, unknown>>(["../../convex/*.ts", "!../../convex/*.d.ts"]);

type Registered = { isQuery?: boolean; isMutation?: boolean; isAction?: boolean; isPublic?: boolean; exportArgs?: () => string };

async function argShapes(names: string[]): Promise<Map<string, { kind: Kind; args: Shape }>> {
  const out = new Map<string, { kind: Kind; args: Shape }>();
  for (const name of names) {
    const [mod, fn] = name.split(":") as [string, string];
    const load = modules[`../../convex/${mod}.ts`];
    if (!load) throw new Error(`convex/${mod}.ts not found`);
    const f = (await load())[fn] as Registered | undefined;
    if (!f || typeof f.exportArgs !== "function") throw new Error(`${name} isn't a registered Convex function`);
    const kind: Kind = f.isQuery ? "query" : f.isMutation ? "mutation" : "action";
    out.set(name, { kind, args: fromValidator(JSON.parse(f.exportArgs())) });
  }
  return out;
}

/** The result types, read by TypeScript from convex/ (FunctionReturnType of each api reference). */
function returnShapes(names: string[]): Map<string, Shape> {
  const configPath = join(ROOT, "convex/tsconfig.json");
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, dirname(configPath));
  const probe = join(ROOT, "convex/__api_snapshot_probe__.ts");
  const source = [
    `import type { FunctionReturnType } from "convex/server";`,
    `import type { api } from "./_generated/api";`,
    ...names.map((n, i) => {
      const [mod, fn] = n.split(":") as [string, string];
      return `export type R${i} = FunctionReturnType<typeof api.${mod}.${fn}>;`;
    }),
  ].join("\n");
  const host = ts.createCompilerHost(config.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, lang, onError, create) => (file === probe ? ts.createSourceFile(file, source, lang) : getSourceFile(file, lang, onError, create));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (file) => file === probe || fileExists(file);
  const program = ts.createProgram({ rootNames: [probe], options: { ...config.options, noEmit: true }, host });
  const errors = ts.getPreEmitDiagnostics(program, program.getSourceFile(probe)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  if (errors.length) throw new Error(`The snapshot probe doesn't type-check:\n${errors.slice(0, 5).join("\n")}`);
  const checker = program.getTypeChecker();
  const out = new Map<string, Shape>();
  const file = program.getSourceFile(probe)!;
  file.statements.forEach((s) => {
    if (!ts.isTypeAliasDeclaration(s)) return;
    const i = Number(s.name.text.slice(1));
    out.set(names[i]!, fromType(checker, checker.getTypeAtLocation(s.name)));
  });
  return out;
}

async function current(): Promise<Snapshot> {
  const names = calledFunctions();
  const args = await argShapes(names);
  const returns = returnShapes(names);
  const functions: Record<string, Entry> = {};
  for (const n of names) functions[n] = { kind: args.get(n)!.kind, args: args.get(n)!.args, returns: returns.get(n)! };
  return { functions };
}

/** What would break an app built against `recorded`, function by function. */
function breakingChanges(recorded: Snapshot, now: Snapshot): string[] {
  const out: string[] = [];
  for (const [name, old] of Object.entries(recorded.functions)) {
    const next = now.functions[name];
    if (!next) {
      out.push(`${name}: no longer called by the product (removed or renamed?)`);
      continue;
    }
    if (next.kind !== old.kind) out.push(`${name}: was a ${old.kind}, now a ${next.kind}`);
    for (const p of notSubset(old.args, next.args, true, "args")) out.push(`${name}: ${p}`);
    for (const p of notSubset(next.returns, old.returns, false, "returns")) out.push(`${name}: ${p}`);
  }
  return out;
}

/** One function per line, sorted, so a change shows up as that function's line in a diff. */
const stable = (s: Snapshot) => {
  const lines = Object.entries(s.functions)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, e]) => `  ${JSON.stringify(name)}: ${JSON.stringify(e)}`);
  return `{\n "functions": {\n${lines.join(",\n")}\n }\n}\n`;
};

describe("the shell's API contract", () => {
  test("no breaking change to a function the built-in interface calls", async () => {
    const now = await current();
    expect(Object.keys(now.functions).length, "the product's Convex calls were found").toBeGreaterThan(100);
    if (process.env.UPDATE_API_SNAPSHOT === "1" || !existsSync(SNAPSHOT)) {
      writeFileSync(SNAPSHOT, stable(now));
      console.info(`[api snapshot] recorded ${Object.keys(now.functions).length} functions in tests/contract/api-snapshot.json`);
      return;
    }
    const recorded = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
    const breaking = breakingChanges(recorded, now);
    const added = Object.keys(now.functions).filter((n) => !recorded.functions[n]);
    const changed = Object.keys(now.functions).filter((n) => recorded.functions[n] && JSON.stringify(recorded.functions[n]) !== JSON.stringify(now.functions[n]));
    if (!breaking.length && (added.length || changed.length)) {
      console.info(
        `[api snapshot] compatible changes (${added.length} added, ${changed.length} changed): ${[...added, ...changed].join(", ")}. Record them with: ${UPDATE}`,
      );
    }
    expect(
      breaking,
      `Breaking for apps built against the recorded API. If intentional: raise MIN_SHELL_VERSIONS (convex/lib/shellVersions.ts) and run ${UPDATE}`,
    ).toEqual([]);
  }, 180_000);
});

describe("breaking-change rules", () => {
  const entry = (args: Shape, returns: Shape, kind: Kind = "query"): Entry => ({ kind, args, returns });
  const obj = (props: Record<string, Shape>, optional: string[] = []): Shape => ({
    t: "object",
    props: Object.fromEntries(Object.entries(props).map(([k, type]) => [k, optional.includes(k) ? { type, optional: true as const } : { type }])),
  });
  const str: Shape = { t: "string" };
  const num: Shape = { t: "number" };
  const check = (old: Entry, next: Entry) => breakingChanges({ functions: { "x:f": old } }, { functions: { "x:f": next } });

  test("arguments: adding an optional one is fine; a new required one, a removed one or a narrower type breaks", () => {
    const base = entry(obj({ id: str }), num);
    expect(check(base, entry(obj({ id: str, limit: num }, ["limit"]), num))).toEqual([]);
    expect(check(base, entry(obj({ id: str, limit: num }), num))).toEqual(["x:f: args.limit: required, and missing"]);
    expect(check(base, entry(obj({}), num))).toEqual(["x:f: args.id: no longer accepted"]);
    expect(check(base, entry(obj({ id: { t: "id", table: "documents" } }), num))).toHaveLength(1);
    expect(check(entry(obj({ id: str }, ["id"]), num), entry(obj({ id: str }), num))).toEqual(["x:f: args.id: required, but may be missing"]);
    // Widening is fine.
    expect(check(entry(obj({ v: { t: "literal", v: "a" } }), num), entry(obj({ v: str }), num))).toEqual([]);
  });

  test("results: adding a field is fine; removing one, making it optional or widening it breaks", () => {
    const base = entry(obj({}), obj({ title: str, n: num }));
    expect(check(base, entry(obj({}), obj({ title: str, n: num, extra: str })))).toEqual([]);
    expect(check(base, entry(obj({}), obj({ title: str })))).toEqual(["x:f: returns.n: required, and missing"]);
    expect(check(base, entry(obj({}), obj({ title: str, n: num }, ["n"])))).toEqual(["x:f: returns.n: required, but may be missing"]);
    expect(check(base, entry(obj({}), obj({ title: { t: "union", of: [{ t: "null" }, str] }, n: num })))).toHaveLength(1);
    // Narrowing a result is fine.
    expect(check(entry(obj({}), str), entry(obj({}), { t: "literal", v: "x" }))).toEqual([]);
  });

  test("a function removed or changing kind breaks", () => {
    expect(breakingChanges({ functions: { "x:f": entry(obj({}), num) } }, { functions: {} })).toHaveLength(1);
    expect(check(entry(obj({}), num), entry(obj({}), num, "mutation"))).toEqual(["x:f: was a query, now a mutation"]);
  });
});
