// Connected apps (MCP): the database side of Folevi's MCP server (convex/mcpServer.ts handles HTTP).
//
// A connected app (Claude, ChatGPT, Cursor, …) holds an OAuth access token from Better Auth's OAuth
// provider (convex/auth.ts). Every request is checked here: the token (by its hash), the person behind it,
// and their grant for that app, made on the consent screen (/oauth/consent): which places it may use, what
// it may do (scopes), whether it may read pages shared from elsewhere, and whether it may change what's
// already written. Then the tool runs as that person, never seeing more than they can.
//
// Writes go through the sync engine like any other device's edits ("mcp:<client>"), with a version saved
// before an existing note changes, so everything shows in version history and can be undone there. Each
// call is recorded in mcpEvents (arguments never stored), shown under Settings → Connected apps.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { blocksToMarkdown, folderPath, localDate, markdownToBlocks, rankBetween, rankSequence, repeatProps, taskViews, LIMITS, SCHEMA_VERSION, ulid, type RepeatRule, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, membership, PageReader, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { createDocument } from "./lib/create";
import { inScope, personalScope, scopeOfRow, type Scope, type ScopeArg } from "./lib/scope";
import { SyncEngine } from "./lib/syncEngine";
import { ReaderLabels } from "./lib/linkLabels";
import { appUrl } from "./lib/notify";
import { consume } from "./lib/rateLimit";
import { findOAuthAccessToken, findOAuthClient, revokeOAuthClient } from "./lib/authStore";
import { scopeFolders, scopeTags } from "./lib/ai/tools/read";
import { requireCreate } from "./lib/ai/tools/propose";
import { untrusted } from "./lib/ai/tools/untrusted";
import { MAX_NOTE_CHARS, TOOL_BY_NAME, withoutTitleHeading } from "./lib/mcp/tools";
import { MCP_SCOPES, type McpScope } from "./lib/mcp/config";
import { searchDocuments } from "./search";
import { ensureInbox, listTasks, taskBlock, type TaskView } from "./tasks";
import { snapshot } from "./documents";
import { PROPOSED_MESSAGE, proposeAppend } from "./proposals";
import { saveToInbox } from "./aiDigest";
import { withSyncedForReader } from "./lib/synced";
import { failE2ee, isLocked, isSealed, readableFor, spaceE2ee, switchesOf, type Readable } from "./lib/e2ee/state";
import { inboxItem, sealToInbox, stableInboxId } from "./lib/e2ee/inboxSeal";
import { scopeMirrors, searchMirrors } from "./e2ee/mirrors";

/** What a token is worth, once checked. */
export type Authorized =
  | { ok: true; grantId: Id<"mcpGrants">; profileId: Id<"profiles">; clientId: string; scopes: McpScope[] }
  | { ok: false; reason: "invalid_token" | "no_grant" | "account" };

const SCOPE_SET = new Set<string>(MCP_SCOPES);

// ---------------------------------------------------------------- tokens and grants

/** Checks an access token (by its hash): live, from an enabled client, for an active account with a grant. */
export const authorize = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<Authorized> => {
    const token = await findOAuthAccessToken(ctx, args.tokenHash);
    if (!token || !token.userId || !token.expiresAt || token.expiresAt <= Date.now()) return { ok: false, reason: "invalid_token" };
    const client = await findOAuthClient(ctx, token.clientId);
    if (!client || client.disabled) return { ok: false, reason: "invalid_token" };
    const profile = await profileForAuthUser(ctx, token.userId);
    if (!profile) return { ok: false, reason: "account" };
    const grant = await ctx.db
      .query("mcpGrants")
      .withIndex("by_profile_client", (q) => q.eq("profileId", profile._id).eq("clientId", token.clientId))
      .unique();
    if (!grant) return { ok: false, reason: "no_grant" };
    const scopes = token.scopes.filter((s): s is McpScope => SCOPE_SET.has(s) && grant.scopes.includes(s));
    return { ok: true, grantId: grant._id, profileId: profile._id, clientId: token.clientId, scopes };
  },
});

async function profileForAuthUser(ctx: QueryCtx, userId: string): Promise<Doc<"profiles"> | null> {
  const rows = await ctx.db
    .query("profiles")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", userId))
    .take(5);
  return rows.find((p) => p.status === "active") ?? null;
}

/**
 * What a caller may reach: places (Personal, workspaces), pages shared from elsewhere, and whether it may
 * change what's already written. An MCP grant has it, and so does a personal access token (convex/api.ts).
 */
export type Reach = Pick<Doc<"mcpGrants">, "personal" | "workspaceIds" | "includeShared" | "createOnly">;

/**
 * Who a write is made by and how it shows: the sync device (`mcp:<client>`, `api:<token>`), the version reason,
 * and the app by name (a change the person asked to review first waits in Changes under it: convex/proposals.ts).
 */
export interface Writer {
  device: string;
  reason: "mcp" | "api";
  app: { name: string; grantId?: Id<"mcpGrants">; tokenId?: Id<"apiTokens"> };
}

/** A grant with the person, still usable: the account is active and the grant hasn't been revoked. */
async function grantContext(ctx: QueryCtx, grantId: Id<"mcpGrants">) {
  const grant = await ctx.db.get(grantId);
  if (!grant) fail("unauthenticated", "This connection was removed.");
  const profile = await ctx.db.get(grant.profileId);
  if (!profile || profile.status !== "active") fail("unauthenticated", "This account can't be used right now.");
  return { grant, profile };
}

export interface Place {
  id: string;
  name: string;
  scope: Scope;
}

