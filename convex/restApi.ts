// The REST API's database side (convex/restApiServer.ts handles HTTP). Every request runs as the token's
// person, inside the token's places, through what connected apps use (convex/mcp.ts): the same place and
// access checks for reads, and the same writes (runWrite: the sync engine as device "api:<token>", a version
// saved with reason "api" before an existing note changes, shown in Changes as a connected app).
//
// Writes with an Idempotency-Key keep their answer for a day (apiRequests): a retry gets the first answer.
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { localDate, ulid } from "@folevi/editor-schema";
import { PageReader } from "./lib/auth";
import { fail } from "./lib/errors";
import { inScope } from "./lib/scope";
import { consume } from "./lib/rateLimit";
import { sha256Base64url } from "./lib/crypto";
import { grantPlaces, link, noteDetail, placeOf, readableHere, runWrite, type Place } from "./mcp";
import { reachOf, tokenContext } from "./apiTokens";
import { searchDocuments } from "./search";
import { listTasks } from "./tasks";
import type { RouteName } from "./lib/restApi";

const DAY = 24 * 60 * 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Last used: at most once a minute, so a busy script doesn't rewrite the token on every call. */
async function touch(ctx: MutationCtx, token: Doc<"apiTokens">) {
  const now = Date.now();
  if (!token.lastUsedAt || now - token.lastUsedAt > 60_000) await ctx.db.patch(token._id, { lastUsedAt: now });
}

/** Rate limit for a read (searches count separately), checked before it runs. */
export const limit = internalMutation({
  args: { tokenId: v.id("apiTokens"), kind: v.union(v.literal("read"), v.literal("search")) },
  handler: async (ctx, args) => {
    const { token } = await tokenContext(ctx, args.tokenId);
    await consume(ctx, args.kind === "search" ? "apiSearch" : "apiRead", token._id);
    await touch(ctx, token);
  },
});

/** The places named by `place` (all of them when it's left out); one the token can't use is refused. */
function placesFor(places: Place[], arg: unknown): Place[] {
  if (arg === undefined || arg === "") return places;
  const found = places.find((p) => p.id === arg);
  if (!found) fail("forbidden", `This token can't use the place "${String(arg).slice(0, 64)}". GET /api/v1/places lists the ones it can.`);
  return [found];
}

const placeRef = (p: Place) => ({ id: p.id, name: p.name });

/** Cursors are opaque to clients: the edit time listing continues before. */
const encodeCursor = (before: number) => btoa(JSON.stringify({ b: before })).replace(/=+$/, "");
function decodeCursor(cursor: string): number {
  try {
    const b = (JSON.parse(atob(cursor)) as { b?: unknown }).b;
    if (typeof b === "number" && Number.isFinite(b)) return b;
  } catch {
    // Falls through.
  }
  fail("invalid_argument", "That cursor isn't valid. Use nextCursor from the previous page.");
}

/**
 * Notes edited before `before`, newest first, across `places` (only ones the person can open). Each place
 * is read up to a cap; when a place has more than that, only notes at least as new as the oldest one read
 * there are certain to be in order, so the page stops there and the cursor carries on from it.
 */
async function recentPage(ctx: QueryCtx, profile: Doc<"profiles">, places: Place[], before: number, limit: number) {
  const cap = limit * 2 + 1;
  const found: { doc: Doc<"documents">; place: Place }[] = [];
  let floor = -Infinity;
  for (const p of places) {
    const s = p.scope;
    const rows = await (
      s.kind === "personal"
        ? ctx.db.query("documents").withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", s.profileId).eq("inTrash", false).lt("updatedAt", before))
        : ctx.db.query("documents").withIndex("by_workspace_trash", (q) => q.eq("workspaceId", s.workspaceId).eq("inTrash", false).lt("updatedAt", before))
    )
      .order("desc")
      .take(cap);
    if (rows.length === cap) floor = Math.max(floor, rows[rows.length - 1]!.updatedAt);
    const reader = await PageReader.forScope(ctx, profile, s);
    for (const doc of await reader.filter(rows.filter((d) => (d.kind === "document" || d.kind === "daily") && !d.archivedAt && d.deletedAt === undefined))) found.push({ doc, place: p });
  }
  const certain = found.filter((f) => f.doc.updatedAt >= floor).sort((a, b) => b.doc.updatedAt - a.doc.updatedAt);
  const page = certain.slice(0, limit);
  if (certain.length > limit) return { page, nextCursor: encodeCursor(page[page.length - 1]!.doc.updatedAt) };
  return { page, nextCursor: floor > -Infinity ? encodeCursor(floor) : null };
}

