// One-off data backfills. Each runs in small batches and reschedules itself until done, so it is safe on
// large deployments. Run with `npx convex run migrations:<name>`.
import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { refreshDerived } from "./lib/documents";
import { randomNoteEmoji, randomNoteCover } from "@folevi/editor-schema";
import { isFolderColor, randomFolderColor } from "./lib/folderColors";
import { ensureSubscription, startTrial } from "./lib/billing";
import { isLegacyRole, memberToAccess, normalizeMembership, roleToAccess, type Access } from "./lib/auth";
import { workspaceStorageOverride } from "./lib/entitlements";
import { bump } from "./lib/metrics";
import { hasValidScope, insertScoped, SCOPED_TABLES, sameScope, scopedRows, scopeOfRow, workspaceScope, type ScopedTable } from "./lib/scope";

/** Fills in the card preview (documents.preview) for pages saved before previews existed. */
export const backfillDocumentPreviews = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 50, cursor: args.cursor ?? null });
    let updated = 0;
    for (const doc of page.page) {
      if (doc.preview !== undefined) continue;
      await refreshDerived(ctx, doc);
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.backfillDocumentPreviews, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/** Gives every note without an icon a random emoji (notes always have an icon now). */
export const backfillNoteIcons = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 100, cursor: args.cursor ?? null });
    let updated = 0;
    for (const doc of page.page) {
      if (doc.icon || doc.kind !== "document") continue;
      await ctx.db.patch(doc._id, { icon: randomNoteEmoji() });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.backfillNoteIcons, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/** Gives every folder without a colour a random pastel (folders show a coloured folder, not an emoji). */
export const backfillFolderColors = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const f of await ctx.db.query("folders").collect()) {
      if (f.color) continue;
      await ctx.db.patch(f._id, { color: randomFolderColor(), icon: undefined });
      updated++;
    }
    return { updated };
  },
});

