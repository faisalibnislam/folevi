// Revision 10 through the bridge host: This device storage and its commands, the editor's text size, two-step,
// passkeys and sign-in methods, changing a person's role on a note, and the new web pages.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import { registerDeviceCopy, keepAllNotes, type DeviceCopyHandle } from "@/lib/sync/deviceCopyHost";
import { EDITOR_ZOOM_KEY } from "@/lib/engine/viewsAccount";
import type { DeviceStorageValue, Reply, SecuritySettings } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { user: { twoFactorEnabled: true } } })),
  $fetch: vi.fn(async () => ({ data: [{ id: "pk1", name: "", createdAt: "2026-10-01T00:00:00.000Z" }] })),
  listAccounts: vi.fn(async () => ({ data: [{ providerId: "credential" }, { providerId: "google" }, { providerId: "google" }] })),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: auth }));

const PLACE = "acct:user_1";
let host: BridgeHost;
let r: Rig;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const code = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  return reply.ok ? null : reply.error.code;
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });

function fakeCopy() {
  const calls: string[] = [];
  const handle = {
    copy: { status: () => [{ scopeKey: "personal", phase: "live", have: 3, total: 3 }], foreground: () => calls.push("foreground"), clear: async () => void calls.push("copy.clear"), subscribe: () => () => undefined },
    files: { clear: async () => void calls.push("files.clear") },
  } as unknown as DeviceCopyHandle;
  return { handle, calls };
}

beforeEach(() => {
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach(r.deps());
  n = 0;
  localStorage.clear();
});
afterEach(() => {
  registerDeviceCopy("prof_1", null);
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("This device", () => {
  it("device.keepAll turns the setting for this account on and off", async () => {
    await command("device.keepAll", { on: false });
    expect(keepAllNotes("prof_1")).toBe(false);
    await command("device.keepAll", { on: true });
    expect(keepAllNotes("prof_1")).toBe(true);
  });

  it("device.storage: each space's progress, encrypted spaces apart, and what waits", async () => {
    const { handle } = fakeCopy();
    registerDeviceCopy("prof_1", handle);
    r.encrypted.add("ws_vault");
    const v = (await query("device.storage")) as DeviceStorageValue;
    expect(v).toMatchObject({ place: PLACE, keepAll: true, available: true, waiting: 0 });
    expect(v.spaces).toEqual([
      { space: "personal", name: "Personal", phase: "live", have: 3, total: 3 },
      { space: "ws1", name: "Studio", phase: "listing", have: 0, total: null },
      { space: "ws_vault", name: "Vault", phase: "encrypted", have: 0, total: null },
    ]);
  });

  it("the copy's commands are unavailable when no copy runs here", async () => {
    expect(await code({ kind: "command", place: PLACE, name: "device.download", args: {} })).toBe("unavailable");
    expect(await code({ kind: "command", place: PLACE, name: "device.removeCopy", args: {} })).toBe("unavailable");
  });

  it("download runs the copy at once; remove asks first while changes wait", async () => {
    const { handle, calls } = fakeCopy();
    registerDeviceCopy("prof_1", handle);
    await command("device.download");
    expect(calls).toEqual(["foreground"]);
    r.outbox.entries.push({ id: "o1", name: "x", args: {}, keys: [], label: "x", createdAt: 0, attempts: 0 });
    expect(await command("device.removeCopy")).toEqual({ removed: false, waiting: 1 });
    expect(calls).toEqual(["foreground"]);
    expect(await command("device.removeCopy", { force: true })).toEqual({ removed: true, waiting: 1 });
    expect(calls).toEqual(["foreground", "copy.clear", "files.clear"]);
    await command("device.removeFiles");
    expect(calls.at(-1)).toBe("files.clear");
  });
});

describe("Settings", () => {
  it("the editor's text size snaps to a step and stays on this device", async () => {
    await command("settings.update", { editorZoom: 1.12 });
    expect(JSON.parse(localStorage.getItem(EDITOR_ZOOM_KEY)!)).toBe(1.1);
    expect(document.documentElement.style.getPropertyValue("--editor-zoom")).toBe("1.1");
    expect(r.client.mutations).toEqual([]);
    expect(await query("settings.appearance")).toMatchObject({ editorZoom: 1.1 });
    expect(await code({ kind: "command", place: PLACE, name: "settings.update", args: { editorZoom: 3 } })).toBe("invalid_args");
  });

  it("settings.security: two-step, passkeys with their last use, and sign-in methods", async () => {
    r.client.answer("users:listSessions", []);
    r.client.answer("passkeyUsage:lastUsed", [{ passkeyId: "pk1", lastUsedAt: 77 }]);
    const v = (await query("settings.security")) as SecuritySettings;
    expect(v.twoFactor).toBe(true);
    expect(v.passkeys).toEqual([{ id: "pk1", name: "Passkey", createdAt: Date.parse("2026-10-01T00:00:00.000Z"), lastUsedAt: 77 }]);
    expect(v.methods).toEqual(["password", "google"]);
  });
});

describe("sharing.setRole", () => {
  it("grants again with the person's email", async () => {
    r.client.answer("sharing:get", { people: [{ profileId: "p9", email: "kim@example.com" }] });
    await command("sharing.setRole", { noteId: "d1", profileId: "p9", role: "editor" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "sharing:grant", args: { documentId: "d1", email: "kim@example.com", role: "editor" } });
    expect(await code({ kind: "command", place: PLACE, name: "sharing.setRole", args: { noteId: "d1", profileId: "p0", role: "editor" } })).toBe("forbidden");
    expect(await code({ kind: "command", place: PLACE, name: "sharing.setRole", args: { noteId: "d1", profileId: "p9", role: "owner" } })).toBe("invalid_args");
  });
});
