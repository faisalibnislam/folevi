// A library's Vault (docs/MAC_REBUILD_PLAN.md §5.6, lib/local/functions/vault.ts): the account Vault's functions
// answered on this device, with the real cryptography of lib/vault/* and the library actor (no account key). Set up,
// add a password, lock, a wrong passcode, unlock, the recovery key, a file, a note, history, Trash, reuse; and nothing
// readable in what the library keeps.
import { afterEach, describe, expect, test } from "vitest";
import { api } from "@/lib/convex/api";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { setVaultFileLayer } from "@/lib/local/vault/files";
import { libraryVaultActor, resetVaultSessionsForTests, vaultSessions, type VaultClient } from "@/lib/vault/keys";
import { changedFields, newItemId, openSecrets, openSummary, sealItem, splitItem } from "@/lib/vault/items";
import { fetchCiphertext, openFile, openFileSummary, openFolderName, openNote, sealFile, sealFolderName, sealNote, sendCiphertext } from "@/lib/vault/files";

const PIN = "246813";

async function library() {
  setVaultFileLayer(null);
  const store = new MemoryStore();
  let clock = Date.UTC(2026, 9, 1);
  const backend = new LocalBackend(store, { deviceId: "dev_here", now: () => clock });
  const client = new LocalClient(backend);
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Sam", seed: false });
  vaultSessions().bind(client as unknown as VaultClient, libraryVaultActor("dev_here"));
  return { client, store, advance: (ms: number) => (clock += ms) };
}

afterEach(() => {
  resetVaultSessionsForTests();
  setVaultFileLayer(undefined);
});

