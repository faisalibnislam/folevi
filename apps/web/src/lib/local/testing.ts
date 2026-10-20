// A local library for tests (the parity harness, tests/parity/drivers/localDriver.ts): a LocalClient over a
// fresh LocalBackend on an in-memory store, already set up the way LocalGate sets up a new library.
import { api } from "@/lib/convex/api";
import { LocalBackend } from "./backend";
import { LocalClient } from "./client";
import { MemoryStore, type LocalStore } from "./store";

export interface TestLocalClient extends LocalClient {
  profileId: string;
  deviceId: string;
  store: LocalStore;
  backend: LocalBackend;
}

export async function createTestLocalClient(opts: { seed?: boolean; deviceId?: string; store?: LocalStore; timeZone?: string; today?: string } = {}): Promise<TestLocalClient> {
  const deviceId = opts.deviceId ?? "test-local-device";
  const store = opts.store ?? new MemoryStore();
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