/** The places a grant (or token) reaches that the person can still open (a workspace they left drops out). */
export async function grantPlaces(ctx: QueryCtx, grant: Pick<Reach, "personal" | "workspaceIds">, profile: Doc<"profiles">): Promise<Place[]> {
  const out: Place[] = [];
  if (grant.personal) out.push({ id: "personal", name: "Personal", scope: personalScope(profile._id) });
  for (const wid of grant.workspaceIds) {
    const w = await ctx.db.get(wid);
    if (!w || w.status === "deleting") continue;
    try {
      const { scope } = await resolveScope(ctx, profile, { kind: "workspace", workspaceId: w.publicId });
      out.push({ id: w.publicId, name: w.name, scope });
    } catch {
      // No longer a member.
    }
  }
  return out;
}

function pickPlaces(places: Place[], arg: unknown): Place[] {
  if (arg === undefined) return places;
  const found = places.find((p) => p.id === arg);
  if (!found) fail("not_found", `This connection can't use the place "${String(arg)}". Use list_places to see the ones it can.`);
  return [found];
}

/** The place a write goes to: the one named, else Personal when allowed, else the only one. */
function writePlace(places: Place[], arg: unknown): Place {
  if (arg !== undefined) return pickPlaces(places, arg)[0]!;
  const personal = places.find((p) => p.id === "personal");
  if (personal) return personal;
  if (places.length === 1) return places[0]!;
  fail("invalid_argument", 'Say which place with "place" (see list_places).');
}

const scopeArgOf = (place: Place): ScopeArg => (place.id === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: place.id });

export const link = (publicId: string) => `${appUrl()}/d/${publicId}`;

/** A note this connection may read: in one of its places (or shared with the person, when allowed). */
export async function readableHere(ctx: QueryCtx, grant: Pick<Reach, "includeShared">, profile: Doc<"profiles">, places: Place[], noteId: string): Promise<Doc<"documents">> {
  const NOT_HERE = "There's no note with that id that this connection can open.";
  const doc = await getDocumentByPublicId(ctx, noteId);
  if (!doc || doc.inTrash || doc.deletedAt !== undefined || doc.kind === "template" || doc.kind === "synced") fail("not_found", NOT_HERE);
  if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) fail("not_found", NOT_HERE);
  if (!places.some((p) => inScope(doc, p.scope)) && !grant.includeShared) fail("not_found", NOT_HERE);
  // An end-to-end encrypted note is visible to apps only through its readable copy (Apps and integrations on).
  if (isSealed(doc) && !(await readableFor(ctx, doc, "apps"))) fail("not_found", NOT_HERE);
  return doc;
}

// ---------------------------------------------------------------- end-to-end encrypted places (docs/E2EE_DESIGN.md §7.4)

/** What an app is told when its write waits for one of the person's devices. */
export const QUEUED_MESSAGE = "Folevi will add this the next time one of your devices is online.";

/** An encrypted place (level above Standard): its notes are read through readable copies and written through the inbox. */
async function encryptedPlace(ctx: QueryCtx, scope: Scope) {
  const space = await spaceE2ee(ctx, scope);
  return space && space.level !== "standard" ? space : null;
}

/** A sealed note's readable copy for apps (readableHere checked it exists). */
export async function appsCopy(ctx: QueryCtx, doc: Doc<"documents">): Promise<Readable> {
  const copy = await readableFor(ctx, doc, "apps");
  if (!copy) fail("not_found", "There's no note with that id that this connection can open.");
  return copy;
}

/**
 * Queues a write to an encrypted place (or a sealed note) for one of the person's devices: the request is
 * sealed to the space's inbox key and answered "queued". Needs Apps and integrations on (clips: the web
 * clipper), and never targets a locked note. A retried request finds the item it already queued.
 */
