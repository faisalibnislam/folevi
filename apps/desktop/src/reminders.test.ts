import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanReminder, LATE_MS, Reminders, type Reminder } from "./reminders";

const dirs: string[] = [];
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), "folevi-reminders-"));
  dirs.push(dir);
  return join(dir, "reminders.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Timers the test runs by hand, on a clock it moves. */
function clock(start = 1_900_000_000_000) {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        timers.delete(id);
        t.fn();
      }
    },
    armed: () => timers.size,
  };
}

const reminder = (id: string, at: number, extra: Partial<Reminder> = {}) => ({ id, at, title: "Reminder: Call the plumber", body: "In House jobs", path: `/d/NOTE#block-${id}`, ...extra });

describe("reminders on the Mac", () => {
  test("a reminder goes off at its time, once, and opens its line", () => {
    const c = clock();
    const shown: Reminder[] = [];
    const r = new Reminders(file(), { show: (n) => shown.push(n), ...c });
    r.load();
    expect(r.schedule(reminder("reminder:a", c.now() + 60_000))).toBe(true);
    c.advance(59_000);
    expect(shown).toEqual([]);
    c.advance(1_000);
    expect(shown.map((n) => n.path)).toEqual(["/d/NOTE#block-reminder:a"]);
    expect(r.pending()).toEqual([]);
    // The page scheduling it again (it does on every launch) doesn't show it twice.
    r.schedule(reminder("reminder:a", shown[0]!.at));
    c.advance(10);
    expect(shown).toHaveLength(1);
    // A new time for the same line is a new reminder.
    r.schedule(reminder("reminder:a", c.now() + 1000));
    c.advance(1000);
    expect(shown).toHaveLength(2);
  });

  test("a new time replaces the old one; cancelling stops it", () => {
    const c = clock();
    const shown: Reminder[] = [];
    const r = new Reminders(file(), { show: (n) => shown.push(n), ...c });
    r.load();
    r.schedule(reminder("reminder:a", c.now() + 1000));
    r.schedule(reminder("reminder:a", c.now() + 5000));
    r.schedule(reminder("reminder:b", c.now() + 2000));
    r.cancel("reminder:b");
    expect(c.armed()).toBe(1);
    c.advance(2000);
    expect(shown).toEqual([]);
    c.advance(3000);
    expect(shown.map((n) => n.id)).toEqual(["reminder:a"]);
  });

  test("reminders survive a restart; one that passed while closed shows if it's under a day late", () => {
    const path = file();
    const c = clock();
    const first = new Reminders(path, { show: () => undefined, ...c });
    first.load();
    first.schedule(reminder("reminder:soon", c.now() + 60_000));
    first.schedule(reminder("reminder:later", c.now() + 3 * 3_600_000));
    first.schedule(reminder("reminder:stale", c.now() + 1000));
    first.stop();
    // Folevi was closed for two hours: the two that passed meanwhile show when it opens.
    c.advance(2 * 3_600_000);
    const shown: Reminder[] = [];
    const second = new Reminders(path, { show: (n) => shown.push(n), ...c });
    second.load();
    expect(shown.map((n) => n.id).sort()).toEqual(["reminder:soon", "reminder:stale"]);
    expect(second.pending().map((n) => n.id)).toEqual(["reminder:later"]);
    // A third launch doesn't show them again, even when the page schedules them again.
    second.stop();
    const third = new Reminders(path, { show: (n) => shown.push(n), ...c });
    third.load();
    third.schedule(reminder("reminder:soon", c.now() - 2 * 3_600_000 + 60_000));
    expect(shown).toHaveLength(2);
    // More than a day late: dropped without showing.
    third.schedule(reminder("reminder:old", c.now() - LATE_MS - 1));
    expect(shown).toHaveLength(2);
    expect(third.pending().map((n) => n.id)).toEqual(["reminder:later"]);
  });

  test("a damaged file starts empty; clear drops everything", () => {
    const path = file();
    writeFileSync(path, "{not json");
    const c = clock();
    const r = new Reminders(path, { show: () => undefined, ...c });
    r.load();
    expect(r.pending()).toEqual([]);
    r.schedule(reminder("reminder:a", c.now() + 1000));
    r.clear();
    expect(c.armed()).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8")).reminders).toEqual([]);
  });

  test("only reminders that make sense are kept, with a path inside the app", () => {
    expect(cleanReminder(null)).toBeNull();
    expect(cleanReminder({ id: "bad id!", at: 1, title: "x", body: "", path: "/" })).toBeNull();
    expect(cleanReminder({ id: "a", at: Number.NaN, title: "x", body: "", path: "/" })).toBeNull();
    expect(cleanReminder({ id: "a", at: 1, title: "  ", body: "", path: "/" })).toBeNull();
    expect(cleanReminder({ id: "a", at: 1.5, title: "Hi\nthere", body: 4, path: "https://evil.example" })).toEqual({ id: "a", at: 1, title: "Hi there", body: "", path: "/" });
    expect(cleanReminder({ id: "a", at: 1, title: "x", body: "", path: "//evil.example/d" })?.path).toBe("/");
    expect(cleanReminder({ id: "a", at: 1, title: "x".repeat(300), body: "", path: "/d/N#block-1" })).toMatchObject({ title: "x".repeat(200), path: "/d/N#block-1" });
  });
});
