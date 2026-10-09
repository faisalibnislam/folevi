// Memory (docs/AI_ASSISTANT.md, "Memory, suggestions, digests"): what the assistant remembers about how
// a person likes it to write (tone, language, length, terms, standing instructions).
//
// Only the person writes entries: in Settings > AI (add, edit, delete, clear all), or by clicking Save on a
// preference a chat answer offered (`saveProposal`); an offer nobody saved is never stored as memory. An
// entry in their Personal applies everywhere they use AI; one in a workspace only there. Entries are
// private to the person, even in a shared workspace.
//
// While memory is on (Settings > AI), `forHold` gives every AI request the person's entries for where it
// runs (convex/ai.ts metered, lib/ai/memory.ts). Off: nothing is added to prompts and chats offer nothing;
// the entries stay listed (and can be deleted) until the person deletes them.
//
// Privacy: memory text is never logged.
import { v } from "convex/values";
import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { insertScoped, personalScope, type Scope } from "./lib/scope";
import { aiPrefsOf } from "./lib/ai/prefs";
import { cleanMemoryText, MAX_MEMORIES, memoryKey, memoryPrompt, vMemoryKind, type MemoryKind } from "./lib/ai/memory";

type Ctx = QueryCtx | MutationCtx;

/** A person's entries in one place: everywhere (their Personal) or one workspace. */
function entriesIn(ctx: Ctx, profileId: Id<"profiles">, workspaceId?: Id<"workspaces">) {
  return ctx.db
    .query("aiMemories")
    .withIndex("by_profile", (q) => (workspaceId ? q.eq("profileId", profileId).eq("ownerProfileId", undefined).eq("workspaceId", workspaceId) : q.eq("profileId", profileId).eq("ownerProfileId", profileId)));
}

/** The person's own entry (never someone else's). */
async function ownEntry(ctx: Ctx, profile: Doc<"profiles">, id: Id<"aiMemories">): Promise<Doc<"aiMemories">> {
  const row = await ctx.db.get(id);
  if (!row || row.profileId !== profile._id) fail("not_found", "That memory isn't there anymore.");
  return row;
}

/** Adds an entry, unless the same one is already there. Refused at MAX_MEMORIES in one place. */
async function addEntry(ctx: MutationCtx, profile: Doc<"profiles">, scope: Scope, kind: MemoryKind, raw: string, source: "settings" | "chat"): Promise<Id<"aiMemories">> {
  const text = cleanMemoryText(raw);
  if (text.length < 2) fail("invalid_argument", "Write what to remember first.");
  const existing = await entriesIn(ctx, profile._id, scope.kind === "workspace" ? scope.workspaceId : undefined).take(MAX_MEMORIES + 1);
  const same = existing.find((e) => memoryKey(e.kind, e.text) === memoryKey(kind, text));
  if (same) return same._id;
  if (existing.length >= MAX_MEMORIES) fail("limit_exceeded", `You can keep ${MAX_MEMORIES} memories here. Delete one first.`);
  const now = Date.now();
  return await insertScoped(ctx, "aiMemories", scope, { profileId: profile._id, kind, text, source, createdAt: now, updatedAt: now });
}

const wire = (e: Doc<"aiMemories">, workspace: { id: string; name: string } | null) => ({
  id: e._id,
  kind: e.kind,
  text: e.text,
  source: e.source,
  /** Null: everywhere. Otherwise only in this workspace. */
  workspace,
  updatedAt: e.updatedAt,
});