async function queueWrite(
  ctx: MutationCtx,
  profile: Doc<"profiles">,
  scope: Scope,
  input: { tool: string; args: Record<string, unknown>; requestKey: string; writer: Writer; clip?: boolean; doc?: Doc<"documents">; taskId?: string; newNoteId?: string },
): Promise<Record<string, unknown>> {
  const sw = switchesOf(await spaceE2ee(ctx, scope));
  const needed = input.clip ? "webClipper" : "apps";
  if (!sw[needed]) {
    failE2ee(
      "e2ee_switch_off",
      input.clip ? "This space is end-to-end encrypted. Turn on the web clipper in Settings > Privacy to save clips here." : "This space is end-to-end encrypted. Turn on Apps and integrations in Settings > Privacy to let apps add to it.",
      { switch: needed },
    );
  }
  if (input.doc && (await isLocked(ctx, input.doc))) failE2ee("e2ee_locked");
  const publicId = await stableInboxId(input.clip ? "clip-" : "app-", input.requestKey);
  const earlier = await inboxItem(ctx, publicId);
  const documentId = input.newNoteId ?? input.doc?.publicId;
  const answer = { status: "queued", id: publicId, message: QUEUED_MESSAGE, ...(documentId ? { noteId: documentId } : {}), ...(input.taskId ? { taskId: input.taskId } : {}) };
  if (earlier) return answer;
  const at = Date.now();
  const payload = input.clip
    ? {
        kind: "clip" as const,
        title: String(input.args.title ?? "").slice(0, 200),
        markdown: String(input.args.markdown ?? ""),
        documentId: input.newNoteId!,
        ...(typeof input.args.url === "string" ? { url: input.args.url.slice(0, 2000) } : {}),
      }
    : {
        kind: "app" as const,
        tool: input.tool,
        app: { name: input.writer.app.name.slice(0, 120), device: input.writer.device.slice(0, 64), reason: input.writer.reason },
        args: input.args,
        ...(documentId ? { documentId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        profileId: profile._id as string,
        at,
      };
  await sealToInbox(ctx, scope, input.clip ? "clip" : "app", payload, { publicId, for: profile._id, ...(documentId ? { targetDocumentId: documentId } : {}) });
  return answer;
}

/** Up to `n` recent notes of a place an app may see, encrypted ones (with Apps on) through their copies. */
async function recentForApps(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope, n: number): Promise<{ doc: Doc<"documents">; title: string }[]> {
  const rows = await (
    scope.kind === "personal"
      ? ctx.db.query("documents").withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", scope.profileId).eq("inTrash", false))
      : ctx.db.query("documents").withIndex("by_workspace_trash", (q) => q.eq("workspaceId", scope.workspaceId).eq("inTrash", false))
  )
    .order("desc")
    .take(n * 2);
  const reader = await PageReader.forScope(ctx, profile, scope);
  const usable = await reader.filter(rows.filter((d) => (d.kind === "document" || d.kind === "daily") && !d.archivedAt));
  const out: { doc: Doc<"documents">; title: string }[] = [];
  for (const d of usable.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (out.length >= n) break;
    if (!isSealed(d)) out.push({ doc: d, title: d.title || "Untitled" });
    else {
      const copy = await readableFor(ctx, d, "apps");
      if (copy) out.push({ doc: d, title: copy.title || "Untitled" });
    }
  }
  return out;
}

/** Encrypted notes' to-dos from their copies for apps, in one task view. */
export async function sealedTasks(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope, view: TaskView, today: string) {
  if (!switchesOf(await spaceE2ee(ctx, scope)).apps) return [];
  const out: { taskId: string; text: string; done: boolean; dueDate: string | null; dueTime: string | null; noteId: string; noteTitle: string }[] = [];
  for (const m of await scopeMirrors(ctx, scope, "apps").take(200)) {
    const doc = await ctx.db.get(m.documentId);
    if (!doc || doc.inTrash || doc.deletedAt !== undefined || !isSealed(doc) || (await isLocked(ctx, doc))) continue;
    if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
    for (const t of m.tasks ?? []) {
      const status = t.done ? "done" : "open";
      const views = taskViews({ status, dueDate: t.due ?? null, assigneeId: null }, today, profile._id, { personal: scope.kind === "personal" });
      if (view === "completed" ? !t.done : !views.includes(view)) continue;
      out.push({ taskId: t.blockId, text: t.text, done: t.done, dueDate: t.due ?? null, dueTime: t.dueTime ?? null, noteId: doc.publicId, noteTitle: m.title || "Untitled" });
    }
  }
  return out;
}

/** A note this connection may add to: in one of its places, where the person can edit. */
export async function writableHere(ctx: QueryCtx, profile: Doc<"profiles">, places: Place[], noteId: string): Promise<Doc<"documents">> {
  const doc = await getDocumentByPublicId(ctx, noteId);
  if (!doc || doc.inTrash || doc.deletedAt !== undefined || doc.kind === "template" || doc.kind === "synced" || !places.some((p) => inScope(doc, p.scope))) {
    fail("not_found", "There's no note with that id that this connection can change.");
  }
  if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can only read that note, so nothing can be added to it.");
  return doc;
}

export async function placeOf(ctx: QueryCtx, doc: Doc<"documents">, places: Place[]): Promise<string> {
  const p = places.find((x) => inScope(doc, x.scope));
  if (p) return p.name;
  const scope = scopeOfRow(doc);
  return scope.kind === "workspace" ? ((await ctx.db.get(scope.workspaceId))?.name ?? "Shared with you") : "Shared with you";
}

// ---------------------------------------------------------------- reads

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) ? v : fallback);

/** A note's Markdown and where it lives: its place, folder (and the folder's path), tags and link. */
export async function noteDetail(ctx: QueryCtx, profile: Doc<"profiles">, doc: Doc<"documents">, places: Place[]) {
  // An encrypted note: its readable copy for apps (made on the person's device, docs/E2EE_DESIGN.md §7.4).
  if (isSealed(doc)) {
    const copy = await appsCopy(ctx, doc);
    const folder = doc.folderId ? await ctx.db.get(doc.folderId) : null;
    const path = copy.folderPath ?? null;
    return {
      markdown: copy.text,
      place: await placeOf(ctx, doc, places),
      folder: folder && !folder.deletedAt && path ? { id: folder.publicId, name: path.split(" / ").pop() || path, path } : null,
      tags: copy.tags ?? [],
    };
  }
  // With the synced blocks this person can see in place (lib/synced.ts).
  const blocks = await new ReaderLabels(ctx, profile).blocks(await withSyncedForReader(ctx, profile, (await liveBlocks(ctx, doc._id)).map(toWireBlock)));
  const folder = doc.folderId ? await ctx.db.get(doc.folderId) : null;
  let path: string | null = null;
  if (folder && !folder.deletedAt) {
    const folders = await scopeFolders(ctx, scopeOfRow(doc));
    path = folderPath(
      folders.map((f) => ({ id: f._id as string, name: f.name, parentFolderId: f.parentFolderId ?? null })),
      folder._id,
    );
  }
  const tags = await ctx.db
    .query("documentTags")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .take(50);
  const tagNames: string[] = [];
  for (const t of tags) {
    const tag = await ctx.db.get(t.tagId);
    if (tag) tagNames.push(tag.name);
  }
  return {
    markdown: blocksToMarkdown(blocks),
    place: await placeOf(ctx, doc, places),
    folder: folder && !folder.deletedAt ? { id: folder.publicId, name: folder.name, path: path || folder.name } : null,
    tags: tagNames,
  };
}

