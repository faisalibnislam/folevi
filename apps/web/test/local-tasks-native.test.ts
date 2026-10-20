// Local mode's native pieces for tasks and calendars (docs/LOCAL_MODE_PLAN.md WP7c, WP14): reminders kept in
// step with the host's notifications, and subscribed calendars fetched through the host's HTTP call (never
// through Folevi) and read with the server's parser. The handlers' shapes are compared with the server's in
// tests/parity; this covers what only a device does.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { createTestLocalClient, type TestLocalClient } from "@/lib/local/testing";
import { setLocalNative, type LocalNative } from "@/lib/local/native";
import { startLocalReminders } from "@/lib/local/reminders";
import type { CalendarDownload } from "@/lib/shell";

const PERSONAL = { kind: "personal" } as const;

async function note(c: TestLocalClient, title: string): Promise<string> {
  const id = ulid();
  await c.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: c.deviceId,
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: "📝" } }],
  });
  return id;
}

function todo(text: string, rank: string, props: Record<string, unknown>): WireBlock {
  return { id: ulid(), type: "todo", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked: false, ...props } };
}

async function upsert(c: TestLocalClient, documentId: string, blocks: WireBlock[]) {
  return await c.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: c.deviceId,
    ops: blocks.map((block) => ({ opId: ulid(), kind: "block.upsert" as const, documentId, block, baseRevision: null, fields: ["content" as const, "position" as const] })),
  });
}

let client: TestLocalClient;
beforeEach(async () => {
  localStorage.clear();
  client = await createTestLocalClient();
});
afterEach(async () => {
  setLocalNative(null);
  await client.close();
});

