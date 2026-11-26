// The Vault, after the security audit of 2026-11-26:
//   M4  an item shared with a workspace member stops being shared when they leave the workspace;
//   M5  an id the device chose is refused when something already has it (a second row broke every lookup of it);
//   M6  a page of an export can't be had without a log entry, however `after` is spelled;
//   L6  a file's bytes must be an upload of its own: not bytes something else in Folevi already points at.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { e2eePerson, enableFlag, join, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

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

const logOf = (t: T, vaultId: string) =>
  t.run(async (ctx) =>
    await ctx.db
      .query("vaultLog")
      .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vaultId))
      .collect(),
  );
const eventsOf = async (t: T, vaultId: string, event: string) => (await logOf(t, vaultId)).filter((e) => e.event === event);

const store = (t: T, n: number) => t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array(n).fill(7)])));

afterEach(() => {
  vi.useRealTimers();
});

describe("M4: a share with a workspace member ends with their membership", { timeout: 120_000 }, () => {
  async function shared(t: T, tag: string) {
    await enableFlag(t, "vault");
    const owner = await e2eePerson(t, `${tag}-owner@example.com`);
    const colleague = await e2eePerson(t, `${tag}-colleague@example.com`);
    const outsider = await e2eePerson(t, `${tag}-outsider@example.com`);
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, colleague, `${tag}-colleague@example.com`, workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    const note = ulid();
    await owner.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: note, item: sealed() });
    const shareId = ulid();
    // A member gets a share with no end date; someone outside always gets one.
    expect(await owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: note, shareId, profileId: colleague.profileId, canEdit: true, wrappedKey: blob(80), epoch: 1 })).toEqual({ expiresAt: null });
    const outsideShare = ulid();
    await owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: note, shareId: outsideShare, profileId: outsider.profileId, canEdit: false, wrappedKey: blob(80), epoch: 1 });
    return { owner, colleague, outsider, workspaceId, id, note, shareId, outsideShare };
  }

  test("removed from the workspace: the share is deleted and logged, nothing opens or saves any more", async () => {
    const t = setup();
    const { owner, colleague, outsider, workspaceId, id, note, shareId, outsideShare } = await shared(t, "m4a");
    expect(await colleague.as.query(api.vaultShares.mine, {})).toHaveLength(1);
    await colleague.as.mutation(api.vaultShares.openShared, { shareId });

    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: colleague.profileId });

    expect(await colleague.as.query(api.vaultShares.mine, {})).toEqual([]);
    expect(await codeOf(colleague.as.mutation(api.vaultShares.openShared, { shareId }))).toBe("not_found");
    expect(await codeOf(colleague.as.mutation(api.vaultShares.saveShared, { shareId, baseRevision: 1, sealedSummary: blob(64, 9), sealed: blob(96, 9) }))).toBe("not_found");
    // The owner's Share panel no longer lists them, and the log says the system ended it.
    expect((await owner.as.query(api.vaultShares.ofItem, { vaultId: id, itemId: note })).people.map((p) => p.profileId)).toEqual([outsider.profileId]);
    const ended = await eventsOf(t, id, "share.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ actorRole: "system", itemPublicId: note, detail: { why: "leftWorkspace", to: { profileId: colleague.profileId } } });
    // Someone outside keeps theirs until its end date.
    expect(await outsider.as.query(api.vaultShares.mine, {})).toHaveLength(1);
    await outsider.as.mutation(api.vaultShares.openShared, { shareId: outsideShare });
  });

  test("a share row left behind (made before this fix) doesn't work once its person is out of the workspace", async () => {
    const t = setup();
    const { colleague, workspaceId, shareId } = await shared(t, "m4b");
    // Their membership row goes without the leaving code running, as rows from before the fix were left.
    await t.run(async (ctx) => {
      const ws = (await ctx.db
        .query("workspaces")
        .withIndex("by_public_id", (q) => q.eq("publicId", workspaceId))
        .unique())!;
      for (const m of await ctx.db
        .query("workspaceMembers")
        .withIndex("by_profile", (q) => q.eq("profileId", colleague.profileId as Id<"profiles">))
        .collect())
        if (m.workspaceId === ws._id) await ctx.db.delete(m._id);
    });
    expect(await t.run(async (ctx) => (await ctx.db.query("vaultShares").collect()).filter((s) => s.publicId === shareId).length)).toBe(1);
    expect(await colleague.as.query(api.vaultShares.mine, {})).toEqual([]);
    expect(await codeOf(colleague.as.mutation(api.vaultShares.openShared, { shareId }))).toBe("not_found");
  });
});