/** Runs a read tool as the grant's person. Returns structured content (note text wrapped as untrusted). */
export const read = internalQuery({
  args: { grantId: v.id("mcpGrants"), tool: v.string(), args: v.any() },
  handler: async (ctx, { grantId, tool, args }): Promise<Record<string, unknown>> => {
    const { grant, profile } = await grantContext(ctx, grantId);
    return await runRead(ctx, grant, profile, tool, args);
  },
});

/** A read tool, as a person through what `reach` allows (an MCP grant, or an API token). */
export async function runRead(ctx: QueryCtx, reach: Reach, profile: Doc<"profiles">, tool: string, args: unknown): Promise<Record<string, unknown>> {
  const grant = reach;
  const places = await grantPlaces(ctx, grant, profile);
  const a = (args ?? {}) as Args;
  switch (tool) {
    case "list_places":
      return { places: places.map((p) => ({ id: p.id, name: p.name })), includesSharedPages: grant.includeShared };

    case "search_notes": {
      const limit = int(a.limit, 10);
      const results: Record<string, unknown>[] = [];
      for (const p of pickPlaces(places, a.place)) {
        const found = await searchDocuments(ctx, profile, p.scope, { query: str(a.query), limit });
        const seen = new Set<string>();
        for (const r of found) {
          seen.add(r.id);
          results.push({ id: r.id, title: r.title || "Untitled", place: p.name, snippet: untrusted("note", { id: r.id }, r.snippet ?? ""), updated: new Date(r.updatedAt).toISOString().slice(0, 10), url: link(r.id) });
        }
        // Encrypted notes, through their readable copies for apps (Apps and integrations on).
        for (const m of await searchMirrors(ctx, p.scope, "apps", str(a.query), limit)) {
          const d = await ctx.db.get(m.documentId);
          if (!d || seen.has(d.publicId) || d.inTrash || d.deletedAt !== undefined || (await isLocked(ctx, d))) continue;
          if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
          seen.add(d.publicId);
          results.push({ id: d.publicId, title: m.title || "Untitled", place: p.name, snippet: untrusted("note", { id: d.publicId }, m.text.replace(/\s+/g, " ").slice(0, 200)), updated: new Date(d.updatedAt).toISOString().slice(0, 10), url: link(d.publicId) });
        }
      }
      results.sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
      return { results: results.slice(0, limit) };
    }

    case "get_note": {
      const doc = await readableHere(ctx, grant, profile, places, str(a.noteId));
      const { markdown, place, folder, tags } = await noteDetail(ctx, profile, doc, places);
      const max = int(a.maxChars, MAX_NOTE_CHARS);
      const title = isSealed(doc) ? (await appsCopy(ctx, doc)).title || "Untitled" : doc.title || "Untitled";
      return {
        id: doc.publicId,
        title,
        place,
        folder: folder?.name ?? null,
        tags,
        updated: new Date(doc.updatedAt).toISOString(),
        url: link(doc.publicId),
        ...(markdown.length > max ? { truncated: `Showing the first ${max} of ${markdown.length} characters.` } : {}),
        markdown: untrusted("note", { id: doc.publicId, title }, markdown.slice(0, max) || "(empty note)"),
      };
    }

    case "list_recent_notes": {
      const limit = int(a.limit, 15);
      const out: Record<string, unknown>[] = [];
      for (const p of pickPlaces(places, a.place)) {
        for (const { doc: d, title } of await recentForApps(ctx, profile, p.scope, limit)) out.push({ id: d.publicId, title, place: p.name, updatedAt: d.updatedAt, url: link(d.publicId) });
      }
      out.sort((x, y) => Number(y.updatedAt) - Number(x.updatedAt));
      return { notes: out.slice(0, limit).map((n) => ({ ...n, updatedAt: new Date(Number(n.updatedAt)).toISOString() })) };
    }

    case "list_folders": {
      const out: Record<string, unknown>[] = [];
      for (const p of pickPlaces(places, a.place)) {
        const folders = await scopeFolders(ctx, p.scope);
        // Nested folders also carry their path ("Work / Clients"), so same-named subfolders can be told apart.
        const links = folders.map((f) => ({ id: f._id as string, name: f.name, parentFolderId: f.parentFolderId ?? null }));
        for (const f of folders.slice(0, 200)) out.push({ id: f.publicId, name: f.name, path: folderPath(links, f._id), place: p.name });
      }
      return { folders: out };
    }

    case "list_tags": {
      const out: Record<string, unknown>[] = [];
      for (const p of pickPlaces(places, a.place)) for (const t of (await scopeTags(ctx, p.scope)).slice(0, 200)) out.push({ id: t.publicId, name: t.name, place: p.name });
      return { tags: out };
    }

    case "list_tasks": {
      const view = (str(a.view) || "today") as TaskView;
      const today = localDate(Date.now(), profile.timeZone);
      const out: Record<string, unknown>[] = [];
      for (const p of pickPlaces(places, a.place)) {
        for (const t of (await listTasks(ctx, profile, p.scope, view, today)).slice(0, 100)) {
          out.push({
            taskId: t.blockId,
            text: untrusted("note", { task: t.blockId }, t.title || "Untitled task"),
            status: t.status,
            dueDate: t.dueDate ?? null,
            dueTime: t.dueTime ?? null,
            priority: t.priority,
            note: { id: t.documentId, title: t.documentTitle || "Untitled" },
            place: p.name,
            url: `${link(t.documentId)}#block-${t.blockId}`,
          });
        }
        for (const t of await sealedTasks(ctx, profile, p.scope, view, today)) {
          out.push({
            taskId: t.taskId,
            text: untrusted("note", { task: t.taskId }, t.text || "Untitled task"),
            status: t.done ? "done" : "open",
            dueDate: t.dueDate,
            dueTime: t.dueTime,
            priority: "none",
            note: { id: t.noteId, title: t.noteTitle },
            place: p.name,
            url: `${link(t.noteId)}#block-${t.taskId}`,
          });
        }
      }
      return { today, view, tasks: out.slice(0, 150) };
    }
  }
  fail("not_found", `Unknown tool "${tool}".`);
}

