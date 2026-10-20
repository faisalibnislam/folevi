// externalCalendars.* in local mode (convex/externalCalendars.ts): read-only calendar subscriptions. The
// calendar's link is fetched by this device (the host's `shell().http.calendar`, straight from the calendar's
// site, never through Folevi) and read with the server's own parser (packages/editor-schema icsParse.ts).
//
// A calendar is a row of `calendars`; what was read from it last is kept in meta (`calendarEvents:<id>`),
// replaced in one write when a newer fetch finishes, so a reader never sees half a calendar. A failed fetch
// keeps the events from before and records why, in plain words. Fetched on add, on Refresh and when the
// Calendar is opened with a copy over an hour old.
import { calendarUrlProblem, normalizeCalendarUrl } from "@folevi/editor-schema/publicUrl";
import { parseIcs, ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { localNative } from "../native";
import { defineLocal, type LocalJobCtx, type LocalMutationCtx, type LocalReader } from "../registry";
import type { LocalCalendar } from "../store";
import { requireProfile } from "./shared";

export const MAX_CALENDARS = 20;
const MAX_EVENTS = 1500;
const DAY_MS = 86_400_000;
const WINDOW_BACK_MS = 60 * DAY_MS;
const WINDOW_AHEAD_MS = 180 * DAY_MS;
/** Refreshed this often while someone looks at their Calendar. */
const STALE_MS = 55 * 60_000;
/** Unchanged text is parsed again after this (the window moves on). */
const REPARSE_MS = 12 * 3600_000;
/** A fetch in flight holds the calendar this long. */
const LEASE_MS = 60_000;
/** Multi-day events starting this long before a range are still looked at. */
const LONGEST_EVENT_MS = 31 * DAY_MS;

export const COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"] as const;

interface StoredEvent {
  key: string;
  start: number;
  end: number;
  allDay: boolean;
  title: string;
  location: string;
  description: string;
}

/** What was read from a calendar: the events of one fetch (its generation). */
interface StoredEvents {
  generation: number;
  events: StoredEvent[];
}

const eventsKey = (calendarId: string) => `calendarEvents:${calendarId}`;

async function myCalendars(db: LocalReader): Promise<LocalCalendar[]> {
  return (await db.list("calendars")).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)).slice(0, MAX_CALENDARS + 5);
}

async function ownCalendar(db: LocalReader, calendarId: string): Promise<LocalCalendar> {
  const cal = await db.get("calendars", calendarId);
  if (!cal) fail("not_found", "Calendar not found.");
  return cal;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

const inFlight = (c: LocalCalendar, now: number) => c.fetchStartedAt !== null && now - c.fetchStartedAt < LEASE_MS;

defineLocal(api.externalCalendars.list, "query", async (ctx) => {
  await requireProfile(ctx);
  const now = ctx.now();
  return (await myCalendars(ctx.db)).map((c) => ({
    id: c.id,
    name: c.name,
    url: c.url,
    color: c.color,
    visible: !c.hidden,
    lastFetchedAt: c.lastFetchedAt,
    lastError: c.lastError,
    eventCount: c.eventCount,
    truncated: c.truncated,
    loading: c.lastFetchedAt === null || inFlight(c, now),
  }));
});

defineLocal(api.externalCalendars.events, "query", async (ctx, args) => {
  await requireProfile(ctx);
  if (!(args.to > args.from) || args.to - args.from > 400 * DAY_MS) fail("invalid_argument", "Pick a shorter range.");
  const cals = (await myCalendars(ctx.db)).filter((c) => !c.hidden);
  if (!cals.length) return [];
  const out = [];
  for (const cal of cals) {
    const stored = (await ctx.db.get("meta", eventsKey(cal.id))) as StoredEvents | undefined;
    if (!stored || stored.generation !== cal.generation) continue;
    for (const e of stored.events) {
      if (e.start < args.from - LONGEST_EVENT_MS || e.start >= args.to || Math.max(e.end, e.start + 1) <= args.from) continue;
      out.push({
        id: `${cal.id}:${e.key}`,
        calendarId: cal.id,
        calendarName: cal.name,
        color: cal.color,
        title: e.title,
        location: e.location,
        description: e.description,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
      });
    }
  }
  // The server reads them by start time.
  return out.sort((a, b) => a.start - b.start).slice(0, 4000);
});

defineLocal(api.externalCalendars.add, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const url = normalizeCalendarUrl(args.url);
  if (url.length > 2000) fail("invalid_argument", "That link is too long.");
  const problem = calendarUrlProblem(url);
  if (problem) fail("invalid_argument", problem);
  const mine = await myCalendars(ctx.db);
  if (mine.length >= MAX_CALENDARS) fail("limit_exceeded", `You can subscribe to up to ${MAX_CALENDARS} calendars.`);
  if (mine.some((c) => c.url === url)) fail("invalid_argument", "You’ve already added this calendar.");
  const name = cleanName(args.name ?? "");
  const used = new Set(mine.map((c) => c.color));
  const now = ctx.now();
  const cal: LocalCalendar = {
    id: ulid(),
    name: name || new URL(url).hostname.replace(/^www\./, ""),
    autoName: !name,
    url,
    color: args.color ?? COLORS.find((c) => !used.has(c)) ?? "moss",
    hidden: false,
    createdAt: now,
    lastViewedAt: now,
    generation: 0,
    lastGeneration: 0,
    fetchStartedAt: null,
    lastFetchedAt: null,
    lastError: null,
    etag: null,
    lastModified: null,
    contentHash: null,
    parsedAt: null,
    eventCount: null,
    truncated: false,
  };
  ctx.db.put("calendars", cal.id, cal);
  fetchSoon(ctx, cal.id);
  return { id: cal.id };
});

