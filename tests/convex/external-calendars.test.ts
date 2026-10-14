// Read-only calendar subscriptions (convex/externalCalendars.ts): adding (link checks, the limit), the
// fetch (stubbed: DNS answers, redirects, errors, conditional requests), the events query, and removing.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const NOW = Date.parse("2026-10-14T12:00:00Z");

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Team holidays",
  "BEGIN:VEVENT",
  "UID:retreat",
  "DTSTART;VALUE=DATE:20261020",
  "DTEND;VALUE=DATE:20261022",
  "SUMMARY:Team retreat",
  "LOCATION:Lake house",
  "DESCRIPTION:Bring boots.\\n<script>alert(1)</script>",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:sync",
  "DTSTART:20261012T150000Z",
  "DTEND:20261012T153000Z",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "SUMMARY:Weekly sync",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * A stubbed network: DNS-over-HTTPS answers from `dns` (host → address), pages from `routes` (URL → answer).
 * Returns every request made, with its headers.
 */
function network(dns: Record<string, string>, routes: Record<string, Route | ((headers: Headers) => Route)>) {
  const requests: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.startsWith("https://dns.google/resolve")) {
        const u = new URL(url);
        const ip = dns[u.searchParams.get("name") ?? ""];
        const type = u.searchParams.get("type");
        const answer = ip && (type === "A") === !ip.includes(":") ? [{ type: type === "A" ? 1 : 28, data: ip }] : [];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
      }
      requests.push({ url, headers });
      const r = routes[url];
      const route = typeof r === "function" ? r(headers) : r;
      if (!route) return new Response("not found", { status: 404 });
      const status = route.status ?? 200;
      return new Response(status === 304 ? null : (route.body ?? ""), { status, headers: route.headers });
    }),
  );
  return requests;
}

async function settle(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function calendarRow(t: T, id: string) {
  return await t.run(async (ctx) => ctx.db.get(id as Id<"externalCalendars">));
}

async function eventRows(t: T, id: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("externalEvents")
      .withIndex("by_calendar_generation", (q) => q.eq("calendarId", id as Id<"externalCalendars">))
      .collect(),
  );
}

