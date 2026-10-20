// A local library for tests (the parity harness, tests/parity/drivers/localDriver.ts): a LocalClient over a
// fresh LocalBackend, already set up the way LocalGate sets up a new library. Its store is the persistent one
// (store/libraryStore.ts) over an in-memory folder, journal and replica database, as in the app;
// LOCAL_TEST_STORE=memory picks the plain MemoryStore instead.
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { LocalBackend } from "./backend";
import { LocalClient } from "./client";
import { MemoryStore, type LocalStore } from "./store";

/** A LibraryStore on a fresh in-memory library (MemoryFs, journal, replica database). */
async function defaultTestStore(deviceId: string): Promise<LocalStore> {
  if (typeof process !== "undefined" && process.env?.LOCAL_TEST_STORE === "memory") return new MemoryStore();
  const { LibraryStore, MemoryLibraryHost, MemoryReplicaDb } = await import("./store/index");
  const run = ulid();
  return await LibraryStore.open({
    host: new MemoryLibraryHost(),
    deviceId,
    openDb: async (libraryId) => MemoryReplicaDb.open(`${run}:${libraryId}`),
    page: null,
    scanMs: 0,
    libraryIds: { recall: () => null, remember: () => {} },
  });
}

export interface TestLocalClient extends LocalClient {
  profileId: string;
  deviceId: string;
  store: LocalStore;
  backend: LocalBackend;
}

export async function createTestLocalClient(opts: { seed?: boolean; deviceId?: string; store?: LocalStore; timeZone?: string; today?: string } = {}): Promise<TestLocalClient> {
  const deviceId = opts.deviceId ?? "test-local-device";
  const store = opts.store ?? (await defaultTestStore(deviceId));
  const backend = new LocalBackend(store, { deviceId });
  const client = new LocalClient(backend);
  await client.local.setup({ timeZone: opts.timeZone ?? "UTC", locale: "en", displayName: "Test", seed: opts.seed ?? false, ...(opts.today ? { today: opts.today } : {}) });
  const me = (await client.query(api.users.me, {})) as { state: string; profile?: { id: string } };
  if (me.state !== "ready" || !me.profile) throw new Error("The test library didn't set up.");
  const closeClient = client.close.bind(client);
  return Object.assign(client, {
    profileId: me.profile.id,
    deviceId,
    store,
    backend,
    close: async () => {
      await closeClient();
      await backend.close();
    },
  });
}
