// Local mode for the parity harness: WP5's LocalBackend over an in-memory library (its MemoryStore today;
// MemoryFs from packages/local-store once the store is built on it), reached
// through the same `query(ref, args)`, `mutation` and `action` surface LocalClient gives convex/react
// (docs/LOCAL_MODE_PLAN.md §2.1).
//
// The one seam to wire: `apps/web/src/lib/local/testing.ts` exports
//
//   createTestLocalClient(opts: { seed: boolean }): Promise<{
//     query(ref, args): Promise<unknown>; mutation(ref, args): Promise<unknown>; action(ref, args): Promise<unknown>;
//     close(): Promise<void>;
//     profileId: string;   // the local profile's id (users.me)
//     deviceId?: string;   // this device's id, if it stamps one on what it returns
//   }>
//
// a LocalClient over a fresh LocalBackend on MemoryFs, already through local onboarding (seeded like an
// account's Personal when `seed` is true). Without it, the driver builds the same from lib/local/index.ts
// (`new LocalClient(new LocalBackend(new MemoryStore(), { deviceId }))`, then `client.local.setup`). With
// neither, `openLocalDriver()` returns null and the harness runs every scenario against Convex only. If
// WP5 names things differently, change `wire()` below: nothing else in the harness knows how local mode is
// built.
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { ParityBackend } from "../types";

interface TestLocalClient {
  query(ref: unknown, args: unknown): Promise<unknown>;
  mutation(ref: unknown, args: unknown): Promise<unknown>;
  action(ref: unknown, args: unknown): Promise<unknown>;
  close?(): Promise<void>;
  profileId?: string;
  deviceId?: string;
}

type Factory = (opts: { seed: boolean }) => Promise<TestLocalClient>;

// Lazy, so a missing module is an empty map rather than a failed import.
const testingModules = import.meta.glob<Record<string, unknown>>("../../../apps/web/src/lib/local/testing.ts");
const indexModules = import.meta.glob<Record<string, unknown>>("../../../apps/web/src/lib/local/index.ts");

export type LocalAvailability = { ready: true; factory: Factory } | { ready: false; reason: string };

let availability: Promise<LocalAvailability> | undefined;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Ctor = new (...args: unknown[]) => Record<string, unknown>;

/** The same thing built from lib/local/index.ts: LocalBackend on a MemoryStore, under a LocalClient. */
function fromIndex(mod: Record<string, unknown>): Factory | null {
  const { LocalBackend, LocalClient, MemoryStore } = mod as Record<string, Ctor | undefined>;
  if (typeof LocalBackend !== "function" || typeof LocalClient !== "function" || typeof MemoryStore !== "function") return null;
  return async ({ seed }) => {
    const deviceId = "parity-local-device";
    const client = new LocalClient(new LocalBackend(new MemoryStore(), { deviceId })) as unknown as TestLocalClient & { local: { setup(i: unknown): Promise<unknown> } };
    await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "parity", seed });
    const me = (await client.query(api.users.me, {})) as { state: string; profile?: { id: string } };
    return Object.assign(client, { profileId: me.profile?.id, deviceId });
  };
}

async function wire(): Promise<LocalAvailability> {
  const loadTesting = Object.values(testingModules)[0];
  if (loadTesting) {
    let mod: Record<string, unknown>;
    try {
      mod = await loadTesting();
    } catch (error) {
      return { ready: false, reason: `lib/local/testing.ts failed to load: ${errorText(error)}` };
    }
    const factory = mod.createTestLocalClient ?? mod.default;
    if (typeof factory !== "function") return { ready: false, reason: "lib/local/testing.ts has no createTestLocalClient export" };
    return { ready: true, factory: factory as Factory };
  }
  const loadIndex = Object.values(indexModules)[0];
  if (!loadIndex) return { ready: false, reason: "lib/local (WP5) hasn't landed yet" };
  let mod: Record<string, unknown>;
  try {
    mod = await loadIndex();
  } catch (error) {
    return { ready: false, reason: `lib/local/index.ts failed to load: ${errorText(error)}` };
  }
  const factory = fromIndex(mod);
  return factory ? { ready: true, factory } : { ready: false, reason: "lib/local/index.ts doesn't export LocalBackend, LocalClient and MemoryStore" };
}

/** Whether local mode can be driven yet (cached; the reason says what's missing when it can't). */
export function localAvailability(): Promise<LocalAvailability> {
  availability ??= wire();
  return availability;
}

export class LocalDriver implements ParityBackend {
  readonly kind = "local" as const;
  readonly scope = { kind: "personal" } as const;
  readonly known = new Map<string, string>();
  readonly calls = new Set<string>();

  constructor(
    private readonly client: TestLocalClient,
    readonly deviceId: string,
  ) {
    if (client.profileId) this.known.set(client.profileId, "<profile>");
    if (client.deviceId) this.known.set(client.deviceId, "<device>");
    this.known.set(deviceId, "<device>");
  }

  private note(ref: FunctionReference<"query" | "mutation" | "action", "public">) {
    this.calls.add(getFunctionName(ref));
  }

  async query<R extends FunctionReference<"query", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    return (await this.client.query(ref, args)) as R["_returnType"];
  }

  async mutation<R extends FunctionReference<"mutation", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    return (await this.client.mutation(ref, args)) as R["_returnType"];
  }

  async action<R extends FunctionReference<"action", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    return (await this.client.action(ref, args)) as R["_returnType"];
  }

  async close() {
    await this.client.close?.();
  }
}

/** A fresh local library signed in as nobody (local mode has a profile, no account), or null if not wired yet. */
export async function openLocalDriver(deviceId: string): Promise<LocalDriver | null> {
  const a = await localAvailability();
  if (!a.ready) return null;
  return new LocalDriver(await a.factory({ seed: true }), deviceId);
}