const range = { from: Date.parse("2026-10-01T00:00:00Z"), to: Date.parse("2026-11-01T00:00:00Z") };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("adding a calendar", () => {
  test("webcal:// is read as https://, the calendar is fetched and its events show, read-only", async () => {
    const t = setup();
    const a: Person = await person(t, "subscriber@example.com");
    const requests = network({ "cal.example.com": "93.184.216.34" }, { "https://cal.example.com/team.ics": { body: ICS, headers: { etag: '"v1"', "content-type": "text/calendar" } } });
    const { id } = await a.as.mutation(api.externalCalendars.add, { url: "webcal://cal.example.com/team.ics" });
    await settle(t);
    expect(requests.map((r) => r.url)).toEqual(["https://cal.example.com/team.ics"]);
    const [cal] = await a.as.query(api.externalCalendars.list, {});
    // Named after the calendar until the person names it; a colour from the palette.
    expect(cal).toMatchObject({ id, name: "Team holidays", url: "https://cal.example.com/team.ics", color: "accent", lastError: null, eventCount: 5, loading: false });
    const events = await a.as.query(api.externalCalendars.events, range);
    expect(events.map((e) => [e.title, new Date(e.start).toISOString(), e.allDay])).toEqual([
      ["Weekly sync", "2026-10-12T15:00:00.000Z", false],
      ["Weekly sync", "2026-10-19T15:00:00.000Z", false],
      ["Team retreat", "2026-10-20T00:00:00.000Z", true],
      ["Weekly sync", "2026-10-26T15:00:00.000Z", false],
    ]);
    // Text as text: the description keeps its markup as characters, never interpreted.
    expect(events.find((e) => e.title === "Team retreat")).toMatchObject({ location: "Lake house", description: "Bring boots.\n<script>alert(1)</script>", calendarName: "Team holidays", color: "accent" });

    // Someone else sees none of it and can't touch it.
    const b = await person(t, "other@example.com");
    expect(await b.as.query(api.externalCalendars.list, {})).toEqual([]);
    expect(await b.as.query(api.externalCalendars.events, range)).toEqual([]);
    await expect(b.as.mutation(api.externalCalendars.update, { calendarId: id, name: "Mine" })).rejects.toThrow(/not found/i);
    await expect(b.as.mutation(api.externalCalendars.remove, { calendarId: id })).rejects.toThrow(/not found/i);
  });

  test("links that aren't public http(s) addresses are refused before anything is fetched", async () => {
    const t = setup();
    const a = await person(t, "ssrf@example.com");
    const requests = network({}, {});
    for (const url of [
      "http://localhost/cal.ics",
      "http://127.0.0.1/cal.ics",
      "http://10.0.0.5/cal.ics",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/cal.ics",
      "http://[::ffff:192.168.0.1]/cal.ics",
      "http://printer.local/cal.ics",
      "http://intranet/cal.ics",
      "ftp://cal.example.com/cal.ics",
      "file:///etc/passwd",
      "https://cal.example.com:8443/cal.ics",
      "https://user:secret@cal.example.com/cal.ics",
      "not a link",
    ]) {
      await expect(a.as.mutation(api.externalCalendars.add, { url }), url).rejects.toThrow();
    }
    expect(await a.as.query(api.externalCalendars.list, {})).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("a host whose DNS points somewhere private, or a redirect there, is never fetched", async () => {
    const t = setup();
    const a = await person(t, "rebind@example.com");
    const requests = network(
      { "inside.example.com": "10.1.2.3", "outside.example.com": "93.184.216.34", "v6.example.com": "fd00::1" },
      { "https://outside.example.com/cal.ics": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } } },
    );
    const inside = await a.as.mutation(api.externalCalendars.add, { url: "https://inside.example.com/cal.ics" });
    const v6 = await a.as.mutation(api.externalCalendars.add, { url: "https://v6.example.com/cal.ics" });
    const redirect = await a.as.mutation(api.externalCalendars.add, { url: "https://outside.example.com/cal.ics" });
    await settle(t);
    expect(requests.map((r) => r.url)).toEqual(["https://outside.example.com/cal.ics"]);
    const cals = await a.as.query(api.externalCalendars.list, {});
    for (const { id } of [inside, v6, redirect]) {
      expect(cals.find((c) => c.id === id)!.lastError).toBe("Couldn't load this calendar: addresses on private or local networks can't be used.");
    }
  });

  test("up to 20 calendars, no duplicates", async () => {
    const t = setup();
    const a = await person(t, "many@example.com");
    network({}, {});
    for (let i = 0; i < 20; i++) await a.as.mutation(api.externalCalendars.add, { url: `https://cal.example.com/${i}.ics`, name: `Calendar ${i}` });
    await expect(a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/20.ics" })).rejects.toThrow(/up to 20 calendars/);
    const [first] = await a.as.query(api.externalCalendars.list, {});
    await a.as.mutation(api.externalCalendars.remove, { calendarId: first!.id });
    await expect(a.as.mutation(api.externalCalendars.add, { url: "webcal://cal.example.com/1.ics" })).rejects.toThrow(/already added/);
    await a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/20.ics" });
  });
});

describe("refreshing", () => {
  test("errors are kept in plain words and the events from before stay; a 304 changes nothing", async () => {
    const t = setup();
    const a = await person(t, "refresh@example.com");
    let answer: Route = { body: ICS, headers: { etag: '"v1"', "last-modified": "Tue, 13 Oct 2026 10:00:00 GMT" } };
    const requests = network({ "cal.example.com": "93.184.216.34" }, { "https://cal.example.com/team.ics": () => answer });
    const { id } = await a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/team.ics", name: "Team", color: "plum" });
    await settle(t);
    expect((await a.as.query(api.externalCalendars.events, range)).length).toBe(4);

    // Not modified: asked conditionally, nothing rewritten.
    answer = { status: 304 };
    const generation = (await calendarRow(t, id))!.generation;
    await a.as.mutation(api.externalCalendars.viewed, {});
    vi.advanceTimersByTime(60 * 60_000);
    await a.as.mutation(api.externalCalendars.viewed, {});
    await settle(t);
    const conditional = requests[requests.length - 1]!;
    expect(conditional.headers.get("if-none-match")).toBe('"v1"');
    expect(conditional.headers.get("if-modified-since")).toBe("Tue, 13 Oct 2026 10:00:00 GMT");
    expect((await calendarRow(t, id))!.generation).toBe(generation);
    expect((await a.as.query(api.externalCalendars.list, {}))[0]).toMatchObject({ name: "Team", color: "plum", lastError: null });

    // A 404: said plainly, the old events stay.
    answer = { status: 404 };
    vi.advanceTimersByTime(2 * 60_000);
    await a.as.mutation(api.externalCalendars.refresh, { calendarId: id });
    await settle(t);
    expect((await a.as.query(api.externalCalendars.list, {}))[0]!.lastError).toBe("Couldn't load this calendar: the address returned 404.");
    expect((await a.as.query(api.externalCalendars.events, range)).length).toBe(4);

    // Too large, or not a calendar at all.
    answer = { body: "x", headers: { "content-length": String(6 * 1024 * 1024) } };
    vi.advanceTimersByTime(2 * 60_000);
    await a.as.mutation(api.externalCalendars.refresh, { calendarId: id });
    await settle(t);
    expect((await a.as.query(api.externalCalendars.list, {}))[0]!.lastError).toBe("Couldn't load this calendar: it's larger than 5 MB.");
    answer = { body: "<html>Sign in</html>" };
    vi.advanceTimersByTime(2 * 60_000);
    await a.as.mutation(api.externalCalendars.refresh, { calendarId: id });
    await settle(t);
    expect((await a.as.query(api.externalCalendars.list, {}))[0]!.lastError).toBe("Couldn't load this calendar: the address didn't return a calendar.");

    // Fixed: new events replace the old ones (the old generation is cleared out).
    answer = { body: ICS.replace("Team retreat", "Team offsite") };
    vi.advanceTimersByTime(2 * 60_000);
    await a.as.mutation(api.externalCalendars.refresh, { calendarId: id });
    await settle(t);
    expect((await a.as.query(api.externalCalendars.list, {}))[0]!.lastError).toBeNull();
    const titles = (await a.as.query(api.externalCalendars.events, range)).map((e) => e.title);
    expect(titles).toContain("Team offsite");
    expect(titles).not.toContain("Team retreat");
    expect((await eventRows(t, id)).length).toBe(5);
  });

  test("the schedule refreshes stale calendars looked at in the last 14 days, not forgotten ones", async () => {
    const t = setup();
    const a = await person(t, "cron@example.com");
    const requests = network({ "cal.example.com": "93.184.216.34" }, { "https://cal.example.com/a.ics": { body: ICS }, "https://cal.example.com/b.ics": { body: ICS } });
    const { id: recent } = await a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/a.ics" });
    const { id: forgotten } = await a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/b.ics" });
    await settle(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(forgotten as Id<"externalCalendars">, { lastViewedAt: NOW - 20 * 86_400_000 });
    });
    requests.length = 0;
    vi.advanceTimersByTime(61 * 60_000);
    expect(await t.mutation(internal.externalCalendars.refreshDue, {})).toEqual({ scheduled: 1 });
    await settle(t);
    expect(requests.map((r) => r.url)).toEqual(["https://cal.example.com/a.ics"]);
    expect((await calendarRow(t, recent))!.lastFetchedAt).toBeGreaterThan(NOW + 60 * 60_000);
  });
});

describe("editing and removing", () => {
  test("rename and recolour; removing takes its events with it", async () => {
    const t = setup();
    const a = await person(t, "edit@example.com");
    network({ "cal.example.com": "93.184.216.34" }, { "https://cal.example.com/team.ics": { body: ICS } });
    const { id } = await a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/team.ics" });
    await settle(t);
    await a.as.mutation(api.externalCalendars.update, { calendarId: id, name: "  Work  ", color: "coral" });
    expect((await a.as.query(api.externalCalendars.list, {}))[0]).toMatchObject({ name: "Work", color: "coral" });
    await expect(a.as.mutation(api.externalCalendars.update, { calendarId: id, name: " " })).rejects.toThrow(/name/);
    // Once named by the person, a fetch doesn't rename it.
    await a.as.mutation(api.externalCalendars.refresh, { calendarId: id });
    vi.advanceTimersByTime(2 * 60_000);
    await settle(t);
    expect((await a.as.query(api.externalCalendars.list, {}))[0]!.name).toBe("Work");

    await a.as.mutation(api.externalCalendars.remove, { calendarId: id });
    await settle(t);
    expect(await a.as.query(api.externalCalendars.list, {})).toEqual([]);
    expect(await eventRows(t, id)).toEqual([]);
  });
});
