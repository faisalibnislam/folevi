// Reminders in local mode (docs/LOCAL_MODE_PLAN.md WP14): the page schedules a Mac notification for a time
// (`foleviShell.notify.schedule`), and this keeps them, in a file in the app's data folder, so they still go
// off after Folevi quits and opens again. Each one is armed with a timer while the app runs; one whose time
// passed while Folevi was closed shows when it opens again, if it's less than a day late (as the server's
// reminders, convex/tasks.ts processReminders). An id and time shows once: the page schedules everything it
// wants on every launch, and a reminder already shown isn't shown again. Pure apart from the timers and the
// file, so it's tested without Electron (main.ts shows the notifications).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Reminder {
  id: string;
  /** When it goes off (UTC ms). */
  at: number;
  title: string;
  body: string;
  /** Where clicking it opens Folevi ("/d/<note>#block-<id>"). */
  path: string;
}

interface Shown {
  id: string;
  at: number;
  shownAt: number;
}

interface FileShape {
  reminders: Reminder[];
  shown: Shown[];
}

/** A reminder more than this late isn't shown. */
export const LATE_MS = 24 * 60 * 60 * 1000;
/** How long a shown reminder is remembered (so a second launch doesn't show it again). */
const SHOWN_KEPT_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_REMINDERS = 2000;
/** setTimeout's longest wait; a later reminder is armed again when it ends. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const ID = /^[A-Za-z0-9:_-]{1,120}$/;
const CONTROL = /[\u0000-\u001F\u007F]/g;
const HAS_CONTROL = /[\u0000-\u001F\u007F]/;

/** A reminder from the page, checked and trimmed, or null when it isn't one. */
export function cleanReminder(input: unknown): Reminder | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID.test(r.id)) return null;
  if (typeof r.at !== "number" || !Number.isFinite(r.at) || r.at < 0) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(CONTROL, " ").trim().slice(0, max) : "");
  const title = text(r.title, 200);
  if (!title) return null;
  // Only a path inside the app: "/d/...", never another site or a protocol-relative "//host".
  const path = typeof r.path === "string" && r.path.startsWith("/") && !r.path.startsWith("//") && !HAS_CONTROL.test(r.path) ? r.path.slice(0, 500) : "/";
  return { id: r.id, at: Math.floor(r.at), title, body: text(r.body, 400), path };
}

export interface ReminderDeps {
  /** Shows the notification (main.ts: an Electron Notification that opens `path` when clicked). */
  show(r: Reminder): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class Reminders {
  private reminders = new Map<string, Reminder>();
  private shown: Shown[] = [];
  private timers = new Map<string, unknown>();
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly file: string,
    private readonly deps: ReminderDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Reads what was scheduled before (the app opening again, local mode switched on) and arms it. */
  load(): void {
    this.stop();
    this.reminders.clear();
    let data: Partial<FileShape> = {};
    try {
      data = JSON.parse(readFileSync(this.file, "utf8")) as Partial<FileShape>;
    } catch {
      data = {};
    }
    const now = this.now();
    this.shown = (Array.isArray(data.shown) ? data.shown : []).filter((s) => s && typeof s.id === "string" && typeof s.at === "number" && typeof s.shownAt === "number" && now - s.shownAt < SHOWN_KEPT_MS);
    for (const raw of Array.isArray(data.reminders) ? data.reminders : []) {
      const r = cleanReminder(raw);
      if (r && this.reminders.size < MAX_REMINDERS) this.reminders.set(r.id, r);
    }
    for (const r of [...this.reminders.values()]) this.arm(r);
    this.save();
  }

  /** Schedules a reminder (replacing one with the same id). False when the input isn't one. */
  schedule(input: unknown): boolean {
    const r = cleanReminder(input);
    if (!r) return false;
    if (!this.reminders.has(r.id) && this.reminders.size >= MAX_REMINDERS) return false;
    this.disarm(r.id);
    this.reminders.set(r.id, r);
    this.arm(r);
    this.save();
    return true;
  }

  cancel(id: unknown): void {
    if (typeof id !== "string" || !this.reminders.has(id)) return;
    this.disarm(id);
    this.reminders.delete(id);
    this.save();
  }

  /** Drops every reminder (leaving local mode). */
  clear(): void {
    for (const id of [...this.timers.keys()]) this.disarm(id);
    this.reminders.clear();
    this.save();
  }

  /** What's waiting, soonest first (tests, and the file). */
  pending(): Reminder[] {
    return [...this.reminders.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  stop(): void {
    for (const id of [...this.timers.keys()]) this.disarm(id);
  }

  private wasShown(r: Reminder) {
    return this.shown.some((s) => s.id === r.id && s.at === r.at);
  }

  private arm(r: Reminder) {
    // Shown already (the page schedules everything again on each launch): kept out.
    if (this.wasShown(r)) {
      this.reminders.delete(r.id);
      return;
    }
    const wait = r.at - this.now();
    if (wait <= 0) {
      if (-wait <= LATE_MS) this.fire(r);
      else {
        this.reminders.delete(r.id);
        this.save();
      }
      return;
    }
    this.timers.set(
      r.id,
      this.setTimer(() => {
        this.timers.delete(r.id);
        const current = this.reminders.get(r.id);
        if (current && current.at === r.at) this.arm(current);
      }, Math.min(wait, MAX_TIMER_MS)),
    );
  }

  private disarm(id: string) {
    const t = this.timers.get(id);
    if (t !== undefined) this.clearTimer(t);
    this.timers.delete(id);
  }

  private fire(r: Reminder) {
    this.reminders.delete(r.id);
    this.shown = [...this.shown.filter((s) => s.id !== r.id), { id: r.id, at: r.at, shownAt: this.now() }];
    this.save();
    try {
      this.deps.show(r);
    } catch (e) {
      console.error("Folevi reminder:", e);
    }
  }

  private save() {
    const data: FileShape = { reminders: this.pending(), shown: this.shown };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error("Folevi couldn't save reminders:", e);
    }
  }
}