describe("reminders become this device's notifications", () => {
  test("open to-dos with a reminder are scheduled, and changes reschedule or cancel them", async () => {
    const scheduled = new Map<string, { at: number; title: string; body: string; path: string }>();
    const calls: string[] = [];
    const native: LocalNative = {
      notify: {
        schedule: async (n) => {
          calls.push(`schedule ${n.id}`);
          scheduled.set(n.id, n);
        },
        cancel: async (id) => {
          calls.push(`cancel ${id}`);
          scheduled.delete(id);
        },
      },
    };
    setLocalNative(native);
    const now = Date.now();
    const doc = await note(client, "House jobs");
    const call = todo("Call the plumber", "a1", { reminderAt: now + 60_000 });
    const late = todo("Too late", "a2", { reminderAt: now - 3 * 86_400_000 });
    const none = todo("No reminder", "a3", {});
    await upsert(client, doc, [call, late, none]);

    const stop = startLocalReminders(client.backend, { settleMs: 5 });
    await vi.waitFor(() => expect(scheduled.size).toBe(1));
    expect(scheduled.get(`reminder:${call.id}`)).toEqual({ id: `reminder:${call.id}`, at: now + 60_000, title: "Reminder: Call the plumber", body: "In House jobs", path: `/d/${doc}#block-${call.id}` });

    // A new time replaces it; checking it off cancels it.
    await client.mutation(api.tasks.update, { blockId: call.id, reminderAt: now + 120_000 });
    await vi.waitFor(() => expect(scheduled.get(`reminder:${call.id}`)?.at).toBe(now + 120_000));
    await client.mutation(api.tasks.update, { blockId: call.id, checked: true });
    await vi.waitFor(() => expect(scheduled.size).toBe(0));
    expect(calls).toEqual([`schedule reminder:${call.id}`, `schedule reminder:${call.id}`, `cancel reminder:${call.id}`]);

    // Its note in Trash takes it away too, and what was scheduled is remembered for the next launch.
    await client.mutation(api.tasks.update, { blockId: call.id, checked: false });
    await vi.waitFor(() => expect(scheduled.size).toBe(1));
    stop();
    expect(JSON.parse(localStorage.getItem("folevi:local-reminders") ?? "[]")).toHaveLength(1);
    await client.mutation(api.sync.push, { scope: PERSONAL, deviceId: client.deviceId, ops: [{ opId: ulid(), kind: "block.delete", documentId: doc, blockId: call.id, baseRevision: null }] });
    // Started again (the next launch): the deleted to-do's reminder is cancelled.
    const again = startLocalReminders(client.backend, { settleMs: 5 });
    await vi.waitFor(() => expect(scheduled.size).toBe(0));
    again();
  });

  test("a device without notifications schedules nothing", () => {
    setLocalNative({});
    const stop = startLocalReminders(client.backend);
    stop();
  });
});

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Team holidays",
  "BEGIN:VEVENT",
  "UID:one@example.com",
  `DTSTART:${new Date(Date.now() + 2 * 86_400_000).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
  `DTEND:${new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
  "SUMMARY:Planning day",
  "LOCATION:Room 4",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("subscribed calendars are fetched by this device", () => {
  test("add fetches through the host, names it from the calendar and shows its events", async () => {
    const asked: { url: string; previous: unknown }[] = [];
    let answer: CalendarDownload = { kind: "ok", text: ICS, etag: '"v1"', lastModified: null };
    setLocalNative({
      calendar: async (url, previous) => {
        asked.push({ url, previous });
        return answer;
      },
    });
    const { id } = await client.mutation(api.externalCalendars.add, { url: " webcal://calendars.example.com/team.ics " });
    await client.backend.idle();
    expect(asked).toEqual([{ url: "https://calendars.example.com/team.ics", previous: {} }]);
    const [cal] = await client.query(api.externalCalendars.list, {});
    expect(cal).toMatchObject({ id, name: "Team holidays", color: "accent", visible: true, lastError: null, eventCount: 1, truncated: false, loading: false });
    const from = Date.now();
    const events = await client.query(api.externalCalendars.events, { from, to: from + 7 * 86_400_000 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ calendarId: id, calendarName: "Team holidays", title: "Planning day", location: "Room 4", allDay: false });

    // Refresh asks again; unchanged text keeps the events, a failure keeps them and says why.
    answer = { kind: "notModified" };
    await client.mutation(api.externalCalendars.refresh, { calendarId: id });
    await client.backend.idle();
    expect(await client.query(api.externalCalendars.events, { from, to: from + 7 * 86_400_000 })).toHaveLength(1);
    answer = { kind: "error", message: "Couldn't load this calendar: the address returned 404." };
    await client.mutation(api.externalCalendars.refresh, { calendarId: id });
    await client.backend.idle();
    expect((await client.query(api.externalCalendars.list, {}))[0]?.lastError).toBe("Couldn't load this calendar: the address returned 404.");
    expect(await client.query(api.externalCalendars.events, { from, to: from + 7 * 86_400_000 })).toHaveLength(1);

    // Hidden calendars show no events; a removed one is gone with them.
    await client.mutation(api.externalCalendars.update, { calendarId: id, visible: false, name: "Holidays", color: "plum" });
    expect(await client.query(api.externalCalendars.events, { from, to: from + 7 * 86_400_000 })).toEqual([]);
    expect((await client.query(api.externalCalendars.list, {}))[0]).toMatchObject({ name: "Holidays", color: "plum", visible: false });
    await client.mutation(api.externalCalendars.remove, { calendarId: id });
    expect(await client.query(api.externalCalendars.list, {})).toEqual([]);
  });

  test("links that can't be subscribed to are refused before anything is fetched", async () => {
    const calendar = vi.fn();
    setLocalNative({ calendar });
    const refused = async (url: string) => {
      try {
        await client.mutation(api.externalCalendars.add, { url });
        return null;
      } catch (e) {
        return (e as { data?: { message?: string } }).data?.message;
      }
    };
    expect(await refused("ftp://example.com/cal.ics")).toBe("Paste a calendar link that starts with https://, http:// or webcal://.");
    expect(await refused("https://192.168.1.10/cal.ics")).toBe("Calendars on private or local networks can't be added.");
    expect(await refused("https://printer.local/cal.ics")).toBe("Calendars on private or local networks can't be added.");
    expect(await refused("https://me:secret@example.com/cal.ics")).toBe("Links with a user name or password in them can't be added.");
    expect(await refused("https://example.com:8443/cal.ics")).toBe("Calendars on unusual ports can't be added.");
    await client.mutation(api.externalCalendars.add, { url: "https://example.com/a.ics", name: "Mine" });
    expect(await refused("https://example.com/a.ics")).toBe("You’ve already added this calendar.");
    await client.backend.idle();
    expect(calendar).toHaveBeenCalledTimes(1);
  });

  test("without the host's HTTP call the calendar says it couldn't be fetched", async () => {
    setLocalNative({});
    await client.mutation(api.externalCalendars.add, { url: "https://example.com/b.ics" });
    await client.backend.idle();
    expect((await client.query(api.externalCalendars.list, {}))[0]).toMatchObject({ name: "example.com", lastError: "Couldn't load this calendar: this device can't fetch calendars.", loading: false });
  });
});
