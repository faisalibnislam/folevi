// Revision 9's views (R10.3, R10.4, R11.4, R11.5): the calendar feed's state, tasks with no date for the Calendar's
// Unscheduled list, signed links for files (a notification's export), and recent notes across spaces for Search.
import { api } from "@/lib/convex/api";
import type { ViewContext } from "./context";
import { QuerySource, type Snapshot } from "./live";
import { noteRowOf, type SummaryLike } from "./rows";
import { taskRow, type TaskData } from "./viewsWork";
import { marksOf, requireSpace, source, type ValueViewDef } from "./views";
import { ids, num, oneOf, only, optionalId } from "./validate";
import type { RecentRow, ViewName } from "./protocol";

type Args = Record<string, unknown>;

const calendarFeed: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx) => {
    if (ctx.deps().app.mode === "local") return { signals: [], compute: () => ({ value: { active: false, url: null, createdAt: null, lastFetchedAt: null, includeWorkspaces: false }, stale: false, error: null }) };
    const src = source<{ includeWorkspaces: boolean; createdAt: number; lastFetchedAt: number | null } | null>(ctx, api.calendarFeeds.status, {}, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const f = s.value;
        return { value: { active: Boolean(f), url: null, createdAt: f?.createdAt ?? null, lastFetchedAt: f?.lastFetchedAt ?? null, includeWorkspaces: Boolean(f?.includeWorkspaces) }, stale: s.stale, error: null };
      },
    };
  },
};

/** At most this many tasks in the Unscheduled list. */
const UNSCHEDULED = 200;

const tasksUnscheduled: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space"]);
    const space = optionalId(args, "space");
    return space === undefined ? {} : { space };
  },
  create: (ctx, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    const today = deps.app.today;
    // Every open task of the space, then the ones with no date, newest first (CalendarView.tsx does the same).
    const src = source<TaskData[]>(ctx, api.tasks.list, { scope: space.scope, view: "all", today }, space.scope);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const rows = s.value.filter((t) => !t.dueDate && t.status === "open").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, UNSCHEDULED);
        return { value: { tasks: rows.map((t) => taskRow(t, today)) }, stale: s.stale, error: null };
      },
    };
  },
};

type UrlsData = Record<string, { url: string; mimeType: string; filename: string; size: number; sealed?: unknown }>;

const filesUrls: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, ["ids"]), { ids: ids(args, "ids", 100) }),
  create: (ctx, args) => {
    const wanted = args.ids as string[];
    // (Links last about two hours; the hour keeps the answer stable while the view is up.)
    const src = new QuerySource<UrlsData>(ctx.deps().client, api.files.urls, { fileIds: wanted, now: Math.floor(Date.now() / 3_600_000) * 3_600_000 }, { kept: null });
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const got = s.value;
        const urls = Object.fromEntries(wanted.map((fid) => [fid, got[fid] ? { url: got[fid]!.url, filename: got[fid]!.filename, mimeType: got[fid]!.mimeType, size: got[fid]!.size, sealed: Boolean(got[fid]!.sealed) } : { url: null, filename: null, mimeType: null, size: null, sealed: false }]));
        return { value: { urls }, stale: false, error: null };
      },
    };
  },
};

const recent: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["scope", "limit"]);
    const out: Args = {};
    if (args.scope !== undefined) out.scope = oneOf(args, "scope", ["place", "everywhere"] as const);
    if (args.limit !== undefined) out.limit = num(args, "limit", { min: 1, max: 30 });
    return out;
  },
  create: (ctx: ViewContext, args) => {
    const deps = ctx.deps();
    const limit = (args.limit as number | undefined) ?? 10;
    const spaces = args.scope === "everywhere" ? deps.app.spaces : [requireSpace(deps, undefined)];
    const sources = spaces.map((sp) => ({ space: sp, src: source<SummaryLike[]>(ctx, api.documents.recentNotes, { scope: sp.scope, limit }, sp.scope) }));
    return {
      signals: [...sources.map((x) => x.src), ctx.appSignal],
      compute: (): Snapshot<unknown> => {
        const d = ctx.deps();
        const marks = marksOf(d);
        const rows: RecentRow[] = [];
        let stale = false;
        let any = false;
        for (const { space, src } of sources) {
          const s = src.snapshot();
          // A space that can't answer (locked, gone) is left out; the others still show.
          if (s.error || d.spaceStatus(space.scope).locked) continue;
          if (s.value === undefined) {
            stale = true;
            continue;
          }
          any = true;
          stale ||= s.stale;
          for (const doc of s.value) rows.push({ row: noteRowOf(doc, marks), space: space.id, spaceName: space.name });
        }
        if (!any && stale) return { value: undefined, stale: true, error: null };
        rows.sort((a, b) => b.row.updatedAt - a.row.updatedAt);
        return { value: { rows: rows.slice(0, limit) }, stale, error: null };
      },
    };
  },
};

export const PLANNER_VALUE_VIEWS = {
  "calendar.feed": calendarFeed,
  "tasks.unscheduled": tasksUnscheduled,
  "files.urls": filesUrls,
  recent,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