/** Wide page became the default: notes on the old default (or the seed's narrow) width become wide. */
export const wideByDefault = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let updated = 0;
    for (const d of page.page) {
      if (d.style.width === "wide") continue;
      await ctx.db.patch(d._id, { style: { ...d.style, width: "wide" } });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.wideByDefault, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/**
 * The 40 mesh-gradient note styles replaced the old artwork: every note gets a random one, with its page and
 * text colours back on Auto (taken from the style) and no separate page backdrop.
 */
export const randomizeNoteStyles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let updated = 0;
    for (const d of page.page) {
      if (d.kind !== "document") continue;
      const { sheet: _sheet, text: _text, backdrop: _backdrop, ...style } = d.style as typeof d.style & { sheet?: string; text?: string; backdrop?: string };
      await ctx.db.patch(d._id, { cover: randomNoteCover(), style: { ...style, width: "wide" } });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.randomizeNoteStyles, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/**
 * Folder colours became the note styles' light page colours. Moves each folder from its old colour to the
 * new one closest in hue (neutrals to neutrals); anything unknown gets a random new colour.
 */
const OLD_FOLDER_COLOR_TO_STYLE: Record<string, string> = {"rose":"deco","blush":"red-lacquer","peach":"rust","apricot":"peeling-paint","butter":"runners","raspberry":"deco","coral":"red-lacquer","terracotta":"rust","tangerine":"peeling-paint","honey":"runners","lemon":"cypresses","pistachio":"crackle-green","mint":"irises","seafoam":"irises","aqua":"summer-sky","olive":"cypresses","sage":"crackle-green","jade":"irises","teal":"irises","steel":"summer-sky","sky":"tarp-blue","periwinkle":"navy-crackle","lavender":"ultramarine","lilac":"ultramarine","orchid":"deco","powder":"tarp-blue","cornflower":"navy-crackle","iris":"ultramarine","plum":"ultramarine","mauve":"deco","sand":"weathered-wood","stone":"wood-thrush","clay":"poppy-print","graphite":"watercolour-marsh","slate":"midnight-rose"};
export const folderColorsFromStyles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("folders").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let updated = 0;
    for (const f of page.page) {
      if (f.color && isFolderColor(f.color)) continue;
      const mapped = f.color ? OLD_FOLDER_COLOR_TO_STYLE[f.color] : undefined;
      await ctx.db.patch(f._id, { color: mapped && isFolderColor(mapped) ? mapped : randomFolderColor() });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.folderColorsFromStyles, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/**
 * Billing arrived: every existing account gets a billing row with the same 7-day Pro trial new accounts
 * get (so nobody loses AI the moment plans start). Accounts that already have one are left alone.
 */
export const startBillingForExistingUsers = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("profiles").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let created = 0;
    for (const p of page.page) {
      if (p.status === "deleted") continue;
      const has = await ctx.db
        .query("subscriptions")
        .withIndex("by_profile", (q) => q.eq("profileId", p._id))
        .unique();
      if (has) continue;
      await startTrial(ctx, p._id);
      created++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.startBillingForExistingUsers, { cursor: page.continueCursor });
    return { created, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------------------------------
// Account model, phase B: Personal is not a workspace (docs/ACCOUNT_MODEL_PLAN.md, "Phase B runbook").
//
//   npx convex run migrations:migratePersonalWorkspaces    starts it; it continues itself in batches
//   npx convex run migrations:verifyAccountModel           starts the check (a background job)
//   npx convex run migrations:accountModelReport           `done: true`, then every count must be 0 (`ok: true`)
//
// Every step is a bounded mutation that schedules the next: grants look at up to GRANT_PAGE top-level
// pages and stop starting new page trees after GRANT_STEP_NODES pages (resuming in the same page with
// `skip`), a single tree is capped at MAX_GRANT_TREE, moves patch at most MOVE_BUDGET rows. A failed step
// can simply be run again (or the whole migration restarted): every step is idempotent.
//
// For each workspace of kind "personal", one at a time:
//   1. grants — each collaborator (a member other than the owner) becomes a page guest on what they could
//      open, mapped editor/admin → editor, commenter → commenter, viewer → viewer. Grants go on the highest
//      pages whose whole subtree they could open at least as well, so nobody gains access (planGrants).
//   2. move   — every content row with that workspaceId moves to the owner's Personal (ownerProfileId =
//      owner, workspaceId unset). `seq` values are kept, so change order is preserved. Its notifications
//      lose the workspace, its invitations are removed and its AI usage becomes Personal usage.
//   3. finish — counters move to the owner's profile (changeSeq → personalChangeSeq, storage used, document
//      count; an admin storage override → their subscription), memberships and the workspace row are
//      deleted, and defaultWorkspaceId is cleared.
// Then defaultWorkspaceId is cleared on every profile. Each step is idempotent: running the whole thing
// again (or any step again) never duplicates a grant or counts anything twice, and finished workspaces
// are gone.
// ---------------------------------------------------------------------------------------------------

const MOVE_BUDGET = 400;
const GRANT_PAGE = 10;
/**
 * Pages under one top-level page considered at once; a bigger tree gets no grants (reported, never
 * over-granted). Each page costs two reads (its grant, its children), so one tree stays well inside a
 * mutation's limits.
 */
const MAX_GRANT_TREE = 1000;
/** Members of one personal workspace considered for guest grants (its member limit was far lower). */
const MAX_COLLABORATORS = 1000;
/** After this many pages in one step, no new tree is started in it (the next step resumes). */
const GRANT_STEP_NODES = 250;

const vPhase = v.union(v.literal("grants"), v.literal("move"), v.literal("finish"));

/** Starts (or resumes) the migration with the next personal workspace; clears defaultWorkspaceId at the end. */
export const migratePersonalWorkspaces = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ next: string | null }> => {
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_kind", (q) => q.eq("kind", "personal"))
      .first();
    if (!ws) {
      await ctx.scheduler.runAfter(0, internal.migrations.clearDefaultWorkspaces, { cursor: null });
      return { next: null };
    }
    await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspace, { workspaceId: ws._id, phase: "grants", member: 0, cursor: null });
    return { next: ws.publicId };
  },
});

