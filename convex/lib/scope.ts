// Scopes: where content lives. Personal is not a workspace.
//
//   { kind: "personal", profileId }    a person's own Personal (rows carry `ownerProfileId`)
//   { kind: "workspace", workspaceId } a team workspace (rows carry `workspaceId`)
//
// Every content row has exactly one of `ownerProfileId` / `workspaceId`. Rows are written through
// `insertScoped` (the one write path; tests/convex/static checks nothing inserts into a scoped table any
// other way) and read back with `scopeOfRow`. Clients name a scope with `vScopeArg`; a Personal scope is
// always the caller's own: a profile id is never taken from the client (see lib/auth.ts resolveScope).
import { v, type Infer } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

export type Scope = { kind: "personal"; profileId: Id<"profiles"> } | { kind: "workspace"; workspaceId: Id<"workspaces"> };
export type PersonalScope = Extract<Scope, { kind: "personal" }>;
export type WorkspaceScope = Extract<Scope, { kind: "workspace" }>;

/** A scope as a client names it: Personal (always the caller's own) or a team workspace by public id. */
export const vScopeArg = v.union(v.object({ kind: v.literal("personal") }), v.object({ kind: v.literal("workspace"), workspaceId: v.string() }));
export type ScopeArg = Infer<typeof vScopeArg>;

/** A resolved scope passed between internal functions (never accepted from clients). */
export const vScope = v.union(
  v.object({ kind: v.literal("personal"), profileId: v.id("profiles") }),
  v.object({ kind: v.literal("workspace"), workspaceId: v.id("workspaces") }),
);

export const personalScope = (profileId: Id<"profiles">): PersonalScope => ({ kind: "personal", profileId });
export const workspaceScope = (workspaceId: Id<"workspaces">): WorkspaceScope => ({ kind: "workspace", workspaceId });

/** Tables whose rows belong to a scope. */
export const SCOPED_TABLES = [
  "folders",
  "tags",
  "documentTags",
  "documents",
  "documentLinks",
  "stars",
  "recents",
  "recentHidden",
  "blocks",
  "documentSnapshots",
  "tasks",
  "collections",
  "commentThreads",
  "comments",
  "documentPermissions",
  "publicLinks",
  "pageInvites",
  "noteSubscriptions",
  "files",
  "uploadIntents",
  "syncOperations",
  "aiConversations",
  "aiMessages",
  "aiChunks",
  "aiIndexState",
  "aiIndexScopes",
] as const satisfies readonly TableNames[];
export type ScopedTable = (typeof SCOPED_TABLES)[number];

export interface ScopedRow {
  workspaceId?: Id<"workspaces">;
  ownerProfileId?: Id<"profiles">;
}

/** Whether a row has exactly one scope field (what every content row must have). */
export function hasValidScope(row: ScopedRow): boolean {
  return (row.workspaceId === undefined) !== (row.ownerProfileId === undefined);
}

/**
 * The scope a content row belongs to. A row with both or neither field is a bug (verifyAccountModel
 * reports them); it's treated as missing rather than guessed at.
 */
export function scopeOfRow(row: ScopedRow): Scope {
  if (!hasValidScope(row)) fail("not_found", "Not found.");
  return row.ownerProfileId !== undefined ? personalScope(row.ownerProfileId) : workspaceScope(row.workspaceId!);
}

/** The scope fields for a row in `scope`: exactly one of `ownerProfileId` / `workspaceId`. */
export function scopeFields(scope: Scope): { ownerProfileId: Id<"profiles"> } | { workspaceId: Id<"workspaces"> } {
  return scope.kind === "personal" ? { ownerProfileId: scope.profileId } : { workspaceId: scope.workspaceId };
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.kind === "personal" ? b.kind === "personal" && a.profileId === b.profileId : b.kind === "workspace" && a.workspaceId === b.workspaceId;
}

/** Whether a row belongs to `scope`. */
export function inScope(row: ScopedRow, scope: Scope): boolean {
  return hasValidScope(row) && sameScope(scopeOfRow(row), scope);
}

/** Whether two rows belong to the same scope. */
export function sameScopeRows(a: ScopedRow, b: ScopedRow): boolean {
  return hasValidScope(a) && hasValidScope(b) && sameScope(scopeOfRow(a), scopeOfRow(b));
}