describe("M5: an id something already has is refused", { timeout: 120_000 }, () => {
  test("another person can't break an item, a folder, a share or a link by reusing its id in a Vault of their own", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await e2eePerson(t, "m5-owner@example.com");
    const colleague = await e2eePerson(t, "m5-colleague@example.com");
    const attacker = await e2eePerson(t, "m5-attacker@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, colleague, "m5-colleague@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    const login = ulid();
    const note = ulid();
    const folder = ulid();
    const shareId = ulid();
    const linkId = "L".repeat(24);
    await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId: login, kind: "login", item: sealed() });
    await owner.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: note, item: sealed() });
    await owner.as.mutation(api.vaultFiles.createFolder, { vaultId: id, folderId: folder, sealedName: blob(40), keyVersion: 1 });
    await owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: note, shareId, profileId: colleague.profileId, canEdit: false, wrappedKey: blob(80), epoch: 1 });
    await owner.as.mutation(api.vaultShares.createLink, { vaultId: id, itemId: note, linkId, wrappedKey: blob(80), maxViews: 1, expiresInMs: 2 * 3600_000 });

    // The attacker's own Personal Vault, with something of theirs to share.
    const { id: own } = await attacker.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, own, attacker.profileId);
    const mine = ulid();
    await attacker.as.mutation(api.vaultFiles.createNote, { vaultId: own, itemId: mine, item: sealed(3) });

    expect(await codeOf(attacker.as.mutation(api.vaultFiles.createNote, { vaultId: own, itemId: login, item: sealed(3) }))).toBe("conflict");
    expect(await codeOf(attacker.as.mutation(api.vaultFiles.createNote, { vaultId: own, itemId: note, item: sealed(3) }))).toBe("conflict");
    expect(await codeOf(attacker.as.mutation(api.vaultItems.importBatch, { vaultId: own, importId: "imp", source: "Other", items: [{ itemId: ulid(), kind: "login", item: sealed(3) }, { itemId: login, kind: "login", item: sealed(3) }] }))).toBe("conflict");
    const twice = ulid();
    expect(await codeOf(attacker.as.mutation(api.vaultItems.importBatch, { vaultId: own, importId: "imp", source: "Other", items: [{ itemId: twice, kind: "login", item: sealed(3) }, { itemId: twice, kind: "login", item: sealed(3) }] }))).toBe("conflict");
    expect(await codeOf(attacker.as.mutation(api.vaultFiles.createFolder, { vaultId: own, folderId: folder, sealedName: blob(40), keyVersion: 1 }))).toBe("conflict");
    expect(await codeOf(attacker.as.mutation(api.vaultShares.share, { vaultId: own, itemId: mine, shareId, profileId: owner.profileId, canEdit: false, wrappedKey: blob(80), epoch: 1 }))).toBe("conflict");
    expect(await codeOf(attacker.as.mutation(api.vaultShares.createLink, { vaultId: own, itemId: mine, linkId, wrappedKey: blob(80), maxViews: 1, expiresInMs: 2 * 3600_000 }))).toBe("conflict");

    // One row each, and everything of the owner's still works.
    const rows = await t.run(async (ctx) => ({
      items: (await ctx.db.query("vaultItems").collect()).filter((i) => i.publicId === login || i.publicId === note || i.publicId === twice).length,
      folders: (await ctx.db.query("vaultFolders").collect()).filter((f) => f.publicId === folder).length,
      shares: (await ctx.db.query("vaultShares").collect()).filter((s) => s.publicId === shareId).length,
      links: (await ctx.db.query("vaultLinks").collect()).filter((l) => l.publicId === linkId).length,
    }));
    expect(rows).toEqual({ items: 2, folders: 1, shares: 1, links: 1 });
    await owner.as.mutation(api.vaultItems.open, { vaultId: id, itemId: login });
    await owner.as.mutation(api.vaultFiles.updateFolder, { vaultId: id, folderId: folder, sealedName: blob(41), keyVersion: 1 });
    await colleague.as.mutation(api.vaultShares.openShared, { shareId });
    expect((await owner.as.query(api.vaultShares.ofItem, { vaultId: id, itemId: note })).links).toHaveLength(1);
    // Sharing again with the same person replaces their share, as before.
    await owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: note, shareId: ulid(), profileId: colleague.profileId, canEdit: false, wrappedKey: blob(80), epoch: 1 });
    expect(await colleague.as.query(api.vaultShares.mine, {})).toHaveLength(1);
  });
});