/** One bounded step of one personal workspace's migration; schedules the next step. */
export const migratePersonalWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    phase: vPhase,
    member: v.number(),
    cursor: v.union(v.string(), v.null()),
    /** Grants: pages of this batch (`cursor`) already handled by the previous step. */
    skip: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws || ws.kind !== "personal") {
      await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspaces, {});
      return { phase: "gone" as const };
    }
    if (args.phase === "grants") {
      // A personal workspace had a small member limit; the cap only keeps a corrupt one bounded.
      const collaborators = (
        await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
          .take(MAX_COLLABORATORS)
      ).filter((m) => m.profileId !== ws.ownerId);
      const member = collaborators[args.member];
      if (!member) {
        await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspace, { workspaceId: ws._id, phase: "move", member: 0, cursor: null });
        return { phase: "grants" as const, done: true };
      }
      const person = await ctx.db.get(member.profileId);
      const page = await ctx.db
        .query("documents")
        .withIndex("by_workspace_created", (q) => q.eq("workspaceId", ws._id))
        .paginate({ cursor: args.cursor, numItems: GRANT_PAGE });
      const stats = { granted: 0, notReachable: 0, tooLarge: 0 };
      let next: { member: number; cursor: string | null; skip?: number } = page.isDone ? { member: args.member + 1, cursor: null } : { member: args.member, cursor: page.continueCursor };
      if (person && person.status !== "deleted") {
        let visited = 0;
        for (let i = args.skip ?? 0; i < page.page.length; i++) {
          if (visited >= GRANT_STEP_NODES) {
            // Enough for one step: the next one reads the same batch and carries on from here.
            next = { member: args.member, cursor: args.cursor, skip: i };
            break;
          }
          const doc = page.page[i]!;
          if (!doc.parentDocumentId) visited += await grantGuestAccess(ctx, ws, member, person, doc, stats);
        }
      }
      await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspace, { workspaceId: ws._id, phase: "grants", ...next });
      if (stats.notReachable || stats.tooLarge) console.log(JSON.stringify({ event: "migration.personal_guest_gaps", workspace: ws.publicId, ...stats }));
      return { phase: "grants" as const, ...stats };
    }
    if (args.phase === "move") {
      const done = await moveRows(ctx, ws);
      await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspace, { workspaceId: ws._id, phase: done ? "finish" : "move", member: 0, cursor: null });
      return { phase: "move" as const, done };
    }
    const gone = await finishWorkspace(ctx, ws);
    if (gone) await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspaces, {});
    else await ctx.scheduler.runAfter(0, internal.migrations.migratePersonalWorkspace, { workspaceId: ws._id, phase: "finish", member: 0, cursor: null });
    return { phase: "finish" as const, done: gone };
  },
});

const ACCESS_RANK: Record<Access, number> = { none: -1, read: 0, comment: 1, write: 2, manage: 3 };
const RANK_ROLE: Record<number, Doc<"documentPermissions">["role"]> = { 0: "viewer", 1: "commenter", 2: "editor" };
/** A guest's grant is at most "editor" (write): what someone could manage becomes editable. */
const capped = (rank: number) => Math.min(rank, ACCESS_RANK.write);

interface GrantNode {
  doc: Doc<"documents">;
  /** The collaborator's access before the migration (lib/auth.ts documentAccess rules for a member). */
  old: number;
  /** Their existing grant on this page (kept: it moves with the page), or -1. */
  existing: Doc<"documentPermissions"> | null;
  children: GrantNode[];
  /** The lowest capped old access in this subtree. */
  min: number;
}

/**
 * Builds a top-level page's tree with the collaborator's pre-migration access to each page, computed top
 * down with the rules documentAccess applied to members (role, restricted pages, creator, grants).
 */
async function grantTree(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  member: Doc<"workspaceMembers">,
  person: Doc<"profiles">,
  root: Doc<"documents">,
): Promise<{ tree: GrantNode | null; visited: number }> {
  let count = 0;
  const role = normalizeMembership(member).role;
  const build = async (doc: Doc<"documents">, parentRestricted: boolean, parentGrant: number): Promise<GrantNode | null> => {
    if (++count > MAX_GRANT_TREE) return null;
    const existing = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", person._id))
      .unique();
    const grant = Math.max(parentGrant, existing ? ACCESS_RANK[roleToAccess(existing.role)] : -1);
    const restricted = parentRestricted || doc.accessMode === "restricted";
    let old: number;
    if (ws.status === "suspended" && role !== "owner") old = ACCESS_RANK.read;
    else if (role === "admin" || role === "owner") old = ACCESS_RANK.manage;
    else if (restricted) old = doc.createdBy === person._id ? ACCESS_RANK.manage : grant;
    else old = Math.max(ACCESS_RANK[memberToAccess(member)], grant);
    // Never read more children than the tree may still hold.
    const room = MAX_GRANT_TREE - count;
    const kids = await ctx.db
      .query("documents")
      .withIndex("by_parent", (q) => q.eq("parentDocumentId", doc._id))
      .take(room + 1);
    if (kids.length > room) return null;
    const children: GrantNode[] = [];
    let min = capped(old);
    for (const kid of kids) {
      const child = await build(kid, restricted, grant);
      if (!child) return null;
      children.push(child);
      min = Math.min(min, child.min);
    }
    return { doc, old, existing, children, min };
  };
  const tree = await build(root, false, -1);
  return { tree, visited: Math.min(count, MAX_GRANT_TREE) };
}

