// The places no window shows, kept in sync without a hidden page each (the Mac app's BackgroundSync.swift, ported).
// Electron used to keep one hidden runner window (/place-sync) per such place all day: a renderer process of 60 to
// 100 MB each. Now a place's runner only runs while there's work, then goes:
//
// - right away when a place leaves the windows (a switch: what was queued there goes up now), when an account is
//   added, when the library's folder changes (another device wrote; its reminders get scheduled), and when an
//   account has new notifications (see below);
// - every `interval` (10 minutes) otherwise, one place at a time, so each catches up;
// - for at least `minAwake` and until its page says nothing is waiting (PlaceSync's describe), at most `maxAwake`
//   (or `maxAwakeWaiting` while something still is), then the page is let go.
//
// At launch nothing starts until the first window has loaded (`ready`); the places in the background then catch up
// one at a time, never all at once next to the window being opened.
//
// Notifications stay prompt without a page: every `pollMs` (a minute) each account in the background asks Folevi for
// its unread count (one small Convex query with that account's own token); a new one wakes the account's page,
// which shows it as it always has (PlaceSync: labelled with the account, never twice). Reminders in the library are
// main's (reminders.ts): they fire with no page.
//
// No Electron here (main.ts gives it the runners), so it's tested with fake timers (background.test.ts).

import { LIBRARY } from "./places";

export interface BackgroundPlan {
  /** Seconds between a place's regular catch-ups. */
  interval: number;
  minAwake: number;
  maxAwake: number;
  maxAwakeWaiting: number;
  /** At most this many runners at once for the regular catch-up (a wake with a reason doesn't wait). */
  regularAtOnce: number;
}

export const DEFAULT_PLAN: BackgroundPlan = { interval: 600, minAwake: 15, maxAwake: 120, maxAwakeWaiting: 600, regularAtOnce: 1 };

export interface Awake {
  since: number;
  /** What the page said is waiting last (null before it said anything). */
  waiting: number | null;
  /** Kept awake until then at least. */
  holdUntil: number | null;
}

/** Whether an awake runner has done its work (times in ms, the plan in seconds). */
export function verdict(plan: BackgroundPlan, a: Awake, now: number): "keep" | "release" {
  if (a.holdUntil !== null && now < a.holdUntil) return "keep";
  const up = (now - a.since) / 1000;
  if (up < plan.minAwake) return "keep";
  if (a.waiting === 0) return "release";
  if (a.waiting === null) return up >= plan.maxAwake ? "release" : "keep";
  return up >= plan.maxAwakeWaiting ? "release" : "keep";
}

/** The places due a regular catch-up now, oldest first, within the regular budget. */
export function due(plan: BackgroundPlan, wanted: string[], lastSync: Map<string, number>, awake: Set<string>, now: number): string[] {
  const room = Math.max(0, plan.regularAtOnce - awake.size);
  if (room === 0) return [];
  const last = (p: string) => lastSync.get(p) ?? -Infinity;
  return wanted
    .filter((p) => !awake.has(p) && (now - last(p)) / 1000 >= plan.interval)
    .sort((a, b) => last(a) - last(b))
    .slice(0, room);
}

/** Whether an unread count from the poll means something new arrived (a first count never does). */
export const isNewUnread = (previous: number | undefined, now: number) => previous !== undefined && now > previous;

/** FOLEVI_BACKGROUND_INTERVAL, _MIN_AWAKE, _MAX_AWAKE, _MAX_WAITING (seconds) shorten the timings for test runs. */
export function planFromEnv(env: Record<string, string | undefined>): BackgroundPlan {
  const s = (key: string, fallback: number) => {
    const n = Number(env[key]);
    return env[key] && Number.isFinite(n) ? Math.max(1, n) : fallback;
  };
  return {
    interval: s("FOLEVI_BACKGROUND_INTERVAL", DEFAULT_PLAN.interval),
    minAwake: s("FOLEVI_BACKGROUND_MIN_AWAKE", DEFAULT_PLAN.minAwake),
    maxAwake: s("FOLEVI_BACKGROUND_MAX_AWAKE", DEFAULT_PLAN.maxAwake),
    maxAwakeWaiting: s("FOLEVI_BACKGROUND_MAX_WAITING", DEFAULT_PLAN.maxAwakeWaiting),
    regularAtOnce: DEFAULT_PLAN.regularAtOnce,
  };
}