/** A read, as the token's person. Returns the response body. */
export const read = internalQuery({
  args: { tokenId: v.id("apiTokens"), route: v.string(), id: v.optional(v.string()), query: v.any() },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const { token, profile } = await tokenContext(ctx, args.tokenId);
    const reach = await reachOf(ctx, token);
    const places = await grantPlaces(ctx, reach, profile);
    const q = (args.query ?? {}) as Args;
    switch (args.route as RouteName) {
      case "places":
        return { data: places.map(placeRef) };

      case "notes.list": {
        const within = placesFor(places, q.place);
        const text = str(q.q).trim();
        if (text) {
          const limit = Math.min(Number(q.limit ?? 10) || 10, 20);
          const out: Record<string, unknown>[] = [];
          for (const p of within) {
            for (const r of await searchDocuments(ctx, profile, p.scope, { query: text, limit })) {
              out.push({ id: r.id, title: r.title || "Untitled", place: placeRef(p), snippet: r.snippet ?? "", updatedAt: new Date(r.updatedAt).toISOString(), url: link(r.id) });
            }
          }
          return { data: out.slice(0, limit), nextCursor: null };
        }
        if (q.starred === "true") {
          // Starred by the person, most recently starred first (one page: stars are few).
          const limit = Math.min(Number(q.limit ?? 20) || 20, 50);
          const stars = await ctx.db
            .query("stars")
            .withIndex("by_profile", (x) => x.eq("profileId", profile._id))
            .order("desc")
            .take(200);
          const out: Record<string, unknown>[] = [];
          for (const star of stars) {
            if (out.length >= limit) break;
            const doc = await ctx.db.get(star.documentId);
            if (!doc || doc.inTrash || doc.archivedAt || doc.deletedAt !== undefined || (doc.kind !== "document" && doc.kind !== "daily")) continue;
            const place = within.find((p) => inScope(doc, p.scope));
            if (!place || !(await (await PageReader.forScope(ctx, profile, place.scope)).filter([doc])).length) continue;
            out.push({ id: doc.publicId, title: doc.title || "Untitled", place: placeRef(place), updatedAt: new Date(doc.updatedAt).toISOString(), url: link(doc.publicId) });
          }
          return { data: out, nextCursor: null };
        }
        const limit = Math.min(Number(q.limit ?? 20) || 20, 50);
        const before = typeof q.cursor === "string" && q.cursor ? decodeCursor(q.cursor) : Number.MAX_SAFE_INTEGER;
        const { page, nextCursor } = await recentPage(ctx, profile, within, before, limit);
        return {
          data: page.map(({ doc, place }) => ({ id: doc.publicId, title: doc.title || "Untitled", place: placeRef(place), updatedAt: new Date(doc.updatedAt).toISOString(), url: link(doc.publicId) })),
          nextCursor,
        };
      }

      case "notes.get": {
        const doc = await readableHere(ctx, reach, profile, places, args.id ?? "");
        const { markdown, folder, tags } = await noteDetail(ctx, profile, doc, places);
        const place = places.find((p) => inScope(doc, p.scope));
        return {
          id: doc.publicId,
          title: doc.title || "Untitled",
          place: place ? placeRef(place) : { id: null, name: await placeOf(ctx, doc, places) },
          folder,
          tags,
          url: link(doc.publicId),
          createdAt: new Date(doc.createdAt).toISOString(),
          updatedAt: new Date(doc.updatedAt).toISOString(),
          markdown,
        };
      }

      case "tasks.list": {
        const status = str(q.status) || "open";
        if (!["open", "done", "all"].includes(status)) fail("invalid_argument", 'status must be "open", "done" or "all".');
        const dueBefore = str(q.due_before);
        if (dueBefore && !DATE.test(dueBefore)) fail("invalid_argument", "due_before must be a date as YYYY-MM-DD.");
        const limit = Math.min(Number(q.limit ?? 100) || 100, 200);
        const today = localDate(Date.now(), profile.timeZone);
        const out: Record<string, unknown>[] = [];
        for (const p of placesFor(places, q.place)) {
          const views = status === "open" ? (["all"] as const) : status === "done" ? (["completed"] as const) : (["all", "completed"] as const);
          for (const view of views) {
            for (const t of await listTasks(ctx, profile, p.scope, view, today)) {
              if (dueBefore && (!t.dueDate || t.dueDate > dueBefore)) continue;
              out.push({
                id: t.blockId,
                text: t.title || "Untitled task",
                status: t.status,
                dueDate: t.dueDate ?? null,
                dueTime: t.dueTime ?? null,
                priority: t.priority,
                assigneeId: t.assigneeId ?? null,
                note: { id: t.documentId, title: t.documentTitle || "Untitled", url: link(t.documentId) },
                place: placeRef(p),
                url: `${link(t.documentId)}#block-${t.blockId}`,
              });
            }
          }
        }
        return { data: out.slice(0, limit), nextCursor: null };
      }
    }
    fail("not_found", "There's no such endpoint.");
  },
});

