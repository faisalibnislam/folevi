// The Vault's Files & Notes on the server (convex/vaultFiles.ts): folders, notes kept version by version, files
// stored as ciphertext and counted toward storage (and given back), downloads logged, moving out for custodians
// only, the Vault's Trash and its 30-day expiry.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enableFlag, join, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

const blob = (n = 64, fill = 1) => new Uint8Array(n).fill(fill).buffer;
const sealed = (fill = 1) => ({ sealedSummary: blob(64, fill), sealed: blob(96, fill), wrappedKey: blob(60, fill), keyVersion: 1 });

/** Gives a Vault its first key version (what vaultKeys.setUp leaves, without the crypto). */
async function keyed(t: T, vaultId: string, by: string) {
  await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", vaultId))
      .unique())!;
    await ctx.db.patch(vault._id, { keyVersion: 1 });
    const scope = vault.workspaceId ? { workspaceId: vault.workspaceId } : { ownerProfileId: vault.ownerProfileId! };
    await ctx.db.insert("vaultKeys", { vaultId: vault._id, ...scope, version: 1, check: blob(16), createdBy: by as Id<"profiles">, createdAt: Date.now() });
  });
}

const store = (t: T, n: number) => t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array(n).fill(7)])));
const usedBytes = (t: T, profileId: string) => t.run(async (ctx) => (await ctx.db.get(profileId as Id<"profiles">))?.personalStorageUsedBytes ?? 0);

describe("Files & Notes", { timeout: 60_000 }, () => {
  test("folders nest but never inside themselves; deleting one takes what's inside to Trash", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vf-a@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, id, a.profileId);
    const top = ulid();
    const inner = ulid();
    await a.as.mutation(api.vaultFiles.createFolder, { vaultId: id, folderId: top, sealedName: blob(40), keyVersion: 1 });
    await a.as.mutation(api.vaultFiles.createFolder, { vaultId: id, folderId: inner, parentId: top, sealedName: blob(40), keyVersion: 1 });
    expect(await codeOf(a.as.mutation(api.vaultFiles.updateFolder, { vaultId: id, folderId: top, parentId: inner }))).toBe("invalid_argument");
    const note = ulid();
    await a.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: note, folderId: inner, item: sealed() });
    expect((await a.as.query(api.vaultItems.list, { vaultId: id, section: "files", folderId: inner })).items.map((i) => i.id)).toEqual([note]);
    expect((await a.as.query(api.vaultFiles.folders, { vaultId: id })).map((f) => [f.id, f.parentId])).toEqual([
      [top, null],
      [inner, top],
    ]);

    await a.as.mutation(api.vaultFiles.removeFolder, { vaultId: id, folderId: top });
    expect(await a.as.query(api.vaultFiles.folders, { vaultId: id })).toEqual([]);
    expect((await a.as.query(api.vaultItems.list, { vaultId: id, section: "trash" })).items.map((i) => i.id)).toEqual([note]);
    // Restored without its folder: it comes back at the top.
    await a.as.mutation(api.vaultItems.restore, { vaultId: id, itemId: note });
    expect((await a.as.query(api.vaultItems.list, { vaultId: id, section: "files", folderId: null })).items.map((i) => i.id)).toEqual([note]);
  });

  test("notes keep each version; files are stored as given, counted toward storage, logged when opened, given back when the Trash empties", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vf-files@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, id, a.profileId);

    const note = ulid();
    await a.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: note, item: sealed(1) });
    expect(await a.as.mutation(api.vaultFiles.saveNote, { vaultId: id, itemId: note, baseRevision: 1, item: sealed(2) })).toEqual({ revision: 2 });
    expect(await codeOf(a.as.mutation(api.vaultFiles.saveNote, { vaultId: id, itemId: note, baseRevision: 1, item: sealed(3) }))).toBe("conflict");
    expect((await a.as.mutation(api.vaultItems.history, { vaultId: id, itemId: note })).map((h) => h.revision)).toEqual([1]);

    const before = await usedBytes(t, a.profileId);
    const file = ulid();
    // A device can't claim a smaller size than it stored.
    const lie = await store(t, 5000);
    expect(await codeOf(a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: file, storageId: lie, size: 10, item: sealed() }))).toBe("invalid_argument");
    const stored = await store(t, 5000);
    expect(await a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: file, storageId: stored, size: 5000, item: sealed() })).toEqual({ revision: 1 });
    expect(await usedBytes(t, a.profileId)).toBe(before + 5000);
    // A new version replaces the bytes and counts the difference.
    const bigger = await store(t, 8000);
    expect(await a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: file, storageId: bigger, size: 8000, item: sealed(2), baseRevision: 1 })).toEqual({ revision: 2 });
    expect(await usedBytes(t, a.profileId)).toBe(before + 8000);

    const got = await a.as.mutation(api.vaultFiles.fileUrl, { vaultId: id, itemId: file, purpose: "download" });
    expect(got.url).toMatch(/^https?:/);
    const events = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
          .collect()
      ).map((e) => e.event),
    );
    expect(events).toEqual(expect.arrayContaining(["item.created", "note.edited", "file.added", "file.updated", "file.download"]));

    await a.as.mutation(api.vaultItems.remove, { vaultId: id, itemId: file });
    expect(await a.as.mutation(api.vaultFiles.emptyTrash, { vaultId: id })).toEqual({ removed: 1 });
    expect(await usedBytes(t, a.profileId)).toBe(before);
    expect(await codeOf(a.as.mutation(api.vaultFiles.fileUrl, { vaultId: id, itemId: file, purpose: "preview" }))).toBe("not_found");
  });

  test("only custodians move notes out or empty the Trash; the Trash empties itself after 30 days", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await person(t, "vf-owner@example.com");
    const member = await person(t, "vf-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "vf-member@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    await t.run(async (ctx) => {
      const vault = (await ctx.db
        .query("vaults")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique())!;
      await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: member.profileId as Id<"profiles">, role: "member", addedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
    });
    const note = ulid();
    await member.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: note, item: sealed(), movedFrom: "DOC123" });
    expect(await codeOf(member.as.mutation(api.vaultFiles.moveOut, { vaultId: id, itemId: note, toDocumentId: "DOC999" }))).toBe("forbidden");
    expect(await codeOf(member.as.mutation(api.vaultFiles.emptyTrash, { vaultId: id }))).toBe("forbidden");
    await owner.as.mutation(api.vaultFiles.moveOut, { vaultId: id, itemId: note, toDocumentId: "DOC999" });
    expect(await codeOf(owner.as.mutation(api.vaultItems.open, { vaultId: id, itemId: note }))).toBe("not_found");

    const old = ulid();
    await member.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: old, item: sealed() });
    await member.as.mutation(api.vaultItems.remove, { vaultId: id, itemId: old });
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("vaultItems")
        .withIndex("by_public_id", (q) => q.eq("publicId", old))
        .unique())!;
      await ctx.db.patch(row._id, { deletedAt: Date.now() - 31 * 24 * 3600 * 1000 });
    });
    await t.mutation(internal.vaultFiles.purgeOldTrash, {});
    expect((await owner.as.query(api.vaultItems.list, { vaultId: id, section: "trash" })).items).toEqual([]);
    const log = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
          .collect()
      ).map((e) => [e.event, e.actorRole]),
    );
    expect(log).toEqual(expect.arrayContaining([["note.movedIn", "member"], ["note.movedOut", "owner"], ["trash.expired", "system"]]));
  });
});
