// Revision 15 through the bridge host: the Vault, end to end on a library on this device (lib/local/functions/vault.ts)
// with the real cryptography: set up, the recovery key, add a login and open it, Health, a 2FA code, a folder, a note
// and a file, lock, a wrong passcode, unlock, Trash; and what a library's Vault doesn't have (Activity, sharing).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { setVaultFileLayer } from "@/lib/local/vault/files";
import { resetVaultSessionsForTests } from "@/lib/vault/keys";
import type { Reply, VaultFileValue, VaultFoldersValue, VaultHealthValue, VaultItemsValue, VaultItemValue, VaultNoteValue, VaultSummaryValue, VaultUnlockResult } from "@/lib/engine/protocol";
import type { EngineClient } from "@/lib/engine/live";
import { Posts, rig } from "./fakes";

const PLACE = "library";
let host: BridgeHost;
let client: LocalClient;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async <T,>(m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value as T;
};
const query = <T,>(name: string, args: Record<string, unknown> = {}) => ok<T>({ kind: "query", place: PLACE, name, args });
const command = <T,>(name: string, args: Record<string, unknown> = {}) => ok<T>({ kind: "command", place: PLACE, name, args });
/** A view's answer once it shows what a change made (the library's queries answer from their last run first). */
const until = async <T,>(name: string, args: Record<string, unknown>, ok: (v: T) => boolean): Promise<T> => {
  for (let i = 0; ; i++) {
    const v = await query<T>(name, args);
    if (ok(v) || i > 50) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
};
const code = async (kind: string, name: string, args: Record<string, unknown>) => {
  const reply = await send({ kind, place: PLACE, name, args });
  return reply.ok ? null : reply.error.code;
};

beforeEach(async () => {
  setVaultFileLayer(null);
  client = new LocalClient(new LocalBackend(new MemoryStore(), { deviceId: "dev_here" }));
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Sam", seed: false });
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "mac", protocol: 1, place: PLACE }, queryTimeoutMs: 20_000 });
  const deps = rig(PLACE).deps({ mode: "local", capabilities: { graph: false, sharing: false, changes: false, workspaces: false, ai: false, purchases: false } });
  host.attach({ ...deps, client: client as unknown as EngineClient, kept: null });
  n = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
  resetVaultSessionsForTests();
  setVaultFileLayer(undefined);
  client.close();
});