describe("M6: an export page always leaves a log entry", { timeout: 120_000 }, () => {
  async function vaultWith(t: T, tag: string, n: number) {
    await enableFlag(t, "vault");
    const owner = await person(t, `${tag}-owner@example.com`);
    const custodian = await person(t, `${tag}-custodian@example.com`);
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, custodian, `${tag}-custodian@example.com`, workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    await t.run(async (ctx) => {
      const vault = (await ctx.db
        .query("vaults")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique())!;
      await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: custodian.profileId as Id<"profiles">, role: "custodian", addedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
    });
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const itemId = ulid();
      ids.push(itemId);
      await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId, kind: "login", item: sealed() });
    }
    return { owner, custodian, id, ids: ids.sort() };
  }

  test("passwords: an empty `after` is the first page (logged, custodians told); a made-up one is refused; a later page is logged too", async () => {
    const t = setup();
    const { owner, custodian, id, ids } = await vaultWith(t, "m6a", 3);
    // What skipped the entry before: `after` "" started at the first item without being the null that was logged.
    const page = await custodian.as.mutation(api.vaultItems.exportPage, { vaultId: id, after: "", format: "csv" });
    expect(page.items).toHaveLength(3);
    let exported = await eventsOf(t, id, "items.exported");
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ actorId: custodian.profileId, detail: { format: "csv", count: 3 } });
    const told = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.profileId === (owner.profileId as Id<"profiles">) && n.body === "security:items.exported"));
    expect(told).toHaveLength(1);

    for (const after of ["0", "zzz", " ", "0".repeat(25), `${"0".repeat(25)}a`]) expect(await codeOf(custodian.as.mutation(api.vaultItems.exportPage, { vaultId: id, after, format: "csv" })), after).toBe("invalid_argument");
    // A well-formed id below every item is the first page again: logged.
    expect((await custodian.as.mutation(api.vaultItems.exportPage, { vaultId: id, after: "0".repeat(26), format: "csv" })).items).toHaveLength(3);
    // Starting after the first item still hands out secrets: logged, with where it starts.
    expect((await custodian.as.mutation(api.vaultItems.exportPage, { vaultId: id, after: ids[0]!, format: "csv" })).items).toHaveLength(2);
    exported = await eventsOf(t, id, "items.exported");
    expect(exported).toHaveLength(3);
    expect(exported[2]!.detail).toMatchObject({ format: "csv", count: 3, from: 1, items: 2 });
    // Past the end: nothing handed out, nothing to log.
    expect((await custodian.as.mutation(api.vaultItems.exportPage, { vaultId: id, after: ids[2]!, format: "csv" })).items).toEqual([]);
    expect(await eventsOf(t, id, "items.exported")).toHaveLength(3);
  });

  test("the activity log: a negative or fractional `after` is refused, so the whole log can't be had unlogged", async () => {
    const t = setup();
    const { custodian, id } = await vaultWith(t, "m6b", 1);
    for (const after of [-1, -0.5, 0.5, Number.NaN]) expect(await codeOf(custodian.as.mutation(api.vaultLog.exportPage, { vaultId: id, after, format: "csv" })), String(after)).toBe("invalid_argument");
    expect(await eventsOf(t, id, "log.exported")).toHaveLength(0);
    const page = await custodian.as.mutation(api.vaultLog.exportPage, { vaultId: id, after: 0, format: "csv" });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(await eventsOf(t, id, "log.exported")).toHaveLength(1);
    // Once the oldest entries have expired, a page from below the oldest kept one is a first page as well.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
        .collect();
      for (const r of rows.slice(0, 2)) await ctx.db.delete(r._id);
    });
    const again = await custodian.as.mutation(api.vaultLog.exportPage, { vaultId: id, after: 1, format: "csv" });
    expect(await eventsOf(t, id, "log.exported")).toHaveLength(2);
    // A real continuation isn't a new export.
    await custodian.as.mutation(api.vaultLog.exportPage, { vaultId: id, after: again.entries.at(-1)!.seq, format: "csv" });
    expect(await eventsOf(t, id, "log.exported")).toHaveLength(2);
  });
});

describe("L6: a Vault file's bytes are an upload of its own", { timeout: 120_000 }, () => {
  test("bytes a note's file already points at can't be registered (and so can't be deleted from someone's own Trash)", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const victim = await person(t, "l6-victim@example.com");
    const attacker = await person(t, "l6-attacker@example.com");
    const { id: doc } = await victim.as.mutation(api.documents.create, { scope: victim.scope, title: "With a file" });
    // An attachment of the victim's note (the attacker uploaded it once, so they know its storage id and size).
    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([new Uint8Array(5000).fill(7)]));
      const d = (await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", doc))
        .unique())!;
      await ctx.db.insert("files", { publicId: ulid(), storageId: id, ownerProfileId: d.ownerProfileId, documentId: d._id, uploadedBy: attacker.profileId as Id<"profiles">, filename: "plan.pdf", mimeType: "application/pdf", size: 5000, sha256: "x", kind: "file", status: "ready", createdAt: Date.now() });
      return id;
    });
    const { id: own } = await attacker.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, own, attacker.profileId);
    expect(await codeOf(attacker.as.mutation(api.vaultFiles.saveFile, { vaultId: own, itemId: ulid(), storageId, size: 5000, item: sealed() }))).toBe("not_found");
    // The bytes are still there, and nothing was added to the attacker's Vault.
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId))?.size)).toBe(5000);
    expect((await attacker.as.query(api.vaultItems.list, { vaultId: own, section: "files" })).items).toEqual([]);
    // Their own fresh upload still saves.
    expect(await attacker.as.mutation(api.vaultFiles.saveFile, { vaultId: own, itemId: ulid(), storageId: await store(t, 4000), size: 4000, item: sealed() })).toEqual({ revision: 1 });
  });

  test("bytes uploaded long ago aren't this save's upload", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 26, 9, 0));
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "l6-old@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, id, a.profileId);
    const old = await store(t, 3000);
    vi.setSystemTime(Date.UTC(2026, 10, 26, 12, 0));
    expect(await codeOf(a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: ulid(), storageId: old, size: 3000, item: sealed() }))).toBe("not_found");
    expect(await a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: ulid(), storageId: await store(t, 3000), size: 3000, item: sealed() })).toEqual({ revision: 1 });
  });
});
