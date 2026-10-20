// Which server functions local mode has, and what each one does here (docs/LOCAL_MODE_PLAN.md §2.4, §2.5).
//
//   defineLocal(api.documents.get, "query", async (ctx, args) => ...)
//
// registers a local handler for a server function. Its arguments and its return type are the server's
// (FunctionArgs / FunctionReturnType of the reference), so when the server changes a shape, local mode fails
// to typecheck. The kind is given explicitly because `api.x.y` carries only its name at runtime (`_type` is a
// type); the type parameter checks that it matches the server's.
//
// Every function the client calls is one of: ported (LOCAL_FUNCTIONS), hidden in local mode behind a
// capability (LOCAL_HIDDEN; its interface isn't shown, lib/mode.ts), or not ported yet (LOCAL_PLANNED, by
// phase). Calling anything that isn't ported throws ConvexError({ code: "local_unsupported" }), and in
// development says so loudly in the console.
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { getFunctionName } from "convex/server";
import type { Capability } from "@/lib/backendMode";
import { localUnsupported } from "./errors";
import type { LocalSearchIndex } from "./search";
import type { LocalTable, LocalTables, StoreWrite } from "./store";

export type LocalKind = "query" | "mutation" | "action";

export interface LocalReader {
  get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined>;
  list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]>;
  /**
   * The live blocks of the given types in every note (tasks read to-dos, study reads cards), without reading
   * each note's blocks. Dependency key: `blocks:any`. Order is unspecified. Call it through store.ts
   * `blocksOfTypes(db, types)`, which scans when a reader doesn't have it.
   */
  blocksOfTypes?(types: readonly string[]): Promise<LocalTables["blocks"][]>;
}

export interface LocalWriter extends LocalReader {
  /** Seen by later reads in the same mutation; stored when the mutation returns. */
  put<T extends LocalTable>(table: T, id: string, value: LocalTables[T], partition?: string): void;
  remove(table: LocalTable, id: string, partition?: string): void;
}

interface LocalBaseCtx {
  /** This device (the sync engine's device id when the call is sync.push). */
  deviceId: string;
  now(): number;
}

export interface LocalQueryCtx extends LocalBaseCtx {
  db: LocalReader;
  /**
   * The library's search index (lib/local/search), loaded on first use. It isn't a table: a search reads the
   * rows it indexes through `db` (so it re-runs when they change) and brings the index up to date with them.
   */
  searchIndex(): Promise<LocalSearchIndex>;
  /**
   * Records a dependency on in-memory state outside the library (volatile.ts): a Foli AI answer being written
   * (`stream:<id>`), what the active model can do (`ai:state`). The query re-runs when it's touched.
   */
  watch?(key: string): void;
}

export interface LocalMutationCtx extends LocalBaseCtx {
  db: LocalWriter;
  /** The change counter for this mutation's writes: one number per mutation, like the server's per batch. */
  nextSeq(): Promise<number>;
  /**
   * Runs `job` once this mutation has committed (the server's `scheduler.runAfter(0, ...)`): a repeating
   * to-do coming back, a calendar fetch. Nothing runs if the mutation throws. The job runs outside any
   * mutation, so it may wait on the network, and writes through `ctx.mutate`.
   */
  runAfter(job: (ctx: LocalJobCtx) => Promise<void>): void;
}

/** What a job started by `runAfter` gets. */
export interface LocalJobCtx extends LocalBaseCtx {
  /** Runs `fn` as a mutation of its own (in order with every other mutation) and commits what it wrote. */
  mutate<T>(fn: (ctx: LocalMutationCtx) => T | Promise<T>): Promise<T>;
}

/**
 * Runs inside every mutation just before it commits, with the writes it's about to make (the server keeps
 * derived rows in step this way, lib/documents.ts syncTaskProjection). `before` reads a row as it was before
 * this mutation. A trigger may write more (they're committed with the rest) and start jobs (`runAfter`);
 * what a trigger writes doesn't run the triggers again. `origin` is "disk" for changes read from the library
 * (another device's edits): what that device already did in reply to them isn't done again here.
 */
export type LocalTrigger = (ctx: LocalMutationCtx, writes: readonly StoreWrite[], before: LocalReader["get"], origin: "local" | "disk") => Promise<void>;

const triggers = new Map<string, LocalTrigger>();

/** The triggers, by name (backend.ts runs them). */
export const LOCAL_TRIGGERS: ReadonlyMap<string, LocalTrigger> = triggers;

/** Registers a trigger (see LocalTrigger). Registering a name twice is a mistake and throws. */
export function defineTrigger(name: string, trigger: LocalTrigger): void {
  if (triggers.has(name)) throw new Error(`The trigger ${name} is already registered.`);
  triggers.set(name, trigger);
}

export interface LocalActionCtx extends LocalBaseCtx {
  runQuery<Ref extends FunctionReference<"query">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>>;
  runMutation<Ref extends FunctionReference<"mutation">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>>;
  /**
   * Runs `fn` as a mutation of its own (in order with every other mutation): what the server's actions do
   * through internal queries and mutations (files.finalize, exports.exportScope read and write this way).
   */
  mutate<T>(fn: (ctx: LocalMutationCtx) => T | Promise<T>): Promise<T>;
}

export type LocalCtxOf<K extends LocalKind> = K extends "query" ? LocalQueryCtx : K extends "mutation" ? LocalMutationCtx : LocalActionCtx;

export interface LocalFunction {
  name: string;
  kind: LocalKind;
  handler: (ctx: never, args: never) => unknown;
}

const functions = new Map<string, LocalFunction>();

/** The ported functions, by name ("documents:get"). */
export const LOCAL_FUNCTIONS: ReadonlyMap<string, LocalFunction> = functions;

