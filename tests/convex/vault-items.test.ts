// The Vault's password items on the server (convex/vaultItems.ts): lists carry summaries only and opening an item is
// logged by the server; members change only what they added, custodians anything; edits never overwrite each other,
// keep the version before; Trash, imports, export (custodians), reuse counts. Sealed bytes are stand-ins here (the
// server never opens them; the device's sealing is tested in apps/web/test/vault-items.test.ts).
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enableFlag, join, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

const blob = (n = 64, fill = 1) => new Uint8Array(n).fill(fill).buffer;
const sealed = (fill = 1, mac?: string) => ({ sealedSummary: blob(64, fill), sealed: blob(96, fill), wrappedKey: blob(60, fill), keyVersion: 1, ...(mac ? { passwordMac: mac } : {}) });

/** A team Vault with its first key in place (vaultKeys.setUp's rows, without the crypto). */
async function teamVault(t: T) {
  await enableFlag(t, "vault");
  const owner = await person(t, "vi-owner@example.com");
  const custodian = await person(t, "vi-custodian@example.com");
  const member = await person(t, "vi-member@example.com");
  const { workspaceId, scope } = await teamWorkspace(owner);
  await join(t, owner, custodian, "vi-custodian@example.com", workspaceId, "editor");
  await join(t, owner, member, "vi-member@example.com", workspaceId, "editor");
  const { id } = await owner.as.mutation(api.vault.create, { scope });
  await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", id))
      .unique())!;
    await ctx.db.patch(vault._id, { keyVersion: 1 });
    await ctx.db.insert("vaultKeys", { vaultId: vault._id, workspaceId: vault.workspaceId!, version: 1, check: blob(16), createdBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
    for (const [who, role] of [
      [custodian, "custodian"],
      [member, "member"],
    ] as const)
      await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: who.profileId as Id<"profiles">, role, addedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
  });
  return { owner, custodian, member, id };
}

const events = (t: T, vaultId: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vaultId))
        .collect()
    ).map((e) => e.event),
  );