/** A write's answer (the HTTP layer sends it as is). */
type Answer = { status: number; body: Record<string, unknown>; replayed?: boolean };

/**
 * A write, as the token's person. With an Idempotency-Key, the first answer is kept for a day and sent
 * again for the same request (the same key with a different request is refused).
 */
export const write = internalMutation({
  args: { tokenId: v.id("apiTokens"), route: v.string(), id: v.optional(v.string()), body: v.any(), idempotencyKey: v.optional(v.string()), requestHash: v.string() },
  handler: async (ctx, args): Promise<Answer> => {
    const { token, profile } = await tokenContext(ctx, args.tokenId);
    let requestKey = ulid();
    if (args.idempotencyKey !== undefined) {
      requestKey = await sha256Base64url(`${token._id}|${args.idempotencyKey}`);
      const earlier = await ctx.db
        .query("apiRequests")
        .withIndex("by_key", (q) => q.eq("key", requestKey))
        .unique();
      if (earlier && earlier.createdAt > Date.now() - DAY) {
        if (earlier.requestHash !== args.requestHash) {
          return { status: 422, body: { error: { code: "idempotency_key_reused", message: "This Idempotency-Key was already used for a different request." } } };
        }
        return { status: earlier.status, body: JSON.parse(earlier.body) as Record<string, unknown>, replayed: true };
      }
      if (earlier) await ctx.db.delete(earlier._id);
    }
    await consume(ctx, "apiWrite", token._id);
    await consume(ctx, "apiWriteDaily", token._id);
    const reach = await reachOf(ctx, token);
    const places = await grantPlaces(ctx, reach, profile);
    const b = (args.body ?? {}) as Args;
    // A place the token can't use is a 403 here (the shared code would say it isn't found).
    if (b.place !== undefined) placesFor(places, b.place);
    const writer = { device: `api:${token._id}`, reason: "api" as const, app: { name: token.name, tokenId: token._id } };
    const run = async (tool: string, input: Args) => (await runWrite(ctx, reach, profile, tool, input, requestKey, writer)).result;
    let answer: Answer;
    switch (args.route as RouteName) {
      case "notes.create": {
        // Where it goes, as connected apps decide it: the place named, else Personal, else the only one.
        const target = b.place !== undefined ? placesFor(places, b.place)[0] : (places.find((p) => p.id === "personal") ?? (places.length === 1 ? places[0] : undefined));
        const r = await run("create_note", b);
        answer = { status: 201, body: { id: r.noteId, title: r.title, place: target ? placeRef(target) : null, inInbox: r.inInbox === true, url: r.url } };
        break;
      }
      case "notes.append": {
        const r = await run("append_to_note", { noteId: args.id, markdown: b.markdown });
        // Waiting for the person's review (they asked to see changes to existing notes first): 202, not made yet.
        answer = r.proposed
          ? { status: 202, body: { id: r.noteId, title: r.title, proposed: true, status: "pending", proposalId: r.proposalId, expiresAt: r.expiresAt, message: r.message, url: r.url } }
          : { status: 200, body: { id: r.noteId, title: r.title, added: r.added, url: r.url } };
        break;
      }
      case "tasks.create": {
        const r = await run("add_task", b);
        const note = r.note as { id: string; title: string };
        answer = { status: 201, body: { id: r.taskId, note: { ...note, url: link(note.id) }, url: r.url } };
        break;
      }
      case "tasks.update": {
        const fields = Object.keys(b).filter((k) => k !== "completed");
        const r = fields.length
          ? await run("update_task", { taskId: args.id, ...Object.fromEntries(fields.map((k) => [k, b[k]])), ...(typeof b.completed === "boolean" ? { done: b.completed } : {}) })
          : await run("complete_task", { taskId: args.id, done: b.completed !== false });
        answer = { status: 200, body: { id: r.taskId, completed: r.done, dueDate: r.dueDate, dueTime: r.dueTime, priority: r.priority, remindAt: r.remindAt } };
        break;
      }
      default:
        fail("not_found", "There's no such endpoint.");
    }
    if (args.idempotencyKey !== undefined) {
      await ctx.db.insert("apiRequests", { tokenId: token._id, profileId: profile._id, key: requestKey, requestHash: args.requestHash, status: answer.status, body: JSON.stringify(answer.body), createdAt: Date.now() });
    }
    await touch(ctx, token);
    return answer;
  },
});

/** Drops kept answers older than a day (hourly). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("apiRequests")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - DAY))
      .take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
