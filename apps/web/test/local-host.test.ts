// One window hosts the local library and the others follow it (lib/local/host.ts): leader election with a Web
// Lock, calls and change fan-out over a BroadcastChannel, and handover when the host window closes. Two jsdom
// windows share one library "on disk" (a MemoryStore both backends open), a lock manager and a channel name.
import { afterEach, describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { ulid, type SyncOp } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { LocalBackend } from "@/lib/local/backend";
import { startLocalHost, type ChannelLike, type HostRole, type LocalHost, type LockManagerLike } from "@/lib/local/host";
import { MemoryStore } from "@/lib/local/store";

// A second (and third) browser window. jsdom ships no types of its own; only the window is used.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, o: { url: string }) => { window: Window & typeof globalThis } };

/** navigator.locks for one lock, shared by the windows of a test. */
class FakeLocks implements LockManagerLike {
  private held = false;
  private waiting: (() => void)[] = [];
  async request(_name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown> {
    if (this.held && options.ifAvailable) return await callback(null);
    if (this.held) {
      await new Promise<void>((resolve, reject) => {
        const go = () => resolve();
        this.waiting.push(go);
        options.signal?.addEventListener("abort", () => {
          this.waiting = this.waiting.filter((w) => w !== go);
          reject(new Error("AbortError"));
        });
      });
    }
    this.held = true;
    try {
      return await callback({ name: _name });
    } finally {
      this.held = false;
      this.waiting.shift()?.();
    }
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function library() {
  const disk = new MemoryStore();
  const setup = new LocalBackend(disk, { deviceId: "setup" });
  await setup.local.setup({ timeZone: "UTC", locale: "en", seed: false });
  await setup.close();
  return disk;
}

function openWindow(disk: MemoryStore, locks: FakeLocks, channelName: string, name: string) {
  const dom = new JSDOM("<!doctype html><p></p>", { url: `app://folevi/${name}` });
  const opened: string[] = [];
  const host = startLocalHost({
    windowId: name,
    locks,
    channel: () => new BroadcastChannel(channelName) as unknown as ChannelLike,
    target: dom.window as unknown as Window,
    openBackend: async () => {
      opened.push(name);
      return new LocalBackend(disk, { deviceId: `device${name}` });
    },
  });
  cleanups.push(() => host.close());
  return { dom, host, opened };
}

const createNote = (id: string, title: string): SyncOp => ({ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: "📝" } });
const rename = (id: string, title: string): SyncOp => ({ opId: ulid(), kind: "document.update", documentId: id, patch: { title }, baseRevision: null });
const push = (host: LocalHost, ops: SyncOp[]) => host.client.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId: "web-device-1", ops });

function watchTitle(host: LocalHost, id: string) {
  const w = host.client.watchQuery(api.documents.titles, { documentIds: [id] });
  const seen: (string | undefined)[] = [];
  const read = () => (w.localQueryResult() as Record<string, { title: string }> | undefined)?.[id]?.title;
  const off = w.onUpdate(() => seen.push(read()));
  cleanups.unshift(off);
  return { read, seen };
}

describe("local library host", () => {
  test("the first window hosts, the second follows, and both see every change", async () => {
    const disk = await library();
    const locks = new FakeLocks();
    const channel = `lib-${ulid()}`;
    const a = openWindow(disk, locks, channel, "A");
    expect(await a.host.ready).toBe("host");
    const b = openWindow(disk, locks, channel, "B");
    expect(await b.host.ready).toBe("follower");
    expect(b.opened).toEqual([]);

    const inA = watchTitle(a.host, "N1");
    const inB = watchTitle(b.host, "N1");
    // A write from the follower runs in the host, and both windows' queries hear of it.
    const [created] = (await push(b.host, [createNote("N1", "From B")])) as { status: string }[];
    expect(created!.status).toBe("applied");
    await until(() => inA.read() === "From B" && inB.read() === "From B");
    // And the other way round.
    await push(a.host, [rename("N1", "From A")]);
    await until(() => inB.read() === "From A");
    // A query the follower makes once runs in the host too.
    await expect(b.host.client.query(api.users.me, {})).resolves.toMatchObject({ state: "ready" });
  });

  test("when the host window closes, the next takes over: its queries keep working, unchanged", async () => {
    const disk = await library();
    const locks = new FakeLocks();
    const channel = `lib-${ulid()}`;
    const a = openWindow(disk, locks, channel, "A");
    await a.host.ready;
    const b = openWindow(disk, locks, channel, "B");
    await b.host.ready;
    const client = b.host.client;
    await push(b.host, [createNote("N2", "Before")]);
    const inB = watchTitle(b.host, "N2");
    await until(() => inB.read() === "Before");

    const roles: HostRole[] = [];
    b.host.onRoleChange((r) => roles.push(r));
    // Closing the window (pagehide) lets the library go.
    a.dom.window.dispatchEvent(new a.dom.window.Event("pagehide"));
    await until(() => b.host.role === "host");
    expect(a.host.role).toBe("closed");
    expect(roles).toEqual(["host"]);
    expect(b.opened).toEqual(["B"]);
    // Same client object; it now runs here, against the same library.
    expect(b.host.client).toBe(client);
    await push(b.host, [rename("N2", "After")]);
    await until(() => inB.read() === "After");
    expect(inB.seen.at(-1)).toBe("After");

    // A third window follows the new host.
    const c = openWindow(disk, locks, channel, "C");
    expect(await c.host.ready).toBe("follower");
    await expect(c.host.client.query(api.documents.titles, { documentIds: ["N2"] })).resolves.toMatchObject({ N2: { title: "After" } });
  });

  test("a call made while no window is hosting waits for the next host and runs there once", async () => {
    const disk = await library();
    const locks = new FakeLocks();
    const channel = `lib-${ulid()}`;
    const a = openWindow(disk, locks, channel, "A");
    await a.host.ready;
    const b = openWindow(disk, locks, channel, "B");
    await b.host.ready;
    // A goes; B's write goes out before B has the library, and lands once B hosts it.
    const closing = a.host.close();
    const result = push(b.host, [createNote("N3", "Queued")]);
    await closing;
    await until(() => b.host.role === "host");
    await expect(result).resolves.toMatchObject([{ status: "applied" }]);
    const backend = new LocalBackend(disk, { deviceId: "check" });
    const docs = (await disk.list("documents")).filter((d) => d.id === "N3");
    expect(docs).toHaveLength(1);
    await backend.close();
  });
});
