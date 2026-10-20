// Libraries for the move's tests (tests/parity/migration.test.ts): a LocalClient over the persistent store on
// an in-memory folder, journal and replica database, as the app keeps one, and the same library opened again
// from exactly what it had kept at one moment, as after the app was killed there.
import { MemoryFs, MemoryJournal } from "@folevi/local-store";
import { ulid } from "@folevi/editor-schema";
import { createTestLocalClient, type TestLocalClient } from "@/lib/local/testing";
import { LibraryStore, MemoryLibraryHost, MemoryReplicaDb } from "@/lib/local/store/index";

export interface TestLibrary {
  client: TestLocalClient;
  host: MemoryLibraryHost;
  dbName: string;
}

export async function openTestLibrary(opts: { seed?: boolean; deviceId?: string; host?: MemoryLibraryHost; dbName?: string; today?: string } = {}): Promise<TestLibrary> {
  const host = opts.host ?? new MemoryLibraryHost();
  const dbName = opts.dbName ?? `migrate-test-${ulid()}`;
  const deviceId = opts.deviceId ?? "test_local_device";
  const store = await LibraryStore.open({
    host,
    deviceId,
    openDb: async () => MemoryReplicaDb.open(dbName),
    page: null,
    scanMs: 0,
    libraryIds: { recall: () => null, remember: () => {} },
  });
  const client = await createTestLocalClient({ store, deviceId, seed: opts.seed ?? false, ...(opts.today ? { today: opts.today } : {}) });
  return { client, host, dbName };
}

/**
 * The library as it was on the device at this moment (its folder, its journal and this device's copy), opened
 * by a new store and backend: what the app finds when it starts again after being killed. The old one is left
 * as it is, never closed or flushed.
 */
export async function reopenAfterKill(lib: TestLibrary): Promise<TestLibrary> {
  const fs = new MemoryFs();
  for (const e of await lib.host.inner.list("")) {
    const r = await lib.host.inner.read(e.path);
    if ("bytes" in r) await fs.write(e.path, r.bytes, {});
  }
  const journal = new MemoryJournal();
  journal.records = await lib.host.journal.readAll();
  const old = MemoryReplicaDb.open(lib.dbName);
  const dbName = `${lib.dbName}-restarted-${ulid()}`;
  const db = MemoryReplicaDb.open(dbName);
  db.rows = new Map(structuredClone([...old.rows]));
  db.notes = new Map(structuredClone([...old.notes]));
  db.state = new Map(structuredClone([...old.state]));
  return await openTestLibrary({ host: new MemoryLibraryHost({ fs, journal }), dbName, deviceId: lib.client.deviceId });
}
