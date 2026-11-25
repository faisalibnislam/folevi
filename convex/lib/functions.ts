// Every mutation of the app is built here (not straight from _generated/server), so writes to a few tables
// keep their derived rows in step wherever they happen: a note's folder and Drafts stats (lib/listStats.ts),
// its search text row (lib/documentText.ts) and its task rows' title.
// The wrapper sees each insert, patch, replace and delete of a watched table with the row before and after;
// other tables pass straight through. Reads are untouched.
import { internalMutation as rawInternalMutation, mutation as rawMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { documentWritten, folderWritten, scopeCreated } from "./listStats";
import { clearTaskLabels } from "./documents";
import { documentTextWritten } from "./documentText";
import { personalScope, workspaceScope } from "./scope";

type Watched = "documents" | "folders";
const WATCHED: readonly Watched[] = ["documents", "folders"];
/** Tables whose new rows start derived rows (a new Personal or workspace starts its Drafts stats). */
const ON_INSERT: readonly TableNames[] = ["profiles", "workspaces"];

async function fire(ctx: MutationCtx, table: Watched, before: Doc<Watched> | null, after: Doc<Watched> | null) {
  if (table === "documents") {
    const b = before as Doc<"documents"> | null;
    const a = after as Doc<"documents"> | null;
    await documentWritten(ctx, b, a);
    await documentTextWritten(ctx, b, a);
    if (b && a && (b.sealedAt === undefined) !== (a.sealedAt === undefined)) await clearTaskLabels(ctx, a._id);
  }
  else await folderWritten(ctx, before as Doc<"folders"> | null, after as Doc<"folders"> | null);
}

/** A patch applied the way Convex applies it: fields set to undefined are removed. */
function patched<T extends Record<string, unknown>>(row: T, value: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

/** ctx.db with the watched tables' writes reported to their handlers (the raw db is passed to them). */
export function watchedDb(ctx: MutationCtx): MutationCtx["db"] {
  const db = ctx.db;
  const tableOf = (id: string): Watched | null => {
    for (const t of WATCHED) if (db.normalizeId(t, id) !== null) return t;
    return null;
  };
  // (table, id, value) or (id, value): the table, id and value either way.
  const resolve = (args: unknown[]): { table: TableNames | null; id: string; value: unknown } =>
    typeof args[1] === "string" && args.length >= 3 ? { table: args[0] as TableNames, id: args[1], value: args[2] } : { table: null, id: args[0] as string, value: args[1] };
  const watched = (table: TableNames | null, id: string): Watched | null => (table ? ((WATCHED as readonly string[]).includes(table) ? (table as Watched) : null) : tableOf(id));

  const wrapped = {
    async insert(table: TableNames, value: Record<string, unknown>) {
      const id = await db.insert(table, value as never);
      if ((WATCHED as readonly string[]).includes(table)) await fire(ctx, table as Watched, null, { ...value, _id: id, _creationTime: Date.now() } as never);
      else if (ON_INSERT.includes(table)) await scopeCreated(ctx, table === "profiles" ? personalScope(id as Id<"profiles">) : workspaceScope(id as Id<"workspaces">));
      return id;
    },
    async patch(...args: unknown[]) {
      const { table, id, value } = resolve(args);
      const w = watched(table, id);
      const before = w ? ((await db.get(id as Id<Watched>)) as Doc<Watched> | null) : null;
      await (db.patch as (...a: unknown[]) => Promise<void>)(...args);
      if (w && before) await fire(ctx, w, before, patched(before, value as Record<string, unknown>));
    },
    async replace(...args: unknown[]) {
      const { table, id, value } = resolve(args);
      const w = watched(table, id);
      const before = w ? ((await db.get(id as Id<Watched>)) as Doc<Watched> | null) : null;
      await (db.replace as (...a: unknown[]) => Promise<void>)(...args);
      if (w && before) await fire(ctx, w, before, { ...(value as object), _id: before._id, _creationTime: before._creationTime } as never);
    },
    async delete(...args: unknown[]) {
      const { table, id } = args.length >= 2 ? { table: args[0] as TableNames, id: args[1] as string } : { table: null, id: args[0] as string };
      const w = watched(table, id);
      const before = w ? ((await db.get(id as Id<Watched>)) as Doc<Watched> | null) : null;
      await (db.delete as (...a: unknown[]) => Promise<void>)(...args);
      if (w && before) await fire(ctx, w, before, null);
    },
  };
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop in wrapped) return wrapped[prop as keyof typeof wrapped];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** A mutation context whose db reports watched writes (and whose nested helpers see the same db). */
function withWatchedDb<C extends MutationCtx>(ctx: C): C {
  return { ...ctx, db: watchedDb(ctx) };
}

type Definition = { handler: (ctx: MutationCtx, args: never) => unknown } & Record<string, unknown>;

function wrap<B extends (def: never) => unknown>(builder: B): B {
  return ((def: Definition | Definition["handler"]) => {
    const d: Definition = typeof def === "function" ? { handler: def } : def;
    return (builder as unknown as (d: Definition) => unknown)({ ...d, handler: (ctx: MutationCtx, args: never) => d.handler(withWatchedDb(ctx), args) });
  }) as unknown as B;
}

/** `mutation` from _generated/server, with watched writes kept in step. */
export const mutation = wrap(rawMutation);
/** `internalMutation` from _generated/server, with watched writes kept in step. */
export const internalMutation = wrap(rawInternalMutation);