/**
 * Makes a collaborator in someone's personal workspace a guest on the pages they could open (returns the
 * number of pages looked at). A grant on a
 * page reaches every page under it, so a page gets a grant only when nothing under it was less open to
 * them — nobody gains access; a page whose subtree holds something they couldn't open (a restricted page)
 * is left to the grants below it, and counted in `notReachable` when it ends up less open than before.
 */
async function grantGuestAccess(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  member: Doc<"workspaceMembers">,
  person: Doc<"profiles">,
  root: Doc<"documents">,
  stats: { granted: number; notReachable: number; tooLarge: number },
): Promise<number> {
  const { tree, visited } = await grantTree(ctx, ws, member, person, root);
  if (!tree) {
    stats.tooLarge++;
    return visited;
  }
  const plan = async (node: GrantNode, inherited: number) => {
    const existing = node.existing ? ACCESS_RANK[roleToAccess(node.existing.role)] : -1;
    let have = Math.max(inherited, existing);
    const want = capped(node.old);
    if (want > have && node.min >= want) {
      const role = RANK_ROLE[want]!;
      if (node.existing) await ctx.db.patch(node.existing._id, { role });
      else {
        // In the workspace's scope for now: the move step takes it to the owner's Personal with the page.
        await insertScoped(ctx, "documentPermissions", workspaceScope(ws._id), { documentId: node.doc._id, profileId: person._id, role, grantedBy: ws.ownerId, createdAt: Date.now() });
      }
      stats.granted++;
      have = want;
    }
    if (want > have) stats.notReachable++;
    for (const child of node.children) await plan(child, have);
  };
  await plan(tree, -1);
  return visited;
}

/** Moves a bounded batch of the workspace's rows to the owner's Personal. True when nothing is left. */
async function moveRows(ctx: MutationCtx, ws: Doc<"workspaces">): Promise<boolean> {
  let budget = MOVE_BUDGET;
  const from = workspaceScope(ws._id);
  for (const table of SCOPED_TABLES) {
    while (budget > 0) {
      const rows = await scopedRows(ctx, table, from, Math.min(budget, 100));
      if (!rows.length) break;
      for (const r of rows) {
        // Every scoped table has these two fields (lib/scope.ts); the id's table is only nominal here.
        await ctx.db.patch(r._id as Id<"folders">, { workspaceId: undefined, ownerProfileId: ws.ownerId });
        budget--;
      }
    }
    if (budget <= 0) return false;
  }
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .take(budget);
  for (const n of notes) {
    // Invitations to it are gone with it; anything else simply isn't in a workspace any more.
    if (n.kind === "invite") await ctx.db.delete(n._id);
    else await ctx.db.patch(n._id, { workspaceId: undefined });
    budget--;
  }
  const invites = await ctx.db
    .query("workspaceInvites")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .take(Math.max(1, budget));
  for (const i of invites) {
    await ctx.db.delete(i._id);
    budget--;
  }
  const usage = await ctx.db
    .query("aiUsage")
    .withIndex("by_workspace_day", (q) => q.eq("workspaceId", ws._id))
    .take(Math.max(1, budget));
  for (const u of usage) {
    await ctx.db.patch(u._id, { scope: "personal", workspaceId: undefined });
    budget--;
  }
  return budget > 0;
}

/**
 * Deletes the workspace's memberships (a bounded batch per call), then — in the same mutation as the last
 * batch — moves its counters to its owner and deletes it. True when the workspace is gone. The counters
 * move exactly once: only the call that deletes the workspace moves them.
 */