type AnyPublicRef = FunctionReference<LocalKind, "public">;

/** Registers the local handler for a server function. Registering a name twice is a mistake and throws. */
export function defineLocal<Ref extends AnyPublicRef, K extends Ref["_type"] & LocalKind>(
  ref: Ref,
  kind: K,
  handler: (ctx: LocalCtxOf<K>, args: FunctionArgs<Ref>) => FunctionReturnType<Ref> | Promise<FunctionReturnType<Ref>>,
): void {
  const name = getFunctionName(ref);
  if (functions.has(name)) throw new Error(`${name} already has a local handler.`);
  functions.set(name, { name, kind, handler: handler as LocalFunction["handler"] });
}

/** Removes a handler (tests that register their own). */
export function undefineLocal(ref: AnyPublicRef): void {
  functions.delete(getFunctionName(ref));
}

/**
 * Hidden in local mode: the interface that calls these is behind the capability named (lib/mode.ts
 * useCapabilities), so they're never called. `module:*` covers a whole module.
 */
export const LOCAL_HIDDEN: Readonly<Record<string, Capability>> = {
  "sharing:*": "sharing",
  "workspaces:*": "workspaces",
  "workspaceBilling:*": "billing",
  "billing:*": "billing",
  "apiTokens:*": "connectedApps",
  "webhooks:*": "connectedApps",
  "mcp:*": "connectedApps",
  "emailNotes:*": "emailToNote",
  "comments:*": "comments",
  "presence:*": "presence",
  "push:*": "pushNotifications",
  "proposals:*": "changes",
  "changes:*": "changes",
  "calendarFeeds:*": "calendarFeeds",
  "routines:*": "aiServer",
  "aiDigest:*": "aiServer",
  "aiResearch:*": "aiServer",
  "aiSharing:*": "aiServer",
  "aiSuggestions:*": "aiServer",
  "aiAttachments:*": "aiServer",
  // The graph's suggestions read the server's embeddings; the graph itself (links only) is planned for L3.
  "aiGraph:duplicates": "aiServer",
  "aiGraph:contradictions": "aiServer",
  "aiGraph:missingConnections": "aiServer",
  "aiGraph:linkNote": "aiServer",
  "search:byMeaning": "semanticSearch",
  "fileText:readImage": "aiServer",
  "unsplash:*": "stockPhotos",
  "copies:copyTo": "copyTo",
  "users:listSessions": "account",
  "users:revokeSession": "account",
  "users:revokeOtherSessions": "account",
  "users:registerSession": "account",
  "users:heartbeat": "account",
  "users:bootstrap": "account",
  "users:deletionBlockers": "account",
  "users:requestAccountDeletion": "account",
  "users:cancelAccountDeletion": "account",
  "support:*": "account",
  "signInOptions:*": "account",
  "passkeyUsage:*": "account",
  "authEmails:*": "account",
  "notifications:*": "notifications",
  // Whether a library fits in the account it moves to (lib/migrate): asked of the account, never of a library.
  "migration:preflight": "account",
};

/**
 * Not ported yet, by the phase that ports them (§2.4). The parity coverage test (WP8a) can allow these
 * while the list shrinks; anything in none of the three lists is unclassified.
 */
export const LOCAL_PLANNED: Readonly<Record<string, "L1" | "L2" | "L3" | "L4">> = {
  "bookmarks:preview": "L3",
  "aiGraph:graph": "L3",
  "aiGraph:related": "L3",
  // Foli AI's agent comes later, and only with the person's own key (WP11 ported the rest of L4: lib/local/ai).
  "aiAgent:*": "L4",
};

/** `documents:list` from either spelling ("documents.list" is how the source writes it). */
function normalize(name: string): string {
  return name.includes(":") ? name : name.replace(/\.(?=[^.]*$)/, ":");
}

function lookup<T>(table: Readonly<Record<string, T>>, name: string): T | undefined {
  return table[name] ?? table[`${name.slice(0, name.indexOf(":"))}:*`];
}

export type LocalStatus = { kind: "ported"; fn: LocalFunction } | { kind: "hidden"; capability: Capability } | { kind: "planned"; phase: "L1" | "L2" | "L3" | "L4" } | { kind: "unclassified" };

/** What local mode does with a function (ported first: a ported function in a planned module is ported). */
export function localStatus(name: string): LocalStatus {
  const n = normalize(name);
  const fn = functions.get(n);
  if (fn) return { kind: "ported", fn };
  const capability = lookup(LOCAL_HIDDEN, n);
  if (capability) return { kind: "hidden", capability };
  const phase = lookup(LOCAL_PLANNED, n);
  if (phase) return { kind: "planned", phase };
  return { kind: "unclassified" };
}

const warned = new Set<string>();

/** The handler for a call, or the `local_unsupported` error (logged once per function in development). */
export function resolveLocal(name: string, kind: LocalKind): LocalFunction {
  const status = localStatus(name);
  if (status.kind === "ported") {
    if (status.fn.kind !== kind) throw new Error(`${name} is a ${status.fn.kind} and was called as a ${kind}.`);
    return status.fn;
  }
  const capability = status.kind === "hidden" ? status.capability : undefined;
  if (process.env.NODE_ENV !== "production" && !warned.has(name)) {
    warned.add(name);
    console.error(
      `[local mode] ${name} has no local handler (${status.kind === "hidden" ? `hidden behind "${capability}": its interface should not be showing` : status.kind === "planned" ? `planned for ${status.phase}` : "unclassified: add it to lib/local/registry.ts"}).`,
    );
  }
  throw localUnsupported(name, capability);
}
