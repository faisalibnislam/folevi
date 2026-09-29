// One-off data backfills. Each runs in small batches and reschedules itself until done, so it is safe on
// large deployments. Run with `npx convex run migrations:<name>`.
import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { liveBlocks, refreshDerived, syncTaskProjection } from "./lib/documents";
import { randomNoteEmoji, randomNoteCover } from "@folevi/editor-schema";
import { isFolderColor, randomFolderColor } from "./lib/folderColors";
import { paymentTier, startTrial } from "./lib/billing";
import { CATALOG_VERSION, isLegacyWorkspacePlanId, personalTierOf, workspacePlanIdOf } from "./lib/plans";
import { hasValidScope, SCOPED_TABLES, sameScope, scopeOfRow, type ScopedTable } from "./lib/scope";

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
// January 2027 plans (docs/BILLING.md). Rewrites every stored tier to today's catalog, idempotently and in
// batches: Personal Basic → Core, Personal Pro (the old Pro, with AI) → Pro AI, Workspace Team → Pro,
// Workspace Business → Pro AI; payments are relabelled the same way (amounts never change). Rows it has
// done (and every row written since) carry catalogVersion 2, so running it again changes nothing.
//
//   npx convex run --prod migrations:migratePlanTiers '{}'            dry run first: add "dryRun": true
//   npx convex run --prod migrations:planTierReport '{}'             rows still on the old tiers (0 when done)
// ---------------------------------------------------------------------------------------------------

const PLAN_TIER_PAGE = 100;

/** Today's fields for a subscription row written before January 2027 (null: nothing to change). */
export function migratedSubscription(row: Doc<"subscriptions">): Partial<Doc<"subscriptions">> | null {
  if (row.catalogVersion === CATALOG_VERSION) return null;
  if (row.ownerType === "workspace") {
    if (!row.planId) return { catalogVersion: CATALOG_VERSION };
    return { planId: workspacePlanIdOf(row.planId), catalogVersion: CATALOG_VERSION };
  }
  if (!row.plan) return { catalogVersion: CATALOG_VERSION };
  return { plan: personalTierOf(row as { plan: NonNullable<Doc<"subscriptions">["plan"]> }), catalogVersion: CATALOG_VERSION };
}

/** Today's fields for a payment row written before January 2027 (null: nothing to change). */
export function migratedPayment(row: Doc<"payments">): Partial<Doc<"payments">> | null {
  if (row.catalogVersion === CATALOG_VERSION) return null;
  const tier = paymentTier(row);
  return { plan: tier, ...(row.planId && isLegacyWorkspacePlanId(row.planId) ? { planId: workspacePlanIdOf(row.planId) } : {}), catalogVersion: CATALOG_VERSION };
}

export const migratePlanTiers = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("subscriptions"), v.literal("payments"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ table: "subscriptions" | "payments"; changed: number; seen: number; done: boolean; changes: string[] }> => {
    const table = args.table ?? "subscriptions";
    const page = await ctx.db.query(table).paginate({ cursor: args.cursor ?? null, numItems: PLAN_TIER_PAGE });
    let changed = 0;
    const changes: string[] = [];
    for (const row of page.page) {
      const patch = table === "subscriptions" ? migratedSubscription(row as Doc<"subscriptions">) : migratedPayment(row as Doc<"payments">);
      if (!patch) continue;
      changed++;
      // What changed, without ids or personal data (e.g. "subscriptions: pro → pro_ai").
      const before = table === "subscriptions" ? ((row as Doc<"subscriptions">).plan ?? (row as Doc<"subscriptions">).planId) : (row as Doc<"payments">).plan;
      const after = table === "subscriptions" ? (patch as Partial<Doc<"subscriptions">>).plan ?? (patch as Partial<Doc<"subscriptions">>).planId ?? before : (patch as Partial<Doc<"payments">>).plan;
      if (changes.length < 20) changes.push(`${table}: ${String(before)} → ${String(after)}`);
      if (!args.dryRun) await ctx.db.patch(row._id, patch);
    }
    console.log(JSON.stringify({ event: "migration.plan_tiers", table, changed, seen: page.page.length, dryRun: Boolean(args.dryRun) }));
    const done = page.isDone && table === "payments";
    if (!args.dryRun) {
      if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.migratePlanTiers, { table, cursor: page.continueCursor });
      else if (table === "subscriptions") await ctx.scheduler.runAfter(0, internal.migrations.migratePlanTiers, { table: "payments", cursor: null });
    }
    return { table, changed, seen: page.page.length, done, changes };
  },
});

