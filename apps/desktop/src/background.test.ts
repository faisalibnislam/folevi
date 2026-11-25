// The places no window shows (background.ts): a runner only while there's work, never one per place all day, and
// nothing before the first window has loaded.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BackgroundSync, DEFAULT_PLAN, due, isNewUnread, jwtExpiry, planFromEnv, verdict } from "./background";

const A = "acct:a";
const B = "acct:b";
const LIB = "library";

function harness(o: { unread?: (place: string) => Promise<number | null>; front?: boolean } = {}) {
  const running = new Set<string>();
  const started: string[] = [];
  const counts: [string, number][] = [];
  const bg = new BackgroundSync(
    {
      startRunner: (p) => {
        running.add(p);
        started.push(p);
        return true;
      },
      stopRunner: (p) => void running.delete(p),
      isAccount: (p) => p.startsWith("acct:"),
      unread: o.unread,
      onUnread: (p, n) => void counts.push([p, n]),
      isFront: () => o.front ?? true,
      now: () => Date.now(),
    },
    { lingerMs: 1_000, libraryDelayMs: 3_000 },
  );
  return { bg, running, started, counts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_900_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe("the plan", () => {
  test("a runner stays its minimum, goes once nothing waits, and at most its maximum", () => {
    const at = 1_000_000;
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: 0, holdUntil: null }, at + 5_000)).toBe("keep");
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: 0, holdUntil: null }, at + 15_000)).toBe("release");
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: null, holdUntil: null }, at + 60_000)).toBe("keep");
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: null, holdUntil: null }, at + 120_000)).toBe("release");
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: 3, holdUntil: null }, at + 300_000)).toBe("keep");
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: 3, holdUntil: null }, at + 600_000)).toBe("release");
    expect(verdict(DEFAULT_PLAN, { since: at, waiting: 0, holdUntil: at + 30_000 }, at + 20_000)).toBe("keep");
  });

  test("the catch-up: oldest first, one at a time, none while one is up", () => {
    const now = 10_000_000;
    const last = new Map([
      [A, now - 700_000],
      [B, now - 900_000],
    ]);
    expect(due(DEFAULT_PLAN, [A, B, LIB], last, new Set(), now)).toEqual([LIB]);
    last.set(LIB, now - 1_000);
    expect(due(DEFAULT_PLAN, [A, B, LIB], last, new Set(), now)).toEqual([B]);
    expect(due(DEFAULT_PLAN, [A, B, LIB], last, new Set([LIB]), now)).toEqual([]);
  });

  test("unread counts, tokens and test timings", () => {
    expect(isNewUnread(undefined, 4)).toBe(false);
    expect(isNewUnread(2, 4)).toBe(true);
    expect(isNewUnread(4, 3)).toBe(false);
    const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url");
    expect(jwtExpiry(`h.${payload}.s`)).toBe(2_000_000_000_000);
    expect(jwtExpiry("nonsense")).toBeNull();
    expect(planFromEnv({ FOLEVI_BACKGROUND_MIN_AWAKE: "2" }).minAwake).toBe(2);
    expect(planFromEnv({}).interval).toBe(600);
  });
});

describe("BackgroundSync", () => {
  test("nothing starts before the first window has loaded; then the places catch up one at a time", () => {
    const h = harness();
    h.bg.setWanted([A, B, LIB]);
    vi.advanceTimersByTime(60_000);
    expect(h.started).toEqual([]);
    h.bg.ready();
    expect(h.running.size).toBe(1);
    // Its page says nothing waits: it goes after its minimum, and the next one starts.
    const first = [...h.running][0]!;
    h.bg.reported(first, 0);
    vi.advanceTimersByTime(20_000);
    expect(h.running.has(first)).toBe(false);
    expect(h.running.size).toBe(1);
    expect(new Set(h.started.slice(0, 2)).size).toBe(2);
    h.bg.dispose();
    expect(h.running.size).toBe(0);
  });

  test("a place leaving the windows wakes now; one opening in a window goes", () => {
    const h = harness();
    h.bg.ready();
    h.bg.setWanted([A]);
    expect([...h.running]).toEqual([A]);
    h.bg.setWanted([B]);
    expect([...h.running]).toEqual([B]);
    h.bg.dispose();
  });

  test("a page that never reports goes at the maximum, and a quiet place doesn't come back before its interval", () => {
    const h = harness();
    h.bg.ready();
    h.bg.setWanted([A]);
    vi.advanceTimersByTime(119_000);
    expect(h.running.has(A)).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(h.running.has(A)).toBe(false);
    vi.advanceTimersByTime(300_000);
    expect(h.started).toEqual([A]);
    vi.advanceTimersByTime(320_000);
    expect(h.started).toEqual([A, A]);
    h.bg.dispose();
  });

  test("the library's folder changing wakes its runner once the burst settles", () => {
    const h = harness();
    h.bg.setWanted([LIB]);
    h.bg.ready();
    h.bg.reported(LIB, 0);
    vi.advanceTimersByTime(20_000);
    expect(h.running.size).toBe(0);
    h.bg.libraryChanged();
    h.bg.libraryChanged();
    vi.advanceTimersByTime(2_000);
    expect(h.running.size).toBe(0);
    vi.advanceTimersByTime(1_500);
    expect([...h.running]).toEqual([LIB]);
    h.bg.dispose();
  });

  test("a new unread count wakes the account's runner; the first count only reports", async () => {
    let n = 1;
    const h = harness({ unread: async () => n });
    h.bg.setWanted([A]);
    h.bg.ready();
    h.bg.reported(A, 0);
    // The first poll (5 s after the start) only reports the count.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.counts).toEqual([[A, 1]]);
    expect(h.running.size).toBe(0);
    n = 2;
    await h.bg.pollUnread();
    expect([...h.running]).toEqual([A]);
    h.bg.dispose();
  });

  test("a runner whose window went by itself is forgotten and comes back when due", () => {
    const h = harness();
    h.bg.ready();
    h.bg.setWanted([A]);
    h.running.delete(A);
    h.bg.runnerGone(A);
    expect(h.bg.isAwake(A)).toBe(false);
    vi.advanceTimersByTime(601_000);
    expect(h.started).toEqual([A, A]);
    h.bg.dispose();
  });
});
