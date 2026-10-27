// The Vault's notifications (lib/vault/notify.ts): who and what kind only, never an item's name; everyone with access
// but whoever did it; bursts folded; the Vault setting; security notices to the owner and custodians only.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enableFlag, join, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const blob = (n = 64, fill = 1) => new Uint8Array(n).fill(fill).buffer;
const sealed = (fill = 1) => ({ sealedSummary: blob(64, fill), sealed: blob(96, fill), wrappedKey: blob(60, fill), keyVersion: 1 });

async function team(t: T) {
  await enableFlag(t, "vault");
  const owner = await person(t, "vn-owner@example.com");
  const custodian = await person(t, "vn-custodian@example.com");
  const member = await person(t, "vn-member@example.com");
  const { workspaceId, scope } = await teamWorkspace(owner);
  await join(t, owner, custodian, "vn-custodian@example.com", workspaceId, "editor");
  await join(t, owner, member, "vn-member@example.com", workspaceId, "editor");
  const { id } = await owner.as.mutation(api.vault.create, { scope });
  await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", id))
      .unique())!;
    await ctx.db.patch(vault._id, { keyVersion: 1 });
    await ctx.db.insert("vaultKeys", { vaultId: vault._id, workspaceId: vault.workspaceId!, version: 1, check: blob(16), createdBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
    for (const [p, role] of [
      [custodian, "custodian"],
      [member, "member"],
    ] as const)
      await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: p.profileId as Id<"profiles">, role, addedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
  });
  return { owner, custodian, member, id };
}

const bell = async (p: Person) => (await p.as.query(api.notifications.list, { limit: 50 })).filter((n) => n.kind === "vault").map((n) => n.title);

describe("Vault notifications", { timeout: 60_000 }, () => {
  test("everyone but whoever did it hears what kind of change, never an item's name; bursts fold", async () => {
    const t = setup();
    const { owner, custodian, member, id } = await team(t);
    await member.as.mutation(api.vaultItems.create, { vaultId: id, itemId: ulid(), kind: "login", item: sealed() });
    await member.as.mutation(api.vaultItems.create, { vaultId: id, itemId: ulid(), kind: "login", item: sealed() });
    await member.as.mutation(api.vaultItems.importBatch, { vaultId: id, importId: "i", source: "Chrome", items: [1, 2, 3].map(() => ({ itemId: ulid(), kind: "login" as const, item: sealed() })) });
    await member.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: ulid(), item: sealed() });
    expect(await bell(owner)).toEqual(["vn-member added a note to the Vault", "vn-member added 5 passwords to the Vault"]);
    expect(await bell(custodian)).toEqual(await bell(owner));
    expect(await bell(member)).toEqual([]);
    const row = (await owner.as.query(api.notifications.list, { limit: 50 })).find((n) => n.kind === "vault")!;
    expect(row).toMatchObject({ toVault: true, documentId: null });

    // Turning Vault notices off in the bell.
    await t.run(async (ctx) => {
      const p = (await ctx.db.get(custodian.profileId as Id<"profiles">))!;
      await ctx.db.patch(p._id, { notificationPrefs: { ...p.notificationPrefs, inApp: { comments: true, replies: true, mentions: true, shares: true, access: true, vault: false } } });
    });
    await owner.as.mutation(api.vaultPeople.remove, { vaultId: id, profileId: member.profileId });
    expect(await bell(custodian)).toEqual(["vn-member added a note to the Vault", "vn-member added 5 passwords to the Vault"]);
    expect((await bell(member)).length).toBe(0);
  });

  test("security notices go to the owner and custodians, whatever their settings", async () => {
    const t = setup();
    const { owner, custodian, member, id } = await team(t);
    await custodian.as.mutation(api.vaultLog.exportPage, { vaultId: id, after: 0, format: "csv" });
    for (let i = 0; i < 10; i++) await member.as.mutation(api.vaultKeys.unlockResult, { vaultId: id, ok: false, way: "passcode" });
    expect(await bell(owner)).toEqual(["vn-member entered a wrong Vault passcode 10 times in a row", "vn-custodian exported the Vault's activity log"]);
    expect(await bell(custodian)).toEqual(["vn-member entered a wrong Vault passcode 10 times in a row"]);
    expect(await bell(member)).toEqual([]);
  });
});