/** How many rows still store a tier from before January 2027 (both 0 once migratePlanTiers has run). */
export const planTierReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    let subscriptions = 0;
    let payments = 0;
    for await (const row of ctx.db.query("subscriptions")) if (migratedSubscription(row)) subscriptions++;
    for await (const row of ctx.db.query("payments")) if (migratedPayment(row)) payments++;
    return { subscriptions, payments };
  },
});

// ---------------------------------------------------------------------------------------------------
// Account model clean-up (docs/ACCOUNT_MODEL_PLAN.md §3b). Production was migrated (Personal is not a
// workspace, roles are owner | admin | member); these finish removing what only the old model needed.
// Each is batched, continues itself and is idempotent (rows already done are skipped).
//
//   npx convex run --deployment <prod> migrations:refreshLinkingPages       re-derives text of linking pages
// ---------------------------------------------------------------------------------------------------

/**
 * Link labels stopped leaking restricted titles (lib/linkLabels.ts): recomputes the derived text (excerpt,
 * card preview, search text) and the task titles of every page that links to another page, so text
 * computed before the change no longer carries a title its readers may not see. Idempotent.
 *
 *   npx convex run --deployment <prod> migrations:refreshLinkingPages
 */
export const refreshLinkingPages = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ refreshed: number; done: boolean }> => {
    // Few links per batch: each linking page's blocks are read in full.
    const page = await ctx.db.query("documentLinks").paginate({ cursor: args.cursor ?? null, numItems: 20 });
    const sources = new Set(page.page.map((l) => l.sourceDocumentId));
    let refreshed = 0;
    for (const id of sources) {
      const doc = await ctx.db.get(id);
      if (!doc) continue;
      const rows = await liveBlocks(ctx, doc._id);
      await refreshDerived(ctx, doc, rows);
      for (const row of rows) if (row.type === "todo" && JSON.stringify(row.text).includes('"pageLink"')) await syncTaskProjection(ctx, row, doc, doc.createdBy);
      refreshed++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.refreshLinkingPages, { cursor: page.continueCursor });
    return { refreshed, done: page.isDone };
  },
});

// ---------------------------------------------------------------- integrity check
//
//   npx convex run migrations:verifyAccountModel     starts a check (a background job; returns at once)
//   npx convex run migrations:accountModelReport     the latest check: `done`, then `ok` and every count
//
// The check pages through every scoped table: every row has exactly one of ownerProfileId / workspaceId,
// its workspace exists, it is in the same scope as the document it belongs to, and no page grant is
// orphaned. Each run of the job reads a bounded number of pages (queries, so it never conflicts with live
// writes), adds what it found to its `migrationReports` row and schedules the next run, so it finishes at
// any database size. A run only saves if the row is still where it started (stage + cursor), so a
// duplicate run can't count a page twice. Only the latest REPORTS_KEPT reports are kept.

const VERIFY_PAGE = 500;
const VERIFY_PAGES_PER_RUN = 10;
const ACCOUNT_MODEL_REPORT = "accountModel";
/** Reports kept per check; starting a new one deletes older ones beyond this. */
export const REPORTS_KEPT = 5;

type TableCheck = {
  rows: number;
  /** Both ownerProfileId and workspaceId set. */
  both: number;
  /** Neither set. */
  neither: number;
  /** workspaceId points at a workspace that no longer exists. */
  missingWorkspace: number;
  /** In a different scope than the document it belongs to. */
  outOfScope: number;
  /** documentPermissions only: the page or the person is gone. */
  orphanedGrants: number;
};
const vTableCheck = v.object({ rows: v.number(), both: v.number(), neither: v.number(), missingWorkspace: v.number(), outOfScope: v.number(), orphanedGrants: v.number() });
const emptyCheck = (): TableCheck => ({ rows: 0, both: 0, neither: 0, missingWorkspace: 0, outOfScope: 0, orphanedGrants: 0 });

/** The report's totals (all must be 0 for `ok`). */
const vReportCounts = v.object({
  rowsWithBothScopes: v.number(),
  rowsWithNoScope: v.number(),
  rowsInMissingWorkspaces: v.number(),
  rowsOutOfTheirDocumentsScope: v.number(),
  orphanedGrants: v.number(),
});
type ReportCounts = Infer<typeof vReportCounts>;
const emptyCounts = (): ReportCounts => ({
  rowsWithBothScopes: 0,
  rowsWithNoScope: 0,
  rowsInMissingWorkspaces: 0,
  rowsOutOfTheirDocumentsScope: 0,
  orphanedGrants: 0,
});

/** What the job reads, in order. */
const VERIFY_STAGES = SCOPED_TABLES;

