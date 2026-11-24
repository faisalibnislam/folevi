// The IPC handlers: only Folevi's own page is answered, every argument is checked, failures come back as
// envelopes with their code, and change batches go to the pages that watch (until they're gone).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { cleanupTemps, fakeSealer, tempDir, utf8 } from "../../test/library-kit";
import { CHANGES_CHANNEL, LIBRARY_CHANNELS, registerLibraryIpc, type IpcEvent, type IpcMainLike } from "./ipc";
import { LibraryService } from "./service";

afterAll(cleanupTemps);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function setup() {
  const handlers = new Map<string, (e: IpcEvent, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), removeHandler: (c) => void handlers.delete(c) };
  const service = new LibraryService({
    userData: tempDir(),
    home: tempDir(),
    helperPath: null,
    coordinator: null,
    chooseFolder: async () => null,
    sealer: fakeSealer,
    iterations: 1000,
    watch: { useFsEvents: false, scanIntervalMs: 3_600_000 },
  });
  const off = registerLibraryIpc(ipc, service, (e) => e.senderFrame?.url.startsWith("app://folevi/") ?? false);
  cleanups.push(() => {
    off();
    service.dispose();
  });
  const sent: unknown[][] = [];
  let destroyed: (() => void) | null = null;
  const sender = { id: 7, send: (...a: unknown[]) => void sent.push(a), isDestroyed: () => false, once: (_: string, l: () => void) => (destroyed = l) };
  const page: IpcEvent = { sender, senderFrame: { url: "app://folevi/d/x" } };
  const call = (channel: string, ...args: unknown[]) => handlers.get(`library:${channel}`)!(page, ...args) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;
  return { handlers, service, call, page, sent, destroy: () => destroyed?.() };
}

describe("library IPC", () => {
  test("registers every channel and removes them again", () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(LIBRARY_CHANNELS.map((c) => `library:${c}`).sort());
    cleanups.pop()!();
    expect(handlers.size).toBe(0);
  });

  test("preload.ts calls exactly these channels (it can't import them: the preload is sandboxed)", () => {
    const preload = readFileSync(join(__dirname, "..", "preload.ts"), "utf8");
    const used = new Set([...preload.matchAll(/\blib\("([a-z-]+)"/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...LIBRARY_CHANNELS].sort());
    expect(preload).toContain(`"${CHANGES_CHANNEL}"`);
  });

  test("answers only Folevi's own page", async () => {
    const { handlers } = setup();
    const r = await handlers.get("library:info")!({ sender: { id: 1, send: () => undefined, isDestroyed: () => false, once: () => undefined }, senderFrame: { url: "https://evil.example/" } });
    expect(r).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
  });

  test("checks arguments before the library sees them", async () => {
    const { call } = setup();
    await call("setup", { kind: "device" });
    expect(await call("setup", { kind: "usb" })).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    expect(await call("write", "notes/a.fnote", "not bytes", {})).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    expect(await call("write", "notes/a.fnote", utf8("x"), { ifMatch: 3 })).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    expect(await call("write", "../a", utf8("x"), {})).toMatchObject({ ok: false, error: { code: "invalid_path" } });
    expect(await call("resolve-conflicts", "notes/a.fnote", "id")).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    expect(await call("journal-truncate", 1.5)).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    expect(await call("unlock", { passphrase: "x" })).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
  });

  test("files and the journal round-trip, with codes on failure", async () => {
    const { call } = setup();
    expect(await call("list", "")).toMatchObject({ ok: false, error: { code: "not_set_up" } });
    expect(await call("setup", { kind: "device" })).toMatchObject({ ok: true, value: { kind: "device", configured: true } });
    const w = (await call("write", "notes/A.fnote", utf8("a"), { ifMatch: null })) as { ok: true; value: { etag: string } };
    expect(w.ok).toBe(true);
    expect(await call("write", "notes/A.fnote", utf8("b"), { ifMatch: null })).toMatchObject({ ok: true, value: { mismatch: true, etag: w.value.etag } });
    expect(await call("read", "notes/missing.fnote")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await call("remove", "notes/A.fnote", { ifMatch: "stale" })).toMatchObject({ ok: false, error: { code: "mismatch" } });
    expect(await call("journal-append", utf8("r1"))).toEqual({ ok: true, value: null });
    expect(await call("journal-read")).toMatchObject({ ok: true, value: [utf8("r1")] });
    expect(await call("conflict-versions", "notes/A.fnote")).toEqual({ ok: true, value: [] });
    expect(await call("unlock", "anything")).toEqual({ ok: true, value: true });
  });

  test("change batches go to watching pages until they unwatch or close", async () => {
    const { call, service, sent, destroy } = setup();
    await call("setup", { kind: "device" });
    expect(await call("watch")).toEqual({ ok: true, value: true });
    await call("watch"); // twice is once
    (service as unknown as { onChanges(c: unknown): Promise<void> }).onChanges([{ path: "notes/X.fnote", kind: "changed" }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual([[CHANGES_CHANNEL, [{ path: "notes/X.fnote", kind: "changed" }]]]);
    destroy();
    (service as unknown as { onChanges(c: unknown): Promise<void> }).onChanges([{ path: "notes/Y.fnote", kind: "changed" }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.length).toBe(1);
  });
});
