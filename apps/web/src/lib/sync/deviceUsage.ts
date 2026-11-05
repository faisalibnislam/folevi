// What this account's copy takes on this device (Settings > Offline & Sync: Notes kept, Space used), measured so
// that it always finishes (QA F19): each reading on its own, each with a time limit. One that fails or never
// answers (WebKit's storage estimate can do either in the apps) is unknown (null), not "still measuring", and the
// others still show.
import { localDb } from "./db";
import { keptFilesUsage, storageBudget } from "./deviceFiles";

export type DeviceUsage = {
  /** Notes kept whole on this device (one row per note), or null when it couldn't be read. */
  notes: number | null;
  files: { count: number; bytes: number } | null;
  /** The browser's estimate of what Folevi takes, and what's free; null when unknown. */
  used: number | null;
  free: number | null;
  budget: number;
};

/** How long one reading may take before it counts as unknown. */
export const USAGE_TIMEOUT_MS = 5000;

/** A promise's value, or null when it fails or takes longer than `ms`. */
export function settleWithin<T>(work: () => Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    let p: Promise<T>;
    try {
      p = work();
    } catch {
      clearTimeout(timer);
      resolve(null);
      return;
    }
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function measureDeviceUsage(accountKey: string, timeoutMs = USAGE_TIMEOUT_MS): Promise<DeviceUsage> {
  const [notes, files, est, budget] = await Promise.all([
    settleWithin(async () => (await localDb(accountKey)).count("blocks"), timeoutMs),
    settleWithin(() => keptFilesUsage(accountKey), timeoutMs),
    settleWithin(async () => (await navigator.storage?.estimate?.()) ?? null, timeoutMs),
    settleWithin(() => storageBudget(), timeoutMs),
  ]);
  return {
    notes,
    files,
    used: typeof est?.usage === "number" ? est.usage : null,
    free: typeof est?.quota === "number" ? Math.max(0, est.quota - (est.usage ?? 0)) : null,
    budget: budget ?? 256 * 1024 * 1024,
  };
}

/** Whether a reading is missing (shown as unavailable, with a way to measure again). */
export function usageIncomplete(u: Pick<DeviceUsage, "notes" | "used"> | null): boolean {
  return !u || u.notes === null || u.used === null;
}