async function finishWorkspace(ctx: MutationCtx, ws: Doc<"workspaces">): Promise<boolean> {
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .take(MOVE_BUDGET + 1);
  for (const m of members.slice(0, MOVE_BUDGET)) await ctx.db.delete(m._id);
  if (members.length > MOVE_BUDGET) return false;
  const owner = await ctx.db.get(ws.ownerId);
  if (owner) {
    await ctx.db.patch(owner._id, {
      // Seq values were kept, so the Personal counter continues where the workspace's stopped.
      personalChangeSeq: Math.max(owner.personalChangeSeq ?? 0, ws.changeSeq),
      personalStorageUsedBytes: (owner.personalStorageUsedBytes ?? 0) + ws.storageUsedBytes,
      personalDocumentCount: (owner.personalDocumentCount ?? 0) + ws.documentCount,
      defaultWorkspaceId: owner.defaultWorkspaceId === ws._id ? undefined : owner.defaultWorkspaceId,
    });
    // An admin's storage limit on the old personal workspace becomes the person's own override.
    const override = workspaceStorageOverride(ws);
    if (override !== undefined) {
      const sub = await ensureSubscription(ctx, owner._id);
      if (sub.storageOverrideBytes === undefined) await ctx.db.patch(sub._id, { storageOverrideBytes: override, updatedAt: Date.now() });
    }
  }
  await ctx.db.delete(ws._id);
  await bump(ctx, "workspaces_total", -1);
  return true;
}

/** Clears the old model's defaultWorkspaceId on every profile (the last step of the migration). */
export const clearDefaultWorkspaces = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("profiles").paginate({ cursor: args.cursor, numItems: 200 });
    let cleared = 0;
    for (const p of page.page) {
      if (p.defaultWorkspaceId === undefined) continue;
      await ctx.db.patch(p._id, { defaultWorkspaceId: undefined });
      cleared++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.clearDefaultWorkspaces, { cursor: page.continueCursor });
    return { cleared, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------------------------------
// Account model, phase D: membership roles are owner | admin | member (docs/ACCOUNT_MODEL_PLAN.md).
//
//   npx convex run migrations:normalizeWorkspaceRoles      rewrites old member roles; continues itself
//
// editor → member (edit), commenter → member + memberAccess "comment", viewer → member + memberAccess
// "view", on workspaceMembers and workspaceInvites. Nobody's access changes: the code already reads the old
// names that way (lib/auth.ts normalizeMembership), so it's safe to deploy first and migrate after. Seats
// don't change (every membership role takes one). Idempotent: rows already migrated are skipped.
// ---------------------------------------------------------------------------------------------------

const ROLE_PAGE = 200;

export const normalizeWorkspaceRoles = internalMutation({
  args: { table: v.optional(v.union(v.literal("workspaceMembers"), v.literal("workspaceInvites"))), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ table: string; updated: number; done: boolean }> => {
    const table = args.table ?? "workspaceMembers";
    const page = await ctx.db.query(table).paginate({ cursor: args.cursor ?? null, numItems: ROLE_PAGE });
    let updated = 0;
    for (const row of page.page) {
      if (!isLegacyRole(row.role)) continue;
      const { memberAccess } = normalizeMembership(row);
      await ctx.db.patch(row._id, { role: "member", memberAccess: memberAccess === "edit" ? undefined : memberAccess });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.normalizeWorkspaceRoles, { table, cursor: page.continueCursor });
    else if (table === "workspaceMembers") await ctx.scheduler.runAfter(0, internal.migrations.normalizeWorkspaceRoles, { table: "workspaceInvites", cursor: null });
    if (updated) console.log(JSON.stringify({ event: "migration.roles_normalized", table, updated }));
    return { table, updated, done: page.isDone && table === "workspaceInvites" };
  },
});

// ---------------------------------------------------------------- verification
//
//   npx convex run migrations:verifyAccountModel     starts a check (a background job; returns at once)
//   npx convex run migrations:accountModelReport     the latest check: `done`, then `ok` and every count
//
// The check pages through every scoped table, profiles, memberships, invitations and workspaces. Each run
// of the job reads a bounded number of pages (queries, so it never conflicts with live writes), adds what
// it found to its `migrationReports` row and schedules the next run, so it finishes at any database size.
// A run only saves if the row is still where it started (stage + cursor), so a duplicate run can't count a
// page twice.

const VERIFY_PAGE = 500;
const VERIFY_PAGES_PER_RUN = 10;
const ACCOUNT_MODEL_REPORT = "accountModel";

interface TableCheck {
  rows: number;
  /** Both ownerProfileId and workspaceId set. */
  both: number;
  /** Neither set. */
  neither: number;
  /** workspaceId points at a personal (unmigrated) or missing workspace. */
  legacyWorkspace: number;
  /** In a different scope than the document it belongs to. */
  outOfScope: number;
  /** documentPermissions only: the page or the person is gone. */
  orphanedGrants: number;
}
const vTableCheck = v.object({ rows: v.number(), both: v.number(), neither: v.number(), legacyWorkspace: v.number(), outOfScope: v.number(), orphanedGrants: v.number() });
const emptyCheck = (): TableCheck => ({ rows: 0, both: 0, neither: 0, legacyWorkspace: 0, outOfScope: 0, orphanedGrants: 0 });

/** The report's totals (all must be 0 for `ok`). */
const vReportCounts = v.object({
  rowsWithBothScopes: v.number(),
  rowsWithNoScope: v.number(),
  rowsInLegacyWorkspaces: v.number(),
  rowsOutOfTheirDocumentsScope: v.number(),
  orphanedGrants: v.number(),
  personalWorkspaces: v.number(),
  profilesWithDefaultWorkspace: v.number(),
  /** Memberships and invitations still holding editor / commenter / viewer (Phase D: normalizeWorkspaceRoles). */
  legacyRoles: v.number(),
});
type ReportCounts = Infer<typeof vReportCounts>;
const emptyCounts = (): ReportCounts => ({
  rowsWithBothScopes: 0,
  rowsWithNoScope: 0,
  rowsInLegacyWorkspaces: 0,
  rowsOutOfTheirDocumentsScope: 0,
  orphanedGrants: 0,
  personalWorkspaces: 0,
  profilesWithDefaultWorkspace: 0,
  legacyRoles: 0,
});

/** What the job reads, in order: every scoped table, then the account-level checks. */
const VERIFY_STAGES = [...SCOPED_TABLES, "profiles", "workspaceMembers", "workspaceInvites", "personalWorkspaces"] as const;
type VerifyStage = (typeof VERIFY_STAGES)[number];

type LooseRow = Record<string, unknown> & { workspaceId?: Id<"workspaces">; ownerProfileId?: Id<"profiles"> };
interface LoosePages {
  paginate(opts: { cursor: string | null; numItems: number }): Promise<{ page: LooseRow[]; isDone: boolean; continueCursor: string }>;
}

const documentOf = (table: ScopedTable, row: Record<string, unknown>): Id<"documents"> | undefined =>
  table === "documents" ? undefined : ((row.documentId ?? row.sourceDocumentId) as Id<"documents"> | undefined);

const vPageArgs = { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) };