/** A note as an MCP resource (folevi://note/{id}): its Markdown. */
export const readResource = internalQuery({
  args: { grantId: v.id("mcpGrants"), noteId: v.string() },
  handler: async (ctx, { grantId, noteId }) => {
    const { grant, profile } = await grantContext(ctx, grantId);
    const places = await grantPlaces(ctx, grant, profile);
    const doc = await readableHere(ctx, grant, profile, places, noteId);
    if (isSealed(doc)) {
      const copy = await appsCopy(ctx, doc);
      return { title: copy.title || "Untitled", markdown: copy.text.slice(0, MAX_NOTE_CHARS) };
    }
    const blocks = await new ReaderLabels(ctx, profile).blocks(await withSyncedForReader(ctx, profile, (await liveBlocks(ctx, doc._id)).map(toWireBlock)));
    return { title: doc.title || "Untitled", markdown: blocksToMarkdown(blocks, { title: doc.title || "Untitled" }).slice(0, MAX_NOTE_CHARS) };
  },
});

// ---------------------------------------------------------------- writes

/** New blocks from Markdown, placed after `after` at the top level. */
function blocksFrom(markdown: string, after: string | null): WireBlock[] {
  const { blocks } = markdownToBlocks(markdown, { titleFromHeading: false });
  const top = blocks.filter((b) => b.parentId === null);
  const ranks = rankSequence(top.length, after, null);
  top.forEach((b, i) => (b.rank = ranks[i]!));
  return blocks;
}

const lastRootRank = (rows: Doc<"blocks">[]) => rows.filter((r) => r.parentId === null).reduce<string | null>((m, r) => (m === null || r.rank > m ? r.rank : m), null);

/** Applies sync operations as the person, as this connection's device; a refusal or conflict fails it all. */
async function sync(ctx: MutationCtx, profile: Doc<"profiles">, device: string, ops: SyncOp[]): Promise<void> {
  const engine = new SyncEngine(ctx, profile, device.slice(0, 64), "app");
  const results = await engine.applyAll(null, ops);
  const bad = results.find((r) => r.status === "rejected" || r.status === "conflict");
  if (bad) fail("conflict", bad.status === "conflict" ? "The note changed while this was being saved. Read it again and retry." : (bad.error?.message ?? "That couldn't be saved."));
}

/** Op ids derived from the request key: a retried request repeats the same ids, which the engine skips. */
const opId = (requestKey: string, i: number) => `mcp${requestKey.slice(0, 20)}${i.toString(36).padStart(4, "0")}`;

/**
 * Runs a write tool as the grant's person. `requestKey` (a hash of the grant, the JSON-RPC id and the
 * arguments) makes a retried request return the first answer instead of changing things twice.
 */
export const write = internalMutation({
  args: { grantId: v.id("mcpGrants"), tool: v.string(), args: v.any(), requestKey: v.string() },
  handler: async (ctx, { grantId, tool, args, requestKey }): Promise<Record<string, unknown>> => {
    const { grant, profile } = await grantContext(ctx, grantId);
    const def = TOOL_BY_NAME.get(tool);
    if (!def || def.kind !== "write") fail("not_found", `Unknown tool "${tool}".`);
    const earlier = await ctx.db
      .query("mcpEvents")
      .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
      .first();
    if (earlier?.outcome === "ok" && earlier.result) return { ...(JSON.parse(earlier.result) as Record<string, unknown>), repeated: true };
    await consume(ctx, "mcpWrite", grant._id);
    await consume(ctx, "mcpWriteDaily", grant._id);
    const { result, targets } = await runWrite(ctx, grant, profile, tool, args, requestKey, { device: `mcp:${grant.clientId}`, reason: "mcp", app: { name: grant.clientName, grantId: grant._id } });
    await ctx.db.insert("mcpEvents", { grantId: grant._id, profileId: profile._id, tool, targets, outcome: "ok", requestKey, result: JSON.stringify(result), at: Date.now() });
    return result;
  },
});

/**
 * A write tool, as a person through what `reach` allows (an MCP grant, or an API token). The caller has
 * checked the scope and rate limits. Op ids come from `requestKey`, so a retried request changes nothing
 * twice. Before an existing note changes, a version is saved with `writer.reason`.
 */