/**
 * The person's memory: whether it's on, and their entries for everywhere plus the ones for each
 * workspace they're still in (newest first).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("aiMemories")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(400);
    const names = new Map<Id<"workspaces">, { id: string; name: string } | null>();
    const items = [];
    for (const e of rows) {
      let workspace: { id: string; name: string } | null = null;
      if (e.workspaceId) {
        if (!names.has(e.workspaceId)) {
          const ws = await ctx.db.get(e.workspaceId);
          const member = ws
            ? await ctx.db
                .query("workspaceMembers")
                .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", ws._id).eq("profileId", profile._id))
                .unique()
            : null;
          names.set(e.workspaceId, ws && member && ws.status !== "deleting" ? { id: ws.publicId, name: ws.name } : null);
        }
        workspace = names.get(e.workspaceId)!;
        if (!workspace) continue;
      }
      items.push(wire(e, workspace));
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return { on: aiPrefsOf(profile).memory && profile.aiEnabled !== false, max: MAX_MEMORIES, items };
  },
});

/** Adds an entry, for everywhere (Personal, the default) or only in a workspace the person is in. */
export const add = mutation({
  args: { kind: vMemoryKind, text: v.string(), workspaceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "bulk", profile._id);
    const scope = args.workspaceId ? (await resolveScope(ctx, profile, { kind: "workspace", workspaceId: args.workspaceId })).scope : personalScope(profile._id);
    return await addEntry(ctx, profile, scope, args.kind, args.text, "settings");
  },
});

/** Changes an entry's kind or words. */
export const update = mutation({
  args: { id: v.id("aiMemories"), kind: v.optional(vMemoryKind), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await ownEntry(ctx, profile, args.id);
    const text = args.text === undefined ? row.text : cleanMemoryText(args.text);
    if (text.length < 2) fail("invalid_argument", "Write what to remember first.");
    await ctx.db.patch(row._id, { kind: args.kind ?? row.kind, text, updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("aiMemories") },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const row = await ownEntry(ctx, profile, args.id);
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Deletes every entry the person has, everywhere. Returns how many went. */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("aiMemories")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(1000);
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

/** One of the person's own answers that offers a memory still waiting for a choice. */
async function proposalOf(ctx: MutationCtx, profile: Doc<"profiles">, messageId: Id<"aiMessages">) {
  const m = await ctx.db.get(messageId);
  if (!m || m.profileId !== profile._id || m.role !== "assistant" || !m.memory) fail("not_found", "That suggestion isn't there anymore.");
  return { message: m, memory: m.memory };
}

/**
 * Save on a chat's offer to remember a preference: the one thing that turns an offer into memory. Saved
 * for everywhere (it's about how the person likes the assistant to write). Refused while memory is off.
 */
export const saveProposal = mutation({
  args: { messageId: v.id("aiMessages") },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { message, memory } = await proposalOf(ctx, profile, args.messageId);
    if (!aiPrefsOf(profile).memory) fail("forbidden", "Memory is turned off in Settings > AI.");
    if (memory.status === "saved") return null;
    await addEntry(ctx, profile, personalScope(profile._id), memory.kind, memory.text, "chat");
    await ctx.db.patch(message._id, { memory: { ...memory, status: "saved" } });
    return null;
  },
});

/** "Not now" on a chat's offer: nothing is remembered and the offer goes away. */
export const dismissProposal = mutation({
  args: { messageId: v.id("aiMessages") },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { message, memory } = await proposalOf(ctx, profile, args.messageId);
    if (memory.status === "proposed") await ctx.db.patch(message._id, { memory: { ...memory, status: "dismissed" } });
    return null;
  },
});

/**
 * The preferences block for an AI request, from its credit hold (the person, and where it runs): null
 * while memory or AI is off, or when there's nothing saved. Used by `metered` for every request, including
 * background jobs (research, digests), so it reads only the rows the hold names.
 */
export const forHold = internalQuery({
  args: { holdId: v.id("aiCreditHolds") },
  handler: async (ctx, args): Promise<string | null> => {
    const hold = await ctx.db.get(args.holdId);
    if (!hold) return null;
    const profile = await ctx.db.get(hold.profileId);
    if (!profile || (profile.status !== "active" && profile.status !== "pending_deletion") || profile.aiEnabled === false || !aiPrefsOf(profile).memory) return null;
    const here = hold.scope === "workspace" && hold.scopeWorkspaceId ? await entriesIn(ctx, profile._id, hold.scopeWorkspaceId).take(MAX_MEMORIES) : [];
    const everywhere = await entriesIn(ctx, profile._id).take(MAX_MEMORIES);
    const newest = (rows: Doc<"aiMemories">[]) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
    return memoryPrompt([...newest(here), ...newest(everywhere)]);
  },
});