describe("a library's Vault", () => {
  test("set up, add, lock, a wrong passcode, unlock, and the recovery key", { timeout: 60_000 }, async () => {
    const { client, store } = await library();
    expect(await client.query(api.vault.get, { scope: { kind: "personal" } })).toEqual({ exists: false, personal: true, role: "owner" });
    const { id: vaultId } = await client.mutation(api.vault.create, { scope: { kind: "personal" } });
    const s = vaultSessions();
    const { recoveryText } = await s.setUp(vaultId, PIN);
    expect(s.isOpen(vaultId)).toBe(true);
    const info = await client.query(api.vault.get, { scope: { kind: "personal" } });
    expect(info).toMatchObject({ exists: true, id: vaultId, keyVersion: 1, hasAccessKey: true, hasRecovery: true, autoLockMinutes: 5 });

    const itemId = newItemId();
    const content = splitItem("login", "Bank", { username: "sam@example.com", password: "Correct-Horse-9-Battery", website: "bank.example" });
    await client.mutation(api.vaultItems.create, { vaultId, itemId, kind: "login", item: await sealItem(vaultId, itemId, 1, s.keys(vaultId), content) });
    const list = await client.query(api.vaultItems.list, { vaultId, section: "passwords" });
    expect(list.items).toHaveLength(1);
    const keysOf = (v: number) => s.keys(vaultId, v);
    expect(await openSummary(vaultId, list.items[0]!, keysOf)).toMatchObject({ kind: "login", title: "Bank", fields: { username: "sam@example.com" } });

    // Nothing readable is kept: not the title, the username or the password.
    const kept = JSON.stringify(await store.list("vault", "items")) + JSON.stringify(await store.list("vault", "meta"));
    for (const plain of ["Bank", "sam@example.com", "Correct-Horse", PIN]) expect(kept).not.toContain(plain);

    await s.lock(vaultId, "manual");
    expect(s.isOpen(vaultId)).toBe(false);
    expect(await s.unlock(vaultId, { passcode: "000000" })).toEqual({ status: "wrong" });
    expect(await s.unlock(vaultId, { passcode: PIN })).toEqual({ status: "ok" });
    const opened = await client.mutation(api.vaultItems.open, { vaultId, itemId });
    expect((await openSecrets(vaultId, opened, keysOf)).fields.password).toBe("Correct-Horse-9-Battery");

    // A forgotten passcode: the recovery key sets a new one.
    await s.lock(vaultId, "manual");
    expect(await s.changePasscode(vaultId, { recoveryText }, "13572468")).toEqual({ status: "ok" });
    await s.lock(vaultId, "manual");
    expect(await s.unlock(vaultId, { passcode: PIN })).toEqual({ status: "wrong" });
    expect(await s.unlock(vaultId, { passcode: "13572468" })).toEqual({ status: "ok" });
    client.close();
  });

  test("five wrong passcodes in a row lock it for 15 minutes", { timeout: 120_000 }, async () => {
    const { client, advance } = await library();
    const { id: vaultId } = await client.mutation(api.vault.create, { scope: { kind: "personal" } });
    await vaultSessions().setUp(vaultId, PIN);
    await vaultSessions().lock(vaultId, "manual");
    for (let i = 0; i < 4; i++) expect(await client.mutation(api.vaultKeys.unlockResult, { vaultId, ok: false, way: "passcode" })).toEqual({ lockedUntil: null });
    const fifth = await client.mutation(api.vaultKeys.unlockResult, { vaultId, ok: false, way: "passcode" });
    expect(fifth.lockedUntil).toBeGreaterThan(0);
    expect(await vaultSessions().unlock(vaultId, { passcode: PIN })).toMatchObject({ status: "locked" });
    advance(16 * 60_000);
    expect(await vaultSessions().unlock(vaultId, { passcode: PIN })).toEqual({ status: "ok" });
    client.close();
  });

  test("folders, a file and a note, history, Trash and reuse", { timeout: 60_000 }, async () => {
    const { client } = await library();
    const { id: vaultId } = await client.mutation(api.vault.create, { scope: { kind: "personal" } });
    const s = vaultSessions();
    await s.setUp(vaultId, PIN);
    const keysOf = (v: number) => s.keys(vaultId, v);

    const folderId = newItemId();
    await client.mutation(api.vaultFiles.createFolder, { vaultId, folderId, sealedName: await sealFolderName(vaultId, folderId, 1, s.keys(vaultId), "Contracts"), keyVersion: 1 });
    const folders = await client.query(api.vaultFiles.folders, { vaultId });
    expect(await openFolderName(vaultId, folderId, folders[0]!.sealedName, keysOf, 1)).toBe("Contracts");

    const fileId = newItemId();
    const text = new TextEncoder().encode("name,amount\nrent,1200\n");
    const { ciphertext, item } = await sealFile(vaultId, fileId, 1, s.keys(vaultId), { name: "budget.csv", type: "text/csv", bytes: text });
    const storageId = await sendCiphertext(await client.mutation(api.vaultFiles.uploadUrl, { vaultId }), ciphertext);
    await client.mutation(api.vaultFiles.saveFile, { vaultId, itemId: fileId, folderId, storageId: storageId as never, size: ciphertext.length, item });
    const inFolder = await client.query(api.vaultItems.list, { vaultId, section: "files", folderId });
    expect(inFolder.items.map((i) => i.kind)).toEqual(["file"]);
    expect(await openFileSummary(vaultId, inFolder.items[0]!, keysOf)).toMatchObject({ title: "budget.csv", mime: "text/csv", size: text.length });
    const r = await client.mutation(api.vaultFiles.fileUrl, { vaultId, itemId: fileId, purpose: "preview" });
    const f = await openFile(vaultId, { id: fileId, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, await fetchCiphertext(r.url), keysOf);
    expect(new TextDecoder().decode(f.bytes)).toBe("name,amount\nrent,1200\n");

    const noteId = newItemId();
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Safe code 4711" }] }] };
    await client.mutation(api.vaultFiles.createNote, { vaultId, itemId: noteId, item: await sealNote(vaultId, noteId, 1, s.keys(vaultId), "Safe", doc, "Safe code 4711") });
    const top = await client.query(api.vaultItems.list, { vaultId, section: "files", folderId: null });
    expect(top.items.map((i) => i.id)).toEqual([noteId]);
    const note = await client.mutation(api.vaultItems.open, { vaultId, itemId: noteId });
    expect((await openNote(vaultId, note, keysOf)).doc).toEqual(doc);

    // Two logins with one password: reuse counts them; an edit keeps the version before.
    const a = newItemId();
    const b = newItemId();
    const one = splitItem("login", "Mail", { password: "same-password-1" });
    await client.mutation(api.vaultItems.create, { vaultId, itemId: a, kind: "login", item: await sealItem(vaultId, a, 1, s.keys(vaultId), one) });
    await client.mutation(api.vaultItems.create, { vaultId, itemId: b, kind: "login", item: await sealItem(vaultId, b, 1, s.keys(vaultId), splitItem("login", "Shop", { password: "same-password-1" })) });
    expect(Object.values(await client.query(api.vaultItems.reuse, { vaultId }))).toEqual([2]);
    const two = splitItem("login", "Mail", { password: "a-new-password-2" });
    expect(changedFields(one, two)).toEqual(["password"]);
    await client.mutation(api.vaultItems.update, { vaultId, itemId: a, baseRevision: 1, item: await sealItem(vaultId, a, 1, s.keys(vaultId), two), changed: ["password"] });
    expect(await client.query(api.vaultItems.reuse, { vaultId })).toEqual({});
    const history = await client.mutation(api.vaultItems.history, { vaultId, itemId: a });
    expect(history.map((h) => h.revision)).toEqual([1]);
    expect((await openSecrets(vaultId, { id: a, ...history[0]! }, keysOf)).fields.password).toBe("same-password-1");
    await client.mutation(api.vaultItems.restoreVersion, { vaultId, itemId: a, revision: 1 });
    const back = await client.mutation(api.vaultItems.open, { vaultId, itemId: a });
    expect(back.revision).toBe(3);
    expect((await openSecrets(vaultId, back, keysOf)).fields.password).toBe("same-password-1");

    // Trash: a removed item waits there; Restore brings it back; Empty Trash deletes it and its file for good.
    await client.mutation(api.vaultItems.remove, { vaultId, itemId: b });
    await client.mutation(api.vaultItems.remove, { vaultId, itemId: fileId });
    expect((await client.query(api.vaultItems.list, { vaultId, section: "trash" })).items.map((i) => i.id).sort()).toEqual([b, fileId].sort());
    await client.mutation(api.vaultItems.restore, { vaultId, itemId: b });
    expect(await client.mutation(api.vaultFiles.emptyTrash, { vaultId })).toEqual({ removed: 1 });
    await expect(client.mutation(api.vaultItems.open, { vaultId, itemId: fileId })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    await expect(fetchCiphertext(r.url)).rejects.toThrow();
    client.close();
  });
});