export async function runWrite(
  ctx: MutationCtx,
  reach: Reach,
  profile: Doc<"profiles">,
  tool: string,
  args: unknown,
  requestKey: string,
  writer: Writer,
): Promise<{ result: Record<string, unknown>; targets: string[] }> {
  const grant = reach;
  const def = TOOL_BY_NAME.get(tool);
  if (!def || def.kind !== "write") fail("not_found", `Unknown tool "${tool}".`);
  if (def.changesExisting && grant.createOnly) fail("forbidden", "This connection may only add new notes and tasks, not change existing ones.");
  await assertWritable(ctx, profile);
  const places = await grantPlaces(ctx, grant, profile);
  const a = (args ?? {}) as Args;
  const device = writer.device;
  let result: Record<string, unknown>;
  let targets: string[] = [];

  switch (tool) {
    case "create_note": {
      const place = writePlace(places, a.place);
      await requireCreate(ctx, profile, place.scope);
      let folderId: Id<"folders"> | undefined;
      if (a.folderId !== undefined) {
        const folder = await ctx.db
          .query("folders")
          .withIndex("by_public_id", (q) => q.eq("publicId", str(a.folderId)))
          .unique();
        if (!folder || folder.deletedAt || !inScope(folder, place.scope)) fail("not_found", "That folder isn't in this place.");
        folderId = folder._id;
      }
      if (a.inInbox === true && folderId) fail("invalid_argument", "Use folderId or inInbox, not both.");
      // An encrypted place: the note is made by one of the person's devices (its id is chosen here).
      if (await encryptedPlace(ctx, place.scope)) {
        const newNoteId = ulid();
        result = await queueWrite(ctx, profile, place.scope, { tool, args: a, requestKey, writer, clip: a.inInbox === true, newNoteId });
        targets = [newNoteId];
        break;
      }
      const title = str(a.title).trim().slice(0, 200);
      const blocks = blocksFrom(withoutTitleHeading(str(a.markdown), title), null);
      if (blocks.length > LIMITS.maxBlocksPerDocument) fail("limit_exceeded", "That note would be too long.");
      // Under the Inbox page (Folevi Web Clipper's clips): a page there, with a card for it at the end of the Inbox.
      const doc =
        a.inInbox === true
          ? await saveToInbox(ctx, profile, { scope: place.scope, scopeArg: scopeArgOf(place) }, title, blocks)
          : await createDocument(ctx, { scope: place.scope, actor: profile, title, folderId, blocks });
      targets = [doc.publicId];
      result = { noteId: doc.publicId, title: doc.title || "Untitled", place: place.name, ...(a.inInbox === true ? { inInbox: true } : {}), url: link(doc.publicId) };
      break;
    }

    case "append_to_note": {
      const doc = await writableHere(ctx, profile, places, str(a.noteId));
      if (isSealed(doc)) {
        result = await queueWrite(ctx, profile, scopeOfRow(doc), { tool, args: a, requestKey, writer, doc });
        targets = [doc.publicId];
        break;
      }
      const rows = await liveBlocks(ctx, doc._id);
      const blocks = blocksFrom(str(a.markdown), lastRootRank(rows));
      if (rows.length + blocks.length > LIMITS.maxBlocksPerDocument) fail("limit_exceeded", "The note would have too many blocks.");
      targets = [doc.publicId];
      // The person reviews changes to existing notes first: it waits in Changes, and the app is told so.
      if (profile.reviewAppEdits === true) {
        const { proposalId, expiresAt } = await proposeAppend(ctx, profile, doc, blocks, { source: "app", ...writer.app, device, reason: writer.reason }, requestKey);
        result = { noteId: doc.publicId, title: doc.title || "Untitled", proposed: true, status: "pending", proposalId, expiresAt: new Date(expiresAt).toISOString(), message: PROPOSED_MESSAGE, url: link(doc.publicId) };
        break;
      }
      await snapshot(ctx, doc, profile._id, writer.reason);
      await sync(ctx, profile, device, blocks.map((b, i) => ({ opId: opId(requestKey, i), kind: "block.upsert", documentId: doc.publicId, block: b, baseRevision: null, fields: ["content", "position"] })));
      result = { noteId: doc.publicId, title: doc.title || "Untitled", added: blocks.length, url: link(doc.publicId) };
      break;
    }

    case "add_task": {
      let doc: Doc<"documents">;
      if (a.noteId !== undefined) {
        doc = await writableHere(ctx, profile, places, str(a.noteId));
        if (isSealed(doc)) {
          const taskId = ulid();
          result = await queueWrite(ctx, profile, scopeOfRow(doc), { tool, args: a, requestKey, writer, doc, taskId });
          targets = [taskId];
          break;
        }
      } else {
        const place = writePlace(places, a.place);
        await requireCreate(ctx, profile, place.scope);
        // An encrypted place: the to-do goes into its Inbox on one of the person's devices.
        if (await encryptedPlace(ctx, place.scope)) {
          const taskId = ulid();
          result = await queueWrite(ctx, profile, place.scope, { tool, args: a, requestKey, writer, taskId });
          targets = [taskId];
          break;
        }
        doc = (await getDocumentByPublicId(ctx, await ensureInbox(ctx, profile, place.scope, scopeArgOf(place), device.slice(0, 64))))!;
      }
      const rows = await liveBlocks(ctx, doc._id);
      const props: Record<string, unknown> = { checked: false };
      if (typeof a.dueDate === "string") props.dueDate = a.dueDate;
      if (typeof a.dueDate === "string" && typeof a.dueTime === "string") props.dueTime = a.dueTime;
      if (typeof a.priority === "string" && a.priority !== "none") props.priority = a.priority;
      if (typeof a.assigneeId === "string") props.assigneeId = await checkedAssignee(ctx, profile, doc, a.assigneeId);
      if (typeof a.repeat === "string" && a.repeat !== "none") {
        for (const [k, val] of Object.entries(repeatProps({ repeat: a.repeat as RepeatRule["repeat"] }))) if (val !== null) props[k] = val;
        if (typeof props.dueDate !== "string") props.dueDate = localDate(Date.now(), profile.timeZone);
      }
      const block: WireBlock = { id: ulid(), type: "todo", parentId: null, rank: rankBetween(lastRootRank(rows), null), schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: str(a.text).trim().slice(0, 500) }], props };
      await sync(ctx, profile, device, [{ opId: opId(requestKey, 0), kind: "block.upsert", documentId: doc.publicId, block, baseRevision: null, fields: ["content", "position"] }]);
      targets = [block.id];
      result = { taskId: block.id, note: { id: doc.publicId, title: doc.title || "Untitled" }, url: `${link(doc.publicId)}#block-${block.id}` };
      break;
    }

    case "complete_task":
    case "update_task": {
      // A to-do in an encrypted note is changed by one of the person's devices.
      const sealedTask = await sealedTaskNote(ctx, profile, places, str(a.taskId));
      if (sealedTask) {
        result = await queueWrite(ctx, profile, scopeOfRow(sealedTask), { tool, args: a, requestKey, writer, doc: sealedTask, taskId: str(a.taskId) });
        targets = [str(a.taskId)];
        break;
      }
      const { row, doc } = await taskBlock(ctx, profile, str(a.taskId));
      if (!places.some((p) => inScope(doc, p.scope))) fail("not_found", "Task not found.");
      const wire = toWireBlock(row);
      const props = { ...(wire.props as Record<string, unknown>) };
      if (tool === "complete_task") props.checked = a.done !== false;
      else {
        if (typeof a.done === "boolean") props.checked = a.done;
        if (a.dueDate === null) {
          delete props.dueDate;
          delete props.dueTime;
        } else if (typeof a.dueDate === "string") props.dueDate = a.dueDate;
        if (a.dueTime === null) delete props.dueTime;
        else if (typeof a.dueTime === "string") {
          if (typeof props.dueDate !== "string") fail("invalid_argument", "A time needs a due date.");
          props.dueTime = a.dueTime;
        }
        if (typeof a.priority === "string") {
          if (a.priority === "none") delete props.priority;
          else props.priority = a.priority;
        }
        if (typeof a.repeat === "string") {
          for (const [k, val] of Object.entries(repeatProps(a.repeat === "none" ? null : { repeat: a.repeat as RepeatRule["repeat"] }))) {
            if (val === null) delete props[k];
            else props[k] = val;
          }
        }
        // The REST API's remindAt (the iOS notification's Snooze); a reminder at a new time rings again.
        if (a.remindAt === null) delete props.reminderAt;
        else if (typeof a.remindAt === "string") {
          const at = Date.parse(a.remindAt);
          if (!/^\d{4}-\d{2}-\d{2}T/.test(a.remindAt) || !Number.isFinite(at) || at > Date.now() + 5 * 365 * 86_400_000) fail("invalid_argument", "remindAt must be a time as ISO 8601, like 2026-10-16T15:00:00Z.");
          props.reminderAt = at;
        }
      }
      await snapshot(ctx, doc, profile._id, writer.reason);
      const { revision: _revision, ...block } = { ...wire, props };
      await sync(ctx, profile, device, [{ opId: opId(requestKey, 0), kind: "block.upsert", documentId: doc.publicId, block, baseRevision: row.revision, fields: ["content"] }]);
      targets = [row.blockId];
      result = {
        taskId: row.blockId,
        done: props.checked === true,
        dueDate: (props.dueDate as string) ?? null,
        dueTime: (props.dueTime as string) ?? null,
        priority: (props.priority as string) ?? "none",
        remindAt: typeof props.reminderAt === "number" ? new Date(props.reminderAt).toISOString() : null,
      };
      break;
    }

    default:
      fail("not_found", `Unknown tool "${tool}".`);
  }
  return { result, targets };
}