/** A JWT's `exp` (ms), or null. */
export function jwtExpiry(jwt: string): number | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" && Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface BackgroundDeps {
  /** Opens a place's runner page; false when it couldn't. */
  startRunner(place: string): boolean;
  /** Closes it (it may be gone already). */
  stopRunner(place: string): void;
  /** Whether a place is an account (the library has no unread count to poll). */
  isAccount(place: string): boolean;
  /** The account's unread count from Folevi, or null (offline, signed out, no answer). */
  unread?(place: string): Promise<number | null>;
  /** The poll's count, for the place's dot and the taskbar badge. */
  onUnread?(place: string, count: number): void;
  /** Whether a Folevi window is in front (the poll slows to every third minute otherwise). */
  isFront?(): boolean;
  now?(): number;
}

export interface BackgroundOptions {
  plan?: BackgroundPlan;
  /** The unread poll's pace (60 s). */
  pollMs?: number;
  /** How long a page that's done stays before it goes (its last writes settle). */
  lingerMs?: number;
  /** A burst of folder changes settles this long before the library's page wakes. */
  libraryDelayMs?: number;
}

type Timer = ReturnType<typeof setTimeout>;
const unref = (t: Timer) => {
  (t as { unref?: () => void }).unref?.();
  return t;
};

export class BackgroundSync {
  readonly plan: BackgroundPlan;
  private readonly pollMs: number;
  private readonly lingerMs: number;
  private readonly libraryDelayMs: number;
  private wanted: string[] = [];
  private readonly awake = new Map<string, Awake>();
  private readonly lastSync = new Map<string, number>();
  private readonly lastUnread = new Map<string, number>();
  private readonly releasing = new Set<string>();
  private tick: Timer | null = null;
  private tickPace: number | null = null;
  private poll: Timer | null = null;
  private firstPoll: Timer | null = null;
  private libraryWake: Timer | null = null;
  private polling = false;
  private lastPoll: number | null = null;
  private started = false;
  private disposed = false;
  /** Why each place woke last, and when. */
  readonly log: { place: string; what: string; at: number }[] = [];

  constructor(
    private readonly deps: BackgroundDeps,
    o: BackgroundOptions = {},
  ) {
    this.plan = o.plan ?? DEFAULT_PLAN;
    this.pollMs = o.pollMs ?? 60_000;
    this.lingerMs = o.lingerMs ?? 3_000;
    this.libraryDelayMs = o.libraryDelayMs ?? 3_000;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** Whether the first window has loaded (nothing wakes before). */
  get isReady() {
    return this.started;
  }

  isAwake(place: string) {
    return this.awake.has(place);
  }

  awakePlaces() {
    return [...this.awake.keys()];
  }

  /**
   * The places that want a runner (every one no main window shows): one that's new to the list wakes now (it just
   * left the windows, or was just added); one that left goes. Before `ready` they're only noted: the catch-up
   * starts them one at a time once the first window has loaded.
   */
  setWanted(places: string[]) {
    const before = new Set(this.wanted);
    this.wanted = [...new Set(places)];
    for (const id of [...this.awake.keys()]) if (!this.wanted.includes(id)) this.release(id, "open");
    if (this.started) for (const id of this.wanted) if (!before.has(id)) this.wake(id, "background");
    for (const m of [this.lastSync, this.lastUnread]) for (const id of [...m.keys()]) if (!this.wanted.includes(id)) m.delete(id);
    this.schedule();
  }

  /** The first window has loaded: the background may start. */
  ready() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.schedule();
    this.step();
  }

  /** A place's page said what's waiting there (its describe). */
  reported(place: string | null, waiting: number | null | undefined) {
    const a = place ? this.awake.get(place) : undefined;
    if (!a) return;
    a.waiting = typeof waiting === "number" && Number.isFinite(waiting) ? Math.max(0, waiting) : (a.waiting ?? 0);
  }

  /** The library's folder changed (another device wrote): its page catches up, once the burst settles. */
  libraryChanged() {
    if (!this.wanted.includes(LIBRARY) || this.disposed) return;
    if (this.libraryWake) clearTimeout(this.libraryWake);
    this.libraryWake = unref(
      setTimeout(() => {
        this.libraryWake = null;
        this.wake(LIBRARY, "folder");
      }, this.libraryDelayMs),
    );
  }

  /** Starts a place's runner now (if it's in the background and not already running); `holdMs` keeps it at least that long. */
  wake(place: string, why: string, holdMs?: number) {
    if (!this.started || this.disposed || !this.wanted.includes(place)) return;
    const now = this.now();
    const a = this.awake.get(place);
    if (a) {
      // A page that's up already gets the change itself.
      if (holdMs !== undefined) a.holdUntil = now + holdMs;
      return;
    }
    if (!this.deps.startRunner(place)) return;
    this.awake.set(place, { since: now, waiting: null, holdUntil: holdMs === undefined ? null : now + holdMs });
    this.lastSync.set(place, now);
    this.note(place, why);
    this.schedule();
  }