defineLocal(api.externalCalendars.update, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const cal = await ownCalendar(ctx.db, args.calendarId);
  const next = { ...cal };
  if (args.name !== undefined) {
    const name = cleanName(args.name);
    if (!name) fail("invalid_argument", "Give the calendar a name.");
    next.name = name;
    next.autoName = false;
  }
  if (args.color !== undefined) next.color = args.color;
  if (args.visible !== undefined) next.hidden = !args.visible;
  ctx.db.put("calendars", cal.id, next);
  return null;
});

defineLocal(api.externalCalendars.remove, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const cal = await ownCalendar(ctx.db, args.calendarId);
  ctx.db.remove("calendars", cal.id);
  ctx.db.remove("meta", eventsKey(cal.id));
  return null;
});

defineLocal(api.externalCalendars.refresh, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const cal = await ownCalendar(ctx.db, args.calendarId);
  if (inFlight(cal, ctx.now())) return null;
  // A deliberate refresh reads the text again even when it hasn't changed.
  ctx.db.put("calendars", cal.id, { ...cal, parsedAt: null });
  fetchSoon(ctx, cal.id);
  return null;
});

defineLocal(api.externalCalendars.viewed, "mutation", async (ctx) => {
  await requireProfile(ctx);
  const now = ctx.now();
  for (const c of await myCalendars(ctx.db)) {
    if (now - c.lastViewedAt > 3600_000) ctx.db.put("calendars", c.id, { ...c, lastViewedAt: now });
    if (!inFlight(c, now) && now - (c.lastFetchedAt ?? 0) > STALE_MS) fetchSoon(ctx, c.id);
  }
  return null;
});

// ---- fetching -------------------------------------------------------------------------------------------

function fetchSoon(ctx: LocalMutationCtx, calendarId: string) {
  ctx.runAfter((job) => fetchNow(job, calendarId));
}

type Outcome =
  | { kind: "parsed"; etag: string | null; lastModified: string | null; contentHash: string; events: StoredEvent[]; truncated: boolean; name: string | null }
  | { kind: "unchanged" }
  | { kind: "error"; message: string };

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetches and reads one calendar (convex/externalCalendars.ts fetchNow, claim and finish). */
async function fetchNow(job: LocalJobCtx, calendarId: string): Promise<void> {
  const claimed = await job.mutate(async (m) => {
    const cal = await m.db.get("calendars", calendarId);
    const now = m.now();
    if (!cal || inFlight(cal, now)) return null;
    const generation = cal.lastGeneration + 1;
    m.db.put("calendars", cal.id, { ...cal, fetchStartedAt: now, lastGeneration: generation });
    // Unchanged text is only skipped while what was read from it is fresh.
    return { url: cal.url, generation, etag: cal.etag, lastModified: cal.lastModified, contentHash: cal.contentHash, fresh: cal.parsedAt !== null && now - cal.parsedAt < REPARSE_MS && !cal.lastError };
  });
  if (!claimed) return;
  const outcome = await read(claimed, job.now());
  await job.mutate(async (m) => {
    const cal = await m.db.get("calendars", calendarId);
    if (!cal) return;
    const now = m.now();
    const o = outcome;
    if (o.kind === "parsed" && claimed.generation > cal.generation) {
      const name = cal.autoName && o.name ? cleanName(o.name) : "";
      m.db.put("meta", eventsKey(cal.id), { generation: claimed.generation, events: o.events } satisfies StoredEvents);
      m.db.put("calendars", cal.id, {
        ...cal,
        generation: claimed.generation,
        lastFetchedAt: now,
        lastError: null,
        etag: o.etag,
        lastModified: o.lastModified,
        contentHash: o.contentHash,
        parsedAt: now,
        eventCount: o.events.length,
        truncated: o.truncated,
        fetchStartedAt: null,
        ...(name ? { name } : {}),
      });
    } else if (o.kind === "unchanged") {
      m.db.put("calendars", cal.id, { ...cal, lastFetchedAt: now, lastError: null, fetchStartedAt: null });
    } else if (o.kind === "error") {
      m.db.put("calendars", cal.id, { ...cal, lastFetchedAt: now, lastError: o.message.slice(0, 300), fetchStartedAt: null });
    } else {
      // An older fetch that finished after a newer one: nothing to show from it.
      m.db.put("calendars", cal.id, { ...cal, fetchStartedAt: null });
    }
  });
}

async function read(job: { url: string; etag: string | null; lastModified: string | null; contentHash: string | null; fresh: boolean }, now: number): Promise<Outcome> {
  const download = localNative().calendar;
  if (!download) return { kind: "error", message: "Couldn't load this calendar: this device can't fetch calendars." };
  let got;
  try {
    got = await download(job.url, job.fresh ? { etag: job.etag, lastModified: job.lastModified } : {});
  } catch {
    return { kind: "error", message: "Couldn't load this calendar: the address couldn't be reached." };
  }
  if (got.kind === "error") return { kind: "error", message: got.message };
  if (got.kind === "notModified") return { kind: "unchanged" };
  const contentHash = await sha256Hex(got.text);
  if (job.fresh && contentHash === job.contentHash) return { kind: "unchanged" };
  const parsed = parseIcs(got.text, { from: now - WINDOW_BACK_MS, to: now + WINDOW_AHEAD_MS, maxEvents: MAX_EVENTS });
  const events = parsed.events.map((e) => ({ key: e.key, start: e.start, end: e.end, allDay: e.allDay, title: e.title, location: e.location, description: e.description }));
  return { kind: "parsed", etag: got.etag, lastModified: got.lastModified, contentHash, events, truncated: parsed.truncated, name: parsed.name };
}
