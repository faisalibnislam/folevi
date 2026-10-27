// Every other door stays shut (docs/VAULT_PLAN.md §9, V9): deleting a workspace or an account takes its Vault and its
// files' encrypted bytes, while the log stays for its 3 years; and the Vault never shows in a place's notes, search or
// device copy (its content lives in its own tables, which only the Vault's modules read: tests/convex/static).
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enableFlag, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

const blob = (n = 64, fill = 1) => new Uint8Array(n).fill(fill).buffer;
const sealed = (fill = 1) => ({ sealedSummary: blob(64, fill), sealed: blob(96, fill), wrappedKey: blob(60, fill), keyVersion: 1 });

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

const counts = (t: T, vaultId: string) =>
  t.run(async (ctx) => ({
    vaults: (await ctx.db.query("vaults").collect()).filter((v) => v.publicId === vaultId).length,
    items: (await ctx.db.query("vaultItems").collect()).length,
    keys: (await ctx.db.query("vaultKeys").collect()).length,
    blobs: (await ctx.db.system.query("_storage").collect()).length,
    log: (
      await ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vaultId))
        .collect()
    ).length,
  }));

describe("the Vault's other doors", { timeout: 60_000 }, () => {
  test("deleting a workspace takes its Vault and its files' bytes; the log stays", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vd-owner@example.com");
    const { workspaceId, scope } = await teamWorkspace(a);
    const { id } = await a.as.mutation(api.vault.create, { scope });
    await keyed(t, id, a.profileId);
    await a.as.mutation(api.vaultItems.create, { vaultId: id, itemId: ulid(), kind: "login", item: sealed() });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array(4000)])));
    await a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: ulid(), storageId, size: 4000, item: sealed() });
    const before = await counts(t, id);
    expect(before).toMatchObject({ vaults: 1, items: 2, keys: 1, blobs: 1 });

    const now = Date.now();
    await t.run(async (ctx) => {
      const ws = (await ctx.db
        .query("workspaces")
        .withIndex("by_public_id", (q) => q.eq("publicId", workspaceId))
        .unique())!;
      await ctx.db.patch(ws._id, { deletionScheduledFor: now - 1 });
      await ctx.db.insert("deletionJobs", { kind: "workspace", targetId: ws._id, requestedBy: a.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
    });
    for (let i = 0; i < 15; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await counts(t, id)).toEqual({ vaults: 0, items: 0, keys: 0, blobs: 0, log: before.log });
  });

  test("deleting an account takes its Personal Vault and its files' bytes; the log stays", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vd-account@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, id, a.profileId);
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array(3000)])));
    await a.as.mutation(api.vaultFiles.saveFile, { vaultId: id, itemId: ulid(), storageId, size: 3000, item: sealed() });
    const before = await counts(t, id);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.patch(a.profileId as Id<"profiles">, { status: "pending_deletion" });
      await ctx.db.insert("deletionJobs", { kind: "account", targetId: a.profileId, requestedBy: a.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
    });
    for (let i = 0; i < 25; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await counts(t, id)).toEqual({ vaults: 0, items: 0, keys: 0, blobs: 0, log: before.log });
  });

  test("vault items never show among a place's notes", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vd-lists@example.com");
    const notesBefore = (await a.as.query(api.documents.list, { scope: PERSONAL, view: "all", paginationOpts: { numItems: 100, cursor: null } })).page.length;
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await keyed(t, id, a.profileId);
    await a.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: ulid(), item: sealed() });
    await a.as.mutation(api.vaultItems.create, { vaultId: id, itemId: ulid(), kind: "login", item: sealed() });
    expect((await a.as.query(api.documents.list, { scope: PERSONAL, view: "all", paginationOpts: { numItems: 100, cursor: null } })).page.length).toBe(notesBefore);
  });
});
