// The tasks calendar feed: the ICS it serves (escaping, folding, all-day and timed events) and the link
// (shown once, replaced by a new one, Personal and assigned workspace tasks only).
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { buildCalendar, escapeText, foldLine, zonedToUtc } from "../../convex/lib/ical";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

describe("iCalendar", () => {
  test("escapes text and folds long lines at 75 octets", () => {
    expect(escapeText("a, b; c\\d\nnew")).toBe("a\\, b\\; c\\\\d\\nnew");
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
  });

  test("converts a wall-clock time in a zone to UTC, across DST", () => {
    expect(new Date(zonedToUtc("2026-07-01", "09:00", "Europe/London")).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(new Date(zonedToUtc("2026-12-01", "09:00", "Europe/London")).toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(new Date(zonedToUtc("2026-10-14", "15:30", "America/New_York")).toISOString()).toBe("2026-10-14T19:30:00.000Z");
  });

  test("all-day and timed events", () => {
    const ics = buildCalendar(
      [
        { uid: "a@folevi.com", title: "Pay rent", dueDate: "2026-11-01", url: "https://app.folevi.com/d/x", note: "Home", updatedAt: 0 },
        { uid: "b@folevi.com", title: "Call Sam", dueDate: "2026-11-02", dueTime: "15:00", url: "https://app.folevi.com/d/y", note: "Work", updatedAt: 0 },
      ],
      { name: "Folevi tasks", timeZone: "UTC", now: 0 },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102");
    expect(ics).toContain("DTSTART:20261102T150000Z\r\nDTEND:20261102T153000Z");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

async function push(p: Person, scope: Person["scope"], ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope, deviceId: "device-feed", ops: ops as never });
}

async function todoIn(p: Person, scope: Person["scope"], title: string, props: Record<string, unknown>) {
  const docId = ulid();
  await push(p, scope, [
    { opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
    { opId: ulid(), kind: "block.upsert", documentId: docId, block: { ...para(ulid(), title), type: "todo", props: { checked: false, ...props } }, baseRevision: null, fields: ["content", "position"] },
  ]);
}

async function fetchFeed(t: T, token: string) {
  const res = await t.fetch(`/ical/${token}.ics`);
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") };
}

describe("calendar feed link", () => {
  test("serves dated open tasks; a new link ends the old one", async () => {
    const t = setup();
    const a = await person(t, "feed@example.com");
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await todoIn(a, PERSONAL, "Dentist", { dueDate: soon, dueTime: "09:30" });
    await todoIn(a, PERSONAL, "Someday", {});
    const { token } = await a.as.mutation(api.calendarFeeds.create, { includeWorkspaces: true });
    const feed = await fetchFeed(t, token);
    expect(feed.status).toBe(200);
    expect(feed.type).toContain("text/calendar");
    expect(feed.text).toContain("SUMMARY:Dentist");
    expect(feed.text).not.toContain("Someday");
    expect(await a.as.query(api.calendarFeeds.status, {})).toMatchObject({ includeWorkspaces: true, lastFetchedAt: expect.any(Number) });

    const { token: second } = await a.as.mutation(api.calendarFeeds.create, { includeWorkspaces: false });
    expect((await fetchFeed(t, token)).status).toBe(404);
    expect((await fetchFeed(t, second)).status).toBe(200);
    await a.as.mutation(api.calendarFeeds.remove, {});
    expect((await fetchFeed(t, second)).status).toBe(404);
    expect((await fetchFeed(t, "not-a-real-token-but-long-enough")).status).toBe(404);
  });

  test("workspace tasks only when assigned to you, and only if you want them", async () => {
    const t = setup();
    const owner = await person(t, "feed-owner@example.com");
    const me = await person(t, "feed-me@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Ops");
    await join(t, owner, me, "feed-me@example.com", workspaceId, "editor");
    const soon = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await todoIn(owner, scope, "Mine to do", { dueDate: soon, assigneeId: me.profileId });
    await todoIn(owner, scope, "Someone else's", { dueDate: soon });
    const { token } = await me.as.mutation(api.calendarFeeds.create, { includeWorkspaces: true });
    const text = (await fetchFeed(t, token)).text;
    expect(text).toContain("Mine to do");
    expect(text).not.toContain("Someone else");
    await me.as.mutation(api.calendarFeeds.setIncludeWorkspaces, { includeWorkspaces: false });
    expect((await fetchFeed(t, token)).text).not.toContain("Mine to do");
  });
});