type LooseRow = Record<string, unknown> & { workspaceId?: Id<"workspaces">; ownerProfileId?: Id<"profiles"> };
interface LoosePages {
  paginate(opts: { cursor: string | null; numItems: number }): Promise<{ page: LooseRow[]; isDone: boolean; continueCursor: string }>;
}

const documentOf = (table: ScopedTable, row: Record<string, unknown>): Id<"documents"> | undefined =>
  table === "documents" ? undefined : ((row.documentId ?? row.sourceDocumentId) as Id<"documents"> | undefined);

/** One page of one scoped table's checks. */
export const verifyAccountModelPage = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  handler: async (ctx, args): Promise<TableCheck & { isDone: boolean; continueCursor: string }> => {
    const table = SCOPED_TABLES.find((t) => t === args.table);
    if (!table) throw new Error(`Not a scoped table: ${args.table}`);
    // The table is a variable, so the query is typed loosely (every scoped table has the scope fields).
    const page = await (ctx.db.query(table) as unknown as LoosePages).paginate({ cursor: args.cursor, numItems: args.numItems ?? VERIFY_PAGE });
    const check = emptyCheck();
    const docs = new Map<string, Doc<"documents"> | null>();
    const workspaces = new Map<string, boolean>();
    const people = new Map<string, boolean>();
    for (const raw of page.page) {
      check.rows++;
      if (raw.workspaceId !== undefined && raw.ownerProfileId !== undefined) check.both++;
      else if (raw.workspaceId === undefined && raw.ownerProfileId === undefined) check.neither++;
      if (raw.workspaceId !== undefined) {
        if (!workspaces.has(raw.workspaceId)) workspaces.set(raw.workspaceId, (await ctx.db.get(raw.workspaceId)) !== null);
        if (!workspaces.get(raw.workspaceId)) check.missingWorkspace++;
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

/**
 * Starts a check of the account model over the whole deployment, as a background job (see above). Read
 * the result with `migrations:accountModelReport` (`ok` only when every count is 0). Older reports beyond
 * REPORTS_KEPT are deleted. `pageSize` / `pagesPerRun` are for tests.
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
    // Keep only the latest few (bounded: a handful are deleted per start).
    const older = await ctx.db
      .query("migrationReports")
      .withIndex("by_name_started", (q) => q.eq("name", ACCOUNT_MODEL_REPORT))
      .order("desc")
      .take(REPORTS_KEPT + 50);
    for (const r of older.filter((r) => r._id !== reportId).slice(REPORTS_KEPT - 1)) await ctx.db.delete(r._id);
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
    const counts: ReportCounts = { ...emptyCounts(), ...r.counts };
    for (const key of Object.keys(args.counts) as (keyof ReportCounts)[]) counts[key] += args.counts[key];
    const tables: Record<string, TableCheck> = {};
    for (const [name, stored] of Object.entries(r.tables)) tables[name] = { ...emptyCheck(), ...stored };
    for (const [name, add] of Object.entries(args.tables)) {
      const total = { ...(tables[name] ?? emptyCheck()) };
      for (const key of Object.keys(total) as (keyof TableCheck)[]) total[key] += add[key];
      tables[name] = total;
    }
    const done = args.to.stage >= VERIFY_STAGES.length;
    const ok = Object.values(counts).every((n) => n === 0);
    const now = Date.now();
    await ctx.db.patch(r._id, {
      stage: args.to.stage,
      cursor: args.to.cursor,
      counts,
      tables,
      runs: r.runs + 1,
      done,
      updatedAt: now,
      ...(done ? { finishedAt: now, ok } : {}),
    });
    if (done) console.log(JSON.stringify({ event: "migration.account_model_verified", ok, ...counts }));
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
      const name = VERIFY_STAGES[stage]!;
      const p: TableCheck & { isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.verifyAccountModelPage, { table: name, cursor, numItems });
      const total = (tables[name] ??= emptyCheck());
      for (const key of Object.keys(total) as (keyof TableCheck)[]) total[key] += p[key];
      counts.rowsWithBothScopes += p.both;
      counts.rowsWithNoScope += p.neither;
      counts.rowsInMissingWorkspaces += p.missingWorkspace;
      counts.rowsOutOfTheirDocumentsScope += p.outOfScope;
      counts.orphanedGrants += p.orphanedGrants;
      if (p.isDone) {
        stage++;
        cursor = null;
      } else cursor = p.continueCursor;
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
  tables: Record<string, Record<string, number>>;
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
      ...emptyCounts(),
      ...r.counts,
      tables: r.tables,
    };
  },
});