/** The encrypted note a to-do is in, when it is in one this connection may change (else null: the usual path). */
async function sealedTaskNote(ctx: QueryCtx, profile: Doc<"profiles">, places: Place[], taskId: string): Promise<Doc<"documents"> | null> {
  const row = await ctx.db
    .query("blocks")
    .withIndex("by_block_id", (q) => q.eq("blockId", taskId))
    .unique();
  if (!row || row.deletedAt !== undefined) return null;
  const doc = await ctx.db.get(row.documentId);
  if (!doc || !isSealed(doc)) return null;
  if (!places.some((p) => inScope(doc, p.scope))) fail("not_found", "Task not found.");
  if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can't edit this task.");
  return doc;
}

/** Who a new task may be assigned to: yourself, or in a workspace, one of its members. */
async function checkedAssignee(ctx: QueryCtx, profile: Doc<"profiles">, doc: Doc<"documents">, id: string): Promise<string> {
  if (id === profile._id) return id;
  const scope = scopeOfRow(doc);
  const pid = ctx.db.normalizeId("profiles", id);
  if (!pid || scope.kind !== "workspace") fail("invalid_argument", "A task here can only be assigned to you.");
  if (!(await membership(ctx, pid, scope.workspaceId))) fail("invalid_argument", "That person isn't a member of this workspace.");
  return pid;
}

/** Records a read, a refusal or a failed write (writes that worked are recorded by `write`), and marks the grant used. */
export const record = internalMutation({
  args: { grantId: v.id("mcpGrants"), tool: v.string(), outcome: v.union(v.literal("ok"), v.literal("error"), v.literal("denied")), targets: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (!grant) return;
    const now = Date.now();
    if (args.outcome !== "ok" || TOOL_BY_NAME.get(args.tool)?.kind === "read") {
      await ctx.db.insert("mcpEvents", { grantId: grant._id, profileId: grant.profileId, tool: args.tool, targets: (args.targets ?? []).slice(0, 20), outcome: args.outcome, at: now });
    }
    // Last used: at most once a minute, so a busy app doesn't rewrite the grant on every call.
    if (!grant.lastUsedAt || now - grant.lastUsedAt > 60_000) await ctx.db.patch(grant._id, { lastUsedAt: now });
  },
});

/** Rate limits per connection: reads and searches (checked by the HTTP layer before running a tool). */
export const limit = internalMutation({
  args: { grantId: v.id("mcpGrants"), kind: v.union(v.literal("read"), v.literal("search")) },
  handler: async (ctx, args) => {
    await consume(ctx, args.kind === "search" ? "mcpSearch" : "mcpRead", args.grantId);
  },
});