describe("the Vault over the bridge, in a library", () => {
  it("sets up, opens items, files and notes, locks and unlocks", { timeout: 120_000 }, async () => {
    expect(await query<VaultSummaryValue>("vault.summary")).toMatchObject({ state: "setUp", vaultId: null, local: true, personal: true });
    const { recoveryKey } = await command<{ recoveryKey: string }>("vault.setUp", { passcode: "246813" });
    expect(recoveryKey.length).toBeGreaterThan(20);
    const open = await until<VaultSummaryValue>("vault.summary", {}, (v) => v.state === "open");
    expect(open).toMatchObject({ state: "open", local: true, recoveryToSave: recoveryKey, moreSections: ["health", "trash", "settings"], passcodeLengths: [6, 8, 12] });
    const vaultId = open.vaultId!;
    await command("vault.recoverySaved", { vaultId });
    expect((await until<VaultSummaryValue>("vault.summary", {}, (v) => !v.recoveryToSave)).recoveryToSave).toBeNull();

    // A login with a weak password and a 2FA secret.
    const { id } = await command<{ id: string }>("vault.item.save", { vaultId, kind: "login", title: "Bank", values: { username: "sam@example.com", password: "abc", website: "bank.example", totp: "JBSWY3DPEHPK3PXP" }, notes: "Branch on High Street" });
    const list = await until<VaultItemsValue>("vault.items", { vaultId, section: "passwords" }, (v) => v.items.length > 0);
    expect(list.items.map((i) => [i.title, i.detail])).toEqual([["Bank", "Login · sam@example.com"]]);
    expect(list.kinds.map((k) => k.kind)).toContain("sshKey");
    const item = await command<VaultItemValue>("vault.item.open", { vaultId, itemId: id });
    expect(item.fields.find((f) => f.key === "password")).toMatchObject({ type: "secret", value: "abc" });
    expect(item).toMatchObject({ title: "Bank", notes: "Branch on High Street", canChange: true, createdBy: "Sam", revision: 1 });
    const totp = await command<{ code: string | null; secondsLeft: number }>("vault.totp", { secret: "JBSWY3DPEHPK3PXP" });
    expect(totp.code).toMatch(/^\d{6}$/);
    expect((await command<{ code: string | null }>("vault.totp", { secret: "not one" })).code).toBeNull();
    const health = await until<VaultHealthValue>("vault.health", { vaultId }, (v) => v.groups.length > 0);
    expect(health.groups.map((g) => g.issue)).toContain("weak");
    expect(health.needsLook).toBe(1);

    // An edit keeps the version before.
    const { value: strong } = await command<{ value: string }>("vault.generate", { kind: "password" });
    expect((await command<{ score: number }>("vault.strength", { password: strong })).score).toBeGreaterThanOrEqual(3);
    await command("vault.item.save", { vaultId, itemId: id, kind: "login", title: "Bank", values: { username: "sam@example.com", password: strong, website: "bank.example" }, notes: "" });
    const history = await command<{ versions: { revision: number; fields: { key: string; value: string }[] }[] }>("vault.item.history", { vaultId, itemId: id });
    expect(history.versions.map((v) => v.revision)).toEqual([1]);
    expect(history.versions[0]!.fields.find((f) => f.key === "password")?.value).toBe("abc");

    // A folder, a note in it, a file at the top.
    const folder = await command<{ id: string }>("vault.folder.create", { vaultId, parentId: null, name: "Contracts" });
    expect((await until<VaultFoldersValue>("vault.folders", { vaultId }, (v) => v.folders.length > 0)).folders).toMatchObject([{ id: folder.id, name: "Contracts", parentId: null }]);
    const note = await command<{ id: string }>("vault.note.create", { vaultId, folderId: folder.id, title: "Safe" });
    const opened = await command<VaultNoteValue>("vault.note.open", { vaultId, itemId: note.id });
    await command("vault.note.save", { vaultId, itemId: note.id, revision: opened.revision, text: "Code 4711\nBehind the painting" });
    expect((await command<VaultNoteValue>("vault.note.open", { vaultId, itemId: note.id })).text).toBe("Code 4711\nBehind the painting");
    expect((await until<VaultItemsValue>("vault.items", { vaultId, section: "files", folderId: folder.id }, (v) => v.items[0]?.revision === 2)).items).toMatchObject([{ kind: "note", title: "Safe", detail: "Code 4711 Behind the painting" }]);
    const csv = btoa("name,amount\nrent,1200\n");
    const file = await command<{ id: string }>("vault.file.upload", { vaultId, folderId: null, name: "budget.csv", mime: "text/csv", data: csv });
    expect((await until<VaultItemsValue>("vault.items", { vaultId, section: "files", folderId: null }, (v) => v.items.length > 0)).items).toMatchObject([{ id: file.id, kind: "file", title: "budget.csv", detail: "55 B" }]);
    expect(await command<VaultFileValue>("vault.file.open", { vaultId, itemId: file.id, purpose: "preview" })).toEqual({ name: "budget.csv", mime: "text/csv", kind: "csv", data: csv });

    // Trash and back.
    await command("vault.item.remove", { vaultId, itemId: file.id });
    expect((await until<VaultItemsValue>("vault.items", { vaultId, section: "trash" }, (v) => v.items.length > 0)).items.map((i) => i.id)).toEqual([file.id]);
    await command("vault.item.restore", { vaultId, itemId: file.id });

    // What a library's Vault doesn't have.
    expect(await code("query", "vault.activity", { vaultId })).toBe("unavailable");
    expect(await code("command", "vault.share.person", { vaultId, itemId: id, email: "a@example.com", days: 30, canEdit: false })).toBe("unavailable");

    // Locked: nothing opens; a wrong passcode; the right one.
    await command("vault.lock", { vaultId });
    expect((await until<VaultSummaryValue>("vault.summary", {}, (v) => v.state === "locked")).state).toBe("locked");
    expect(await code("command", "vault.item.open", { vaultId, itemId: id })).toBe("locked");
    expect(await command<VaultUnlockResult>("vault.unlock", { vaultId, passcode: "000000" })).toEqual({ status: "wrong", until: null, message: "That isn't right. Try again." });
    expect((await command<VaultUnlockResult>("vault.unlock", { vaultId, passcode: "246813" })).status).toBe("ok");
    expect((await until<VaultSummaryValue>("vault.summary", {}, (v) => v.state === "open")).state).toBe("open");
    // The recovery key resets a forgotten passcode.
    await command("vault.lock", { vaultId });
    expect((await command<VaultUnlockResult>("vault.reset", { vaultId, recoveryKey, passcode: "13572468" })).status).toBe("ok");
  });
});