describe("vault items", { timeout: 60_000 }, () => {
  test("lists carry summaries, opening is logged; members change only their own items, custodians any", async () => {
    const t = setup();
    const { owner, custodian, member, id } = await teamVault(t);
    const mine = ulid();
    const theirs = ulid();
    await member.as.mutation(api.vaultItems.create, { vaultId: id, itemId: mine, kind: "login", item: sealed(1) });
    await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId: theirs, kind: "apiKey", item: sealed(2) });
    expect(await codeOf(member.as.mutation(api.vaultItems.create, { vaultId: id, itemId: ulid(), kind: "note", item: sealed() }))).toBe("invalid_argument");
    expect(await codeOf(member.as.mutation(api.vaultItems.create, { vaultId: id, itemId: ulid(), kind: "login", item: { ...sealed(), keyVersion: 2 } }))).toBe("conflict");

    const list = await member.as.query(api.vaultItems.list, { vaultId: id, section: "passwords" });
    expect(list.items.map((i) => i.id).sort()).toEqual([mine, theirs].sort());
    expect(list.items[0]).not.toHaveProperty("sealed");
    const opened = await member.as.mutation(api.vaultItems.open, { vaultId: id, itemId: theirs });
    expect(opened.sealed.byteLength).toBe(96);
    expect(opened.canChange).toBe(false);

    expect(await codeOf(member.as.mutation(api.vaultItems.update, { vaultId: id, itemId: theirs, baseRevision: 1, item: sealed(3), changed: ["key"] }))).toBe("forbidden");
    expect(await codeOf(member.as.mutation(api.vaultItems.remove, { vaultId: id, itemId: theirs }))).toBe("forbidden");
    expect(await member.as.mutation(api.vaultItems.update, { vaultId: id, itemId: mine, baseRevision: 1, item: sealed(4), changed: ["password", "website"] })).toEqual({ revision: 2 });
    // A custodian changes anyone's; an edit based on an old revision is refused.
    expect(await custodian.as.mutation(api.vaultItems.update, { vaultId: id, itemId: mine, baseRevision: 2, item: sealed(5), changed: ["username"] })).toEqual({ revision: 3 });
    expect(await codeOf(member.as.mutation(api.vaultItems.update, { vaultId: id, itemId: mine, baseRevision: 2, item: sealed(6), changed: ["password"] }))).toBe("conflict");
    // Field names only (never values) and nothing odd in them.
    expect(await codeOf(member.as.mutation(api.vaultItems.update, { vaultId: id, itemId: mine, baseRevision: 3, item: sealed(6), changed: ["<script>"] }))).toBe("invalid_argument");

    // History: the versions before, and seeing them is logged; bringing one back is a new change.
    const history = await member.as.mutation(api.vaultItems.history, { vaultId: id, itemId: mine });
    expect(history.map((h) => h.revision)).toEqual([2, 1]);
    await member.as.mutation(api.vaultItems.restoreVersion, { vaultId: id, itemId: mine, revision: 1 });
    const back = await member.as.mutation(api.vaultItems.open, { vaultId: id, itemId: mine });
    expect(back.revision).toBe(4);
    expect(new Uint8Array(back.sealed)[0]).toBe(1);

    // Trash: gone from the list, in Trash, back again.
    await member.as.mutation(api.vaultItems.remove, { vaultId: id, itemId: mine });
    expect((await member.as.query(api.vaultItems.list, { vaultId: id, section: "passwords" })).items.map((i) => i.id)).toEqual([theirs]);
    expect((await member.as.query(api.vaultItems.list, { vaultId: id, section: "trash" })).items.map((i) => i.id)).toEqual([mine]);
    expect(await codeOf(member.as.mutation(api.vaultItems.update, { vaultId: id, itemId: mine, baseRevision: 4, item: sealed(7), changed: ["title"] }))).toBe("conflict");
    await member.as.mutation(api.vaultItems.restore, { vaultId: id, itemId: mine });

    const log = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
          .collect()
      ).filter((e) => e.event === "item.edited"),
    );
    expect(log.map((e) => e.detail)).toEqual([
      { fields: ["password", "website"], revision: 2 },
      { fields: ["username"], revision: 3 },
    ]);
    expect(await events(t, id)).toEqual(expect.arrayContaining(["item.created", "item.open", "history.view", "item.versionRestored", "item.deleted", "item.restored"]));
  });

  test("imports in batches, one log entry each; export is for custodians; reuse is counted by blind index", async () => {
    const t = setup();
    const { owner, member, id } = await teamVault(t);
    const mac = "A".repeat(22);
    await member.as.mutation(api.vaultItems.importBatch, { vaultId: id, importId: "imp-1", source: "Bitwarden", items: [{ itemId: ulid(), kind: "login", item: sealed(1, mac) }, { itemId: ulid(), kind: "login", item: sealed(2, mac) }, { itemId: ulid(), kind: "secureNote", item: sealed(3) }] });
    expect(await codeOf(member.as.mutation(api.vaultItems.importBatch, { vaultId: id, importId: "imp-2", source: "Bitwarden", items: [{ itemId: ulid(), kind: "file", item: sealed() }] }))).toBe("invalid_argument");
    expect(await member.as.query(api.vaultItems.reuse, { vaultId: id })).toEqual({ [mac]: 2 });

    expect(await codeOf(member.as.mutation(api.vaultItems.exportPage, { vaultId: id, after: null, format: "csv" }))).toBe("forbidden");
    const page = await owner.as.mutation(api.vaultItems.exportPage, { vaultId: id, after: null, format: "encrypted" });
    expect(page.items).toHaveLength(3);
    expect(page.items[0]!.sealed.byteLength).toBe(96);
    const log = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
          .collect()
      ).filter((e) => e.event.startsWith("items.")),
    );
    expect(log.map((e) => [e.event, e.detail])).toEqual([
      ["items.imported", { importId: "imp-1", source: "Bitwarden", count: 3 }],
      ["items.exported", { format: "encrypted", count: 3 }],
    ]);
  });

  test("someone outside the Vault sees and opens nothing", async () => {
    const t = setup();
    const { owner, id } = await teamVault(t);
    const item = ulid();
    await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId: item, kind: "login", item: sealed() });
    const stranger = await person(t, "vi-stranger@example.com");
    expect(await codeOf(stranger.as.query(api.vaultItems.list, { vaultId: id, section: "passwords" }))).toBe("not_found");
    expect(await codeOf(stranger.as.mutation(api.vaultItems.open, { vaultId: id, itemId: item }))).toBe("not_found");
    // Another Vault's id with this item's id: not found either.
    const { id: personal } = await stranger.as.mutation(api.vault.create, { scope: PERSONAL });
    expect(await codeOf(stranger.as.mutation(api.vaultItems.open, { vaultId: personal, itemId: item }))).toBe("not_found");
  });
});