  /** The runner's window went by itself (its page crashed, or it was closed): forget it, it wakes again when due. */
  runnerGone(place: string) {
    if (!this.awake.delete(place)) return;
    this.lastSync.set(place, this.now());
    this.note(place, "gone");
    this.schedule();
  }

  /** Every timer off and every runner closed (the app is quitting). */
  dispose() {
    for (const id of [...this.awake.keys()]) this.release(id, "quit");
    this.disposed = true;
    for (const t of [this.tick, this.poll, this.firstPoll, this.libraryWake]) if (t) clearTimeout(t);
    this.tick = this.poll = this.firstPoll = this.libraryWake = null;
    this.tickPace = null;
  }

  private release(place: string, why: string) {
    if (!this.awake.delete(place)) return;
    this.lastSync.set(place, this.now());
    this.deps.stopRunner(place);
    this.note(place, `released: ${why}`);
    this.schedule();
  }

  private note(place: string, what: string) {
    this.log.push({ place, what, at: this.now() });
    if (this.log.length > 50) this.log.splice(0, this.log.length - 50);
  }

  /**
   * The step's pace: every 2 s while a runner is up (it goes soon after its work), otherwise only often enough to
   * catch up on time, and no timer at all when nothing is in the background.
   */
  private pace(): number | null {
    if (!this.started || this.disposed) return null;
    if (this.awake.size) return 2_000;
    if (!this.wanted.length) return null;
    return Math.min(20, Math.max(2, this.plan.interval / 2)) * 1000;
  }

  private schedule() {
    const pace = this.pace();
    if (pace !== this.tickPace) {
      if (this.tick) clearInterval(this.tick);
      this.tick = pace === null ? null : unref(setInterval(() => this.step(), pace));
      this.tickPace = pace;
    }
    // The unread poll only while an account is in the background (it asks nothing for the library).
    const accounts = this.started && !this.disposed && !!this.deps.unread && this.wanted.some((p) => this.deps.isAccount(p));
    if (!accounts) {
      if (this.poll) clearInterval(this.poll);
      if (this.firstPoll) clearTimeout(this.firstPoll);
      this.poll = this.firstPoll = null;
    } else if (!this.poll) {
      this.poll = unref(setInterval(() => void this.pollUnread(true), this.pollMs));
      this.firstPoll = unref(
        setTimeout(() => {
          this.firstPoll = null;
          void this.pollUnread();
        }, 5_000),
      );
    }
  }

  /** One step: lets go of runners that are done, starts the catch-up that's due. */
  step() {
    if (!this.started || this.disposed) return;
    const now = this.now();
    for (const [place, a] of this.awake) {
      if (verdict(this.plan, a, now) !== "release" || this.releasing.has(place)) continue;
      this.releasing.add(place);
      unref(
        setTimeout(() => {
          this.releasing.delete(place);
          // Still done (no new work came in the meantime).
          const still = this.awake.get(place);
          if (!still || verdict(this.plan, still, this.now()) !== "release") return;
          this.release(place, still.waiting === 0 ? "done" : "time");
          // The next place due a catch-up starts now, not at the next (slower) step.
          this.step();
        }, this.lingerMs),
      );
    }
    for (const place of due(this.plan, this.wanted, this.lastSync, new Set(this.awake.keys()), now)) this.wake(place, "catch up");
  }

  /**
   * Every account in the background, asleep: its unread count from Folevi. A new one wakes its page. From the timer
   * while no Folevi window is in front, every third tick (3 minutes, not 1): each ask wakes the network.
   */
  async pollUnread(timer = false) {
    const unread = this.deps.unread;
    if (this.polling || !unread || this.disposed) return;
    const accounts = this.wanted.filter((p) => this.deps.isAccount(p));
    if (!accounts.length) return;
    const now = this.now();
    if (timer && this.deps.isFront && !this.deps.isFront() && this.lastPoll !== null && now - this.lastPoll < this.pollMs * 3 - 1000) return;
    this.lastPoll = now;
    this.polling = true;
    try {
      for (const place of accounts) {
        const count = await unread(place).catch(() => null);
        if (count === null || !this.wanted.includes(place)) continue;
        const previous = this.lastUnread.get(place);
        this.lastUnread.set(place, count);
        this.deps.onUnread?.(place, count);
        if (isNewUnread(previous, count) && !this.awake.has(place)) this.wake(place, "notification");
      }
    } finally {
      this.polling = false;
    }
  }
}
