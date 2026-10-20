// Task reminders in local mode (WP14): an OS notification at a to-do's reminder time, scheduled through the
// host (`shell().notify`, lib/local/native.ts), which keeps them across restarts and shows each id and time
// once. The server's version is convex/tasks.ts processReminders; the words are the same.
//
// The window that hosts the library keeps the host's list in step with the library: every open to-do with a
// reminder, not in Trash, not more than a day late (as the server). It looks again whenever notes change,
// edits from another device included, and cancels what's no longer wanted. What it scheduled is remembered
// in this origin's storage, so a reminder removed while the app was closed is cancelled on the next launch.
import type { LocalBackend } from "./backend";
import { pendingReminders } from "./functions/tasks";
import { localNative } from "./native";

const SCHEDULED_KEY = "folevi:local-reminders";
/** A reminder more than this late isn't shown any more (processReminders looks back a day). */
const LATE_MS = 24 * 60 * 60 * 1000;
const SETTLE_MS = 400;

export interface ReminderNotification {
  id: string;
  at: number;
  title: string;
  body: string;
  path: string;
}

/** The notification for a task's reminder. Its id is the block's, so a moved reminder replaces the old one. */
export function reminderNotification(r: { blockId: string; documentId: string; documentTitle: string; title: string; reminderAt: number }): ReminderNotification {
  const title = r.title.slice(0, 200) || "Task";
  return {
    id: `reminder:${r.blockId}`,
    at: r.reminderAt,
    title: `Reminder: ${title.slice(0, 110)}`,
    body: r.documentTitle ? `In ${r.documentTitle}` : "",
    path: `/d/${r.documentId}#block-${r.blockId}`,
  };
}

/** What should be scheduled now, by id. */
export async function wantedReminders(backend: LocalBackend, now: number): Promise<Map<string, ReminderNotification>> {
  const out = new Map<string, ReminderNotification>();
  for (const r of await pendingReminders(backend.store)) {
    if (r.reminderAt < now - LATE_MS) continue;
    const n = reminderNotification(r);
    out.set(n.id, n);
  }
  return out;
}

const same = (a: ReminderNotification, b: ReminderNotification) => a.at === b.at && a.title === b.title && a.body === b.body && a.path === b.path;

function readScheduled(): Map<string, ReminderNotification> {
  try {
    const raw = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]") as ReminderNotification[];
    return new Map(Array.isArray(raw) ? raw.filter((n) => n && typeof n.id === "string").map((n) => [n.id, n]) : []);
  } catch {
    return new Map();
  }
}

function writeScheduled(map: Map<string, ReminderNotification>) {
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify([...map.values()]));
  } catch {
    // Storage full or blocked: the next launch schedules again (the host shows each id and time once).
  }
}

/**
 * Keeps the host's reminders in step with this library. Returns the function that stops it. Does nothing on
 * a device without notifications.
 */
export function startLocalReminders(backend: LocalBackend, opts: { now?: () => number; settleMs?: number } = {}): () => void {
  const notify = localNative().notify;
  if (!notify) return () => undefined;
  const now = opts.now ?? Date.now;
  const scheduled = readScheduled();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  const reconcile = async () => {
    const wanted = await wantedReminders(backend, now());
    for (const [id, n] of wanted) {
      const had = scheduled.get(id);
      if (had && same(had, n)) continue;
      await notify.schedule(n);
      scheduled.set(id, n);
    }
    for (const id of [...scheduled.keys()]) {
      if (wanted.has(id)) continue;
      await notify.cancel(id);
      scheduled.delete(id);
    }
    writeScheduled(scheduled);
  };

  const run = () => {
    if (backend.isClosed) stop();
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = reconcile()
      .catch((e: unknown) => console.error("[local mode] Couldn't schedule reminders:", e))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          run();
        }
      });
  };

  const soon = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, opts.settleMs ?? SETTLE_MS);
  };

  // A note's blocks or the catalog (a note to Trash and back) changed: look again once edits settle.
  const unsubscribe = backend.subscribe((keys) => {
    if (keys.some((k) => k.startsWith("blocks:") || k === "catalog")) soon();
  });
  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
  run();
  return stop;
}