/** A stable key for maps and rate-limit subjects. */
export function scopeKey(scope: Scope): string {
  return scope.kind === "personal" ? `p:${scope.profileId}` : `w:${scope.workspaceId}`;
}

/** For each scoped table, an index whose first field is `workspaceId` / `ownerProfileId`. */
const WORKSPACE_INDEX: Record<ScopedTable, string> = {
  folders: "by_workspace",
  tags: "by_workspace",
  documentTags: "by_workspace",
  documents: "by_workspace_created",
  documentLinks: "by_workspace",
  stars: "by_workspace",
  recents: "by_workspace",
  recentHidden: "by_workspace",
  blocks: "by_workspace_seq",
  documentSnapshots: "by_workspace",
  tasks: "by_workspace_status_due",
  collections: "by_workspace",
  commentThreads: "by_workspace",
  comments: "by_workspace",
  documentPermissions: "by_workspace",
  publicLinks: "by_workspace",
  pageInvites: "by_workspace",
  noteSubscriptions: "by_workspace",
  files: "by_workspace",
  uploadIntents: "by_workspace",
  syncOperations: "by_workspace",
  aiConversations: "by_workspace",
  aiMessages: "by_workspace",
  aiChunks: "by_workspace",
  aiIndexState: "by_workspace",
  aiIndexScopes: "by_workspace",
};
const OWNER_INDEX: Record<ScopedTable, string> = {
  folders: "by_owner",
  tags: "by_owner",
  documentTags: "by_owner",
  documents: "by_owner_created",
  documentLinks: "by_owner",
  stars: "by_owner",
  recents: "by_owner",
  recentHidden: "by_owner",
  blocks: "by_owner_seq",
  documentSnapshots: "by_owner",
  tasks: "by_owner_status_due",
  collections: "by_owner",
  commentThreads: "by_owner",
  comments: "by_owner",
  documentPermissions: "by_owner",
  publicLinks: "by_owner",
  pageInvites: "by_owner",
  noteSubscriptions: "by_owner",
  files: "by_owner",
  uploadIntents: "by_owner",
  syncOperations: "by_owner",
  aiConversations: "by_owner",
  aiMessages: "by_owner",
  aiChunks: "by_owner",
  aiIndexState: "by_owner",
  aiIndexScopes: "by_owner",
};

export type AnyScopedRow = ScopedRow & { _id: Id<ScopedTable>; _creationTime: number };
interface LooseRange {
  eq(field: string, value: unknown): LooseRange;
}
interface LooseQuery {
  withIndex(name: string, range: (q: LooseRange) => LooseRange): { take(n: number): Promise<AnyScopedRow[]> };
}

/**
 * Up to `n` rows of any scoped table in a scope, through the table's scope index, for table-generic
 * sweeps (account purge, the account-model migration). Typed loosely because the table is a variable.
 */
export async function scopedRows(ctx: QueryCtx, table: ScopedTable, scope: Scope, n: number): Promise<AnyScopedRow[]> {
  const query = ctx.db.query(table) as unknown as LooseQuery;
  return scope.kind === "personal"
    ? await query.withIndex(OWNER_INDEX[table], (q) => q.eq("ownerProfileId", scope.profileId)).take(n)
    : await query.withIndex(WORKSPACE_INDEX[table], (q) => q.eq("workspaceId", scope.workspaceId)).take(n);
}

type ScopedInsert<T extends ScopedTable> = Omit<WithoutSystemFields<Doc<T>>, "workspaceId" | "ownerProfileId">;

/**
 * The one write path for new content rows: sets exactly one scope field. Never insert into a scoped table
 * directly (tests/convex/static/invariants.test.ts enforces it).
 */
export async function insertScoped<T extends ScopedTable>(ctx: MutationCtx, table: T, scope: Scope, value: ScopedInsert<T>): Promise<Id<T>> {
  const row = { ...(value as Record<string, unknown>), ...scopeFields(scope) };
  delete (row as ScopedRow)[scope.kind === "personal" ? "workspaceId" : "ownerProfileId"];
  return await ctx.db.insert(table, row as unknown as WithoutSystemFields<Doc<T>>);
}
