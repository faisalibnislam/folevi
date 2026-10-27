// Reading and checking the Vault's log (docs/VAULT_PLAN.md §7): who reads what, device-reported events, export,
// the integrity check catching a changed or missing entry, daily anchors, and the 3-year expiry.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enableFlag, join, person, PERSONAL, setup, teamWorkspace, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

async function addToVault(t: T, vaultId: string, who: Person, role: "custodian" | "member", by: Person) {
  await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", vaultId))
      .unique())!;
    await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: who.profileId as Id<"profiles">, role, addedBy: by.profileId as Id<"profiles">, createdAt: Date.now() });
  });
}

/** A password item row to point device events at (items come with vaultItems.ts). */
async function anItem(t: T, vaultId: string, by: Person) {
  return await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", vaultId))
      .unique())!;
    const now = Date.now();
    const scope = vault.workspaceId ? { workspaceId: vault.workspaceId } : { ownerProfileId: vault.ownerProfileId! };
    await ctx.db.insert("vaultItems", { publicId: "item-1", vaultId: vault._id, ...scope, kind: "login", sealedSummary: new ArrayBuffer(40), sealed: new ArrayBuffer(40), wrappedKey: new ArrayBuffer(40), keyVersion: 1, revision: 1, createdBy: by.profileId as Id<"profiles">, updatedBy: by.profileId as Id<"profiles">, createdAt: now, updatedAt: now });
    return "item-1";
  });
}

describe("the Vault's log", { timeout: 60_000 }, () => {
  test("custodians read everything with filters, members only their own; device events are a fixed list", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await person(t, "vl-owner@example.com");
    const member = await person(t, "vl-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "vl-member@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await addToVault(t, id, member, "member", owner);
    const item = await anItem(t, id, owner);

    await member.as.mutation(api.vaultLog.record, { vaultId: id, event: "item.reveal", itemId: item, detail: { field: "password" } });
    await member.as.mutation(api.vaultLog.record, { vaultId: id, event: "item.copy", itemId: item, detail: { field: "username" } });
    await owner.as.mutation(api.vaultLog.record, { vaultId: id, event: "vault.open" });
    expect(await codeOf(member.as.mutation(api.vaultLog.record, { vaultId: id, event: "anything.else" }))).toBe("invalid_argument");
    expect(await codeOf(member.as.mutation(api.vaultLog.record, { vaultId: id, event: "item.copy" }))).toBe("invalid_argument");
    expect(await codeOf(member.as.mutation(api.vaultLog.record, { vaultId: id, event: "item.copy", itemId: "not-an-item" }))).toBe("not_found");

    const everything = await owner.as.query(api.vaultLog.list, { vaultId: id });
    expect(everything.everything).toBe(true);
    expect(everything.entries.map((e) => e.event)).toEqual(["vault.open", "item.copy", "item.reveal", "vault.created"]);
    const reveal = everything.entries.find((e) => e.event === "item.reveal")!;
    expect(reveal).toMatchObject({ actorEmail: "vl-member@example.com", actorRole: "member", itemId: item, itemKind: "login", source: "device", detail: { field: "password" } });
    // The browser as the sign-in session recorded it.
    expect(reveal.device?.label).toContain("Chrome");

    expect((await owner.as.query(api.vaultLog.list, { vaultId: id, event: "item." })).entries).toHaveLength(2);
    expect((await owner.as.query(api.vaultLog.list, { vaultId: id, personId: member.profileId })).entries).toHaveLength(2);
    expect((await owner.as.query(api.vaultLog.list, { vaultId: id, itemId: item })).entries).toHaveLength(2);

    // A member reads only their own, whatever they ask for.
    const own = await member.as.query(api.vaultLog.list, { vaultId: id, personId: owner.profileId });
    expect(own.everything).toBe(false);
    expect(own.entries.map((e) => e.event)).toEqual(["item.copy", "item.reveal"]);

    // Export: custodians only, logged, signed.
    expect(await codeOf(member.as.mutation(api.vaultLog.exportPage, { vaultId: id, after: 0, format: "csv" }))).toBe("forbidden");
    const page = await owner.as.mutation(api.vaultLog.exportPage, { vaultId: id, after: 0, format: "json" });
    expect(page.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(page.signature).toMatch(/^[0-9a-f]{32}$/);
    expect((await owner.as.query(api.vaultLog.list, { vaultId: id })).entries[0]).toMatchObject({ event: "log.exported", detail: { format: "json", upToSeq: 4 } });
  });

  test("the integrity check passes, then catches a changed entry and a missing one", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vl-verify@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    for (const m of [3, 10, 20]) await a.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: m });
    await t.mutation(internal.vaultLog.anchor, {});
    expect(await a.as.query(api.vaultLog.verify, { vaultId: id })).toMatchObject({ ok: true, checked: 4 });

    const rowOf = (seq: number) =>
      t.run(
        async (ctx) =>
          (await ctx.db
            .query("vaultLog")
            .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id).eq("seq", seq))
            .unique())!,
      );
    // Someone with database access edits an entry: its hash no longer recomputes.
    const second = await rowOf(2);
    await t.run(async (ctx) => ctx.db.patch(second._id, { detail: { before: { autoLockMinutes: 5 }, after: { autoLockMinutes: 30 } } }));
    expect(await a.as.query(api.vaultLog.verify, { vaultId: id })).toMatchObject({ ok: false, brokenAt: 2, why: "changed" });
    await t.run(async (ctx) => ctx.db.patch(second._id, { detail: second.detail }));
    expect(await a.as.query(api.vaultLog.verify, { vaultId: id })).toMatchObject({ ok: true });
    // …or removes one: the chain has a gap.
    const third = await rowOf(3);
    await t.run(async (ctx) => ctx.db.delete(third._id));
    expect(await a.as.query(api.vaultLog.verify, { vaultId: id })).toMatchObject({ ok: false, brokenAt: 4, why: "gap" });
  });

  test("expiry removes only entries past 3 years; anchors are written once per change", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await person(t, "vl-expire@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await a.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 9 });
    await t.mutation(internal.vaultLog.anchor, {});
    await t.mutation(internal.vaultLog.anchor, {});
    const anchors = await t.run(async (ctx) =>
      ctx.db
        .query("vaultLogAnchors")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
        .collect(),
    );
    expect(anchors.map((x) => x.seq)).toEqual([2]);
    // Age the first entry past its 3 years.
    await t.run(async (ctx) => {
      const first = (await ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id).eq("seq", 1))
        .unique())!;
      await ctx.db.patch(first._id, { expiresAt: Date.now() - 1 });
    });
    expect(await t.mutation(internal.vaultLog.expire, {})).toEqual({ removed: 1, more: false });
    const left = await t.run(async (ctx) =>
      ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
        .collect(),
    );
    expect(left.map((e) => e.seq)).toEqual([2]);
    // The chain still checks from the oldest kept entry.
    expect(await a.as.query(api.vaultLog.verify, { vaultId: id })).toMatchObject({ ok: true, oldest: 2 });
  });
});