/** One page of one scoped table's checks. */
export const verifyAccountModelPage = internalQuery({
  args: { table: v.string(), ...vPageArgs },
  handler: async (ctx, args): Promise<TableCheck & { isDone: boolean; continueCursor: string }> => {
    const table = SCOPED_TABLES.find((t) => t === args.table);
    if (!table) throw new Error(`Not a scoped table: ${args.table}`);
    // The table is a variable, so the query is typed loosely (every scoped table has the scope fields).
    const page = await (ctx.db.query(table) as unknown as LoosePages).paginate({ cursor: args.cursor, numItems: args.numItems ?? VERIFY_PAGE });
    const check = emptyCheck();
    const docs = new Map<string, Doc<"documents"> | null>();
    const kinds = new Map<string, string | null>();
    const people = new Map<string, boolean>();
    for (const raw of page.page) {
      check.rows++;
      if (raw.workspaceId !== undefined && raw.ownerProfileId !== undefined) check.both++;
      else if (raw.workspaceId === undefined && raw.ownerProfileId === undefined) check.neither++;
      if (raw.workspaceId !== undefined) {
        if (!kinds.has(raw.workspaceId)) kinds.set(raw.workspaceId, (await ctx.db.get(raw.workspaceId))?.kind ?? null);
        if (kinds.get(raw.workspaceId) !== "team") check.legacyWorkspace++;
      }
      const documentId = documentOf(table, raw);
      if (documentId) {
        if (!docs.has(documentId)) docs.set(documentId, await ctx.db.get(documentId));
        const doc = docs.get(documentId);
        if (doc && hasValidScope(doc) && hasValidScope(raw) && !sameScope(scopeOfRow(doc), scopeOfRow(raw))) check.outOfScope++;
        if (table === "documentPermissions") {
          const profileId = raw.profileId as Id<"profiles">;
          if (!people.has(profileId)) people.set(profileId, (await ctx.db.get(profileId)) !== null);
          if (!doc || !people.get(profileId)) check.orphanedGrants++;
        }
      }
    }
    return { ...check, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** One page of profiles: how many still point at a default workspace. */
export const verifyProfilesPage = internalQuery({
  args: vPageArgs,
  handler: async (ctx, args): Promise<{ withDefaultWorkspace: number; isDone: boolean; continueCursor: string }> => {
    const page = await ctx.db.query("profiles").paginate({ cursor: args.cursor, numItems: args.numItems ?? VERIFY_PAGE });
    return { withDefaultWorkspace: page.page.filter((p) => p.defaultWorkspaceId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** One page of membership or invitation rows still holding an old member role. */
export const verifyRolesPage = internalQuery({
  args: { table: v.union(v.literal("workspaceMembers"), v.literal("workspaceInvites")), ...vPageArgs },
  handler: async (ctx, args): Promise<{ legacy: number; isDone: boolean; continueCursor: string }> => {
    const page = await ctx.db.query(args.table).paginate({ cursor: args.cursor, numItems: args.numItems ?? VERIFY_PAGE });
    return { legacy: page.page.filter((r) => isLegacyRole(r.role)).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** One page of personal workspaces still left. */
export const verifyPersonalWorkspacesPage = internalQuery({
  args: vPageArgs,
  handler: async (ctx, args): Promise<{ personal: number; isDone: boolean; continueCursor: string }> => {
    const page = await ctx.db
      .query("workspaces")
      .withIndex("by_kind", (q) => q.eq("kind", "personal"))
      .paginate({ cursor: args.cursor, numItems: args.numItems ?? VERIFY_PAGE });
    return { personal: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Starts a check of the account model over the whole deployment, as a background job (see above): every
 * content row has exactly one of ownerProfileId / workspaceId, none is left in a personal workspace, rows
 * are in their document's scope, no grant is orphaned, no personal workspace, defaultWorkspaceId or old
 * member role remains. Read the result with `migrations:accountModelReport` (`ok` only when every count
 * is 0). `pageSize` / `pagesPerRun` are for tests.
 */
export const verifyAccountModel = internalMutation({
  args: { pageSize: v.optional(v.number()), pagesPerRun: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ reportId: Id<"migrationReports">; started: true; next: string }> => {
    const now = Date.now();
    const reportId = await ctx.db.insert("migrationReports", {
      name: ACCOUNT_MODEL_REPORT,
      stage: 0,
      cursor: null,
      done: false,
      counts: emptyCounts(),
      tables: {},
      runs: 0,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.migrations.verifyAccountModelRun, { reportId, pageSize: args.pageSize, pagesPerRun: args.pagesPerRun });
    return { reportId, started: true, next: "npx convex run migrations:accountModelReport" };
  },
});

/** Where a check has got to (for its next run). */
export const verifyAccountModelState = internalQuery({
  args: { reportId: v.id("migrationReports") },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.reportId);
    return r ? { stage: r.stage, cursor: r.cursor, done: r.done } : null;
  },
});

/** Adds one run's findings to the report, if nobody else has moved it on meanwhile. */
export const saveAccountModelProgress = internalMutation({
  args: {
    reportId: v.id("migrationReports"),
    from: v.object({ stage: v.number(), cursor: v.union(v.string(), v.null()) }),
    to: v.object({ stage: v.number(), cursor: v.union(v.string(), v.null()) }),
    counts: vReportCounts,
    tables: v.record(v.string(), vTableCheck),
  },
  handler: async (ctx, args): Promise<{ saved: boolean; done: boolean }> => {
    const r = await ctx.db.get(args.reportId);
    if (!r || r.done || r.stage !== args.from.stage || r.cursor !== args.from.cursor) return { saved: false, done: r?.done ?? true };
    const counts = { ...r.counts };
    for (const key of Object.keys(counts) as (keyof ReportCounts)[]) counts[key] += args.counts[key];
    const tables = { ...r.tables };
    for (const [name, add] of Object.entries(args.tables)) {
      const total = { ...(tables[name] ?? emptyCheck()) };
      for (const key of Object.keys(total) as (keyof TableCheck)[]) total[key] += add[key];
      tables[name] = total;
    }
    const done = args.to.stage >= VERIFY_STAGES.length;
    const now = Date.now();
    await ctx.db.patch(r._id, {
      stage: args.to.stage,
      cursor: args.to.cursor,
      counts,
      tables,
      runs: r.runs + 1,
      done,
      updatedAt: now,
      ...(done ? { finishedAt: now, ok: Object.values(counts).every((n) => n === 0) } : {}),
    });
    if (done) console.log(JSON.stringify({ event: "migration.account_model_verified", ok: Object.values(counts).every((n) => n === 0), ...counts }));
    return { saved: true, done };
  },
});

/** One run of a check: up to `pagesPerRun` pages, then it saves and schedules the next run. */
export const verifyAccountModelRun = internalAction({
  args: { reportId: v.id("migrationReports"), pageSize: v.optional(v.number()), pagesPerRun: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ done: boolean; saved: boolean }> => {
    const state: { stage: number; cursor: string | null; done: boolean } | null = await ctx.runQuery(internal.migrations.verifyAccountModelState, { reportId: args.reportId });
    if (!state || state.done) return { done: true, saved: false };
    const numItems = args.pageSize ?? VERIFY_PAGE;
    const counts = emptyCounts();
    const tables: Record<string, TableCheck> = {};
    let stage = state.stage;
    let cursor = state.cursor;
    for (let pages = 0; pages < (args.pagesPerRun ?? VERIFY_PAGES_PER_RUN) && stage < VERIFY_STAGES.length; pages++) {
      const name: VerifyStage = VERIFY_STAGES[stage]!;
      let page: { isDone: boolean; continueCursor: string };
      if (name === "profiles") {
        const p: { withDefaultWorkspace: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.verifyProfilesPage, { cursor, numItems });
        counts.profilesWithDefaultWorkspace += p.withDefaultWorkspace;
        page = p;
      } else if (name === "workspaceMembers" || name === "workspaceInvites") {
        const p: { legacy: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.verifyRolesPage, { table: name, cursor, numItems });
        counts.legacyRoles += p.legacy;
        page = p;
      } else if (name === "personalWorkspaces") {
        const p: { personal: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.verifyPersonalWorkspacesPage, { cursor, numItems });
        counts.personalWorkspaces += p.personal;
        page = p;
      } else {
        const p: TableCheck & { isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.verifyAccountModelPage, { table: name, cursor, numItems });
        const total = (tables[name] ??= emptyCheck());
        for (const key of Object.keys(total) as (keyof TableCheck)[]) total[key] += p[key];
        counts.rowsWithBothScopes += p.both;
        counts.rowsWithNoScope += p.neither;
        counts.rowsInLegacyWorkspaces += p.legacyWorkspace;
        counts.rowsOutOfTheirDocumentsScope += p.outOfScope;
        counts.orphanedGrants += p.orphanedGrants;
        page = p;
      }
      if (page.isDone) {
        stage++;
        cursor = null;
      } else cursor = page.continueCursor;
    }
    const saved: { saved: boolean; done: boolean } = await ctx.runMutation(internal.migrations.saveAccountModelProgress, {
      reportId: args.reportId,
      from: { stage: state.stage, cursor: state.cursor },
      to: { stage, cursor },
      counts,
      tables,
    });
    // Another run got there first (a duplicate): let that chain carry on alone.
    if (saved.saved && !saved.done) await ctx.scheduler.runAfter(0, internal.migrations.verifyAccountModelRun, args);
    return saved;
  },
});

export interface AccountModelReport extends ReportCounts {
  reportId: Id<"migrationReports">;
  /** The check has read everything. Until then the counts are partial and `ok` is false. */
  done: boolean;
  /** Done, and every count is 0. */
  ok: boolean;
  /** What the job is reading now (while not done). */
  reading: string | null;
  runs: number;
  startedAt: number;
  finishedAt: number | null;
  tables: Record<string, TableCheck>;
}

/** The latest account-model check (or the one named), or null if none was started. */
export const accountModelReport = internalQuery({
  args: { reportId: v.optional(v.id("migrationReports")) },
  handler: async (ctx, args): Promise<AccountModelReport | null> => {
    const r = args.reportId
      ? await ctx.db.get(args.reportId)
      : await ctx.db
          .query("migrationReports")
          .withIndex("by_name_started", (q) => q.eq("name", ACCOUNT_MODEL_REPORT))
          .order("desc")
          .first();
    if (!r) return null;
    return {
      reportId: r._id,
      done: r.done,
      ok: r.done && r.ok === true,
      reading: r.done ? null : (VERIFY_STAGES[r.stage] ?? null),
      runs: r.runs,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      ...r.counts,
      tables: r.tables,
    };
  },
});
