// Where a move keeps what it has done (docs/LOCAL_MODE_PLAN.md §6.1 step 3: "recorded in the replica"): in the
// library's copy on this device, under a meta key that never reaches the library folder (`device:`, see
// lib/local/store/policy.ts isDeviceMeta). So a move that stopped (the app quit, the Mac slept, the network
// went) goes on from where it was, and the record goes when the library's copy on this device does.
import type { LocalBackend } from "@/lib/local/backend";
import type { MigrationState, ProgressStore } from "./types";

/** The key for a move: one going up, one per place coming down (Personal, each workspace). */
export function progressKey(direction: MigrationState["direction"], place = "personal"): string {
  return direction === "upload" ? "device:migration:upload" : `device:migration:export:${place}`;
}

/** The move's record in a library's copy on this device (the LocalBackend the library is open in). */
export function libraryProgress(backend: Pick<LocalBackend, "store" | "run">, key: string): ProgressStore {
  return {
    load: async () => ((await backend.store.get("meta", key)) as MigrationState | undefined) ?? null,
    save: async (state) => {
      await backend.run((ctx) => ctx.db.put("meta", key, structuredClone(state)));
    },
  };
}

/** A record kept in memory only (tests). */
export function memoryProgress(initial: MigrationState | null = null): ProgressStore & { state: MigrationState | null } {
  const store = {
    state: initial,
    load: async () => (store.state ? structuredClone(store.state) : null),
    save: async (s: MigrationState) => {
      store.state = structuredClone(s);
    },
  };
  return store;
}

export function freshState(direction: MigrationState["direction"], sourceProfileId: string, targetProfileId: string, now: number): MigrationState {
  return {
    v: 1,
    direction,
    startedAt: now,
    sourceProfileId,
    targetProfileId,
    inbox: null,
    folders: {},
    tags: {},
    files: {},
    collections: {},
    notes: {},
    dailyAsPage: {},
    versions: {},
    trashed: {},
    problems: [],
    finishedAt: null,
  };
}