// ---------------------------------------------------------------- consent

/** What the consent screen shows: the app (as it named itself), and the places the person can give it. */
export const consentInfo = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const client = await findOAuthClient(ctx, args.clientId);
    if (!client || client.disabled) return null;
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(100);
    const workspaces: { id: string; name: string }[] = [];
    for (const m of memberships) {
      const w = await ctx.db.get(m.workspaceId);
      if (w && w.status !== "deleting") workspaces.push({ id: w.publicId, name: w.name });
    }
    const existing = await ctx.db
      .query("mcpGrants")
      .withIndex("by_profile_client", (q) => q.eq("profileId", profile._id).eq("clientId", args.clientId))
      .unique();
    return {
      name: (client.name || "An app").slice(0, 80),
      redirectHosts: [...new Set(client.redirectUris.map(hostOf).filter(Boolean))].slice(0, 3),
      email: profile.email,
      workspaces,
      current: existing
        ? { personal: existing.personal, workspaceIds: await workspacePublicIds(ctx, existing.workspaceIds), includeShared: existing.includeShared, createOnly: existing.createOnly }
        : null,
    };
  },
});

function hostOf(uri: string): string {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : `${u.protocol}//`;
  } catch {
    return "";
  }
}

async function workspacePublicIds(ctx: QueryCtx, ids: Id<"workspaces">[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const w = await ctx.db.get(id);
    if (w) out.push(w.publicId);
  }
  return out;
}

/**
 * Saves what the person chose on the consent screen, just before they approve it with Better Auth (which
 * then issues the code). Scopes are the ones they accepted; places are checked against their memberships.
 */
export const saveGrant = mutation({
  args: {
    clientId: v.string(),
    scopes: v.array(v.string()),
    personal: v.boolean(),
    workspaceIds: v.array(v.string()),
    includeShared: v.boolean(),
    createOnly: v.boolean(),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const client = await findOAuthClient(ctx, args.clientId);
    if (!client || client.disabled) fail("not_found", "This app isn't registered any more. Start connecting again from the app.");
    const scopes = [...new Set(args.scopes.filter((s) => SCOPE_SET.has(s)))];
    if (!scopes.length) fail("invalid_argument", "Allow at least one thing it can do.");
    // An app that can't read (Folevi Web Clipper asks only for notes:write) only ever adds new things.
    const canRead = scopes.some((s) => s.endsWith(":read"));
    const workspaceIds: Id<"workspaces">[] = [];
    for (const publicId of [...new Set(args.workspaceIds)].slice(0, 50)) {
      const { scope } = await resolveScope(ctx, profile, { kind: "workspace", workspaceId: publicId });
      if (scope.kind === "workspace") workspaceIds.push(scope.workspaceId);
    }
    if (!args.personal && !workspaceIds.length) fail("invalid_argument", "Choose at least one place.");
    const now = Date.now();
    const fields = {
      clientName: (client.name || "An app").slice(0, 80),
      redirectHost: [...new Set(client.redirectUris.map(hostOf).filter(Boolean))].join(", ").slice(0, 200),
      personal: args.personal,
      workspaceIds,
      includeShared: canRead && args.includeShared,
      createOnly: args.createOnly || !canRead,
      scopes,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("mcpGrants")
      .withIndex("by_profile_client", (q) => q.eq("profileId", profile._id).eq("clientId", args.clientId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("mcpGrants", { profileId: profile._id, clientId: args.clientId, createdAt: now, ...fields });
    return null;
  },
});

// ---------------------------------------------------------------- Settings → Connected apps

export const listGrants = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const grants = await ctx.db
      .query("mcpGrants")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(50);
    const out = [];
    for (const g of grants) {
      const workspaceNames: string[] = [];
      for (const id of g.workspaceIds) {
        const w = await ctx.db.get(id);
        if (w) workspaceNames.push(w.name);
      }
      const events = await ctx.db
        .query("mcpEvents")
        .withIndex("by_grant", (q) => q.eq("grantId", g._id))
        .order("desc")
        .take(8);
      out.push({
        id: g._id as string,
        name: g.clientName,
        redirectHost: g.redirectHost,
        places: [...(g.personal ? ["Personal"] : []), ...workspaceNames],
        includeShared: g.includeShared,
        createOnly: g.createOnly,
        canRead: g.scopes.some((s) => s.endsWith(":read")),
        canWrite: g.scopes.some((s) => s.endsWith(":write")),
        connectedAt: g.createdAt,
        lastUsedAt: g.lastUsedAt ?? null,
        recent: events.map((e) => ({ tool: e.tool, outcome: e.outcome, at: e.at })),
      });
    }
    return out.sort((a, b) => (b.lastUsedAt ?? b.connectedAt) - (a.lastUsedAt ?? a.connectedAt));
  },
});

/** Disconnects an app: its tokens stop working at once and it has to ask again. */
export const revokeGrant = mutation({
  args: { grantId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const id = ctx.db.normalizeId("mcpGrants", args.grantId);
    const grant = id ? await ctx.db.get(id) : null;
    if (!grant || grant.profileId !== profile._id) fail("not_found", "That connection isn't there.");
    await revokeOAuthClient(ctx, profile.authSubject, grant.clientId);
    let events = await ctx.db
      .query("mcpEvents")
      .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
      .take(500);
    while (events.length) {
      for (const e of events) await ctx.db.delete(e._id);
      events = await ctx.db
        .query("mcpEvents")
        .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
        .take(500);
    }
    await ctx.db.delete(grant._id);
    return null;
  },
});

