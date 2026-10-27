// The Vault (docs/VAULT_PLAN.md): who can see and make one, who gets into a team Vault, and its log's chain.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { entryHash, genesisHash } from "../../convex/lib/vault/log";
import { join, person, PERSONAL, setup, teamWorkspace, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

/** Adds someone to a team Vault directly (people management comes with vaultPeople.ts). */
async function addToVault(t: T, vaultPublicId: string, who: Person, role: "custodian" | "member", by: Person) {
  await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", vaultPublicId))
      .unique())!;
    await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: who.profileId as Id<"profiles">, role, addedBy: by.profileId as Id<"profiles">, createdAt: Date.now() });
  });
}

const logOf = (t: T, vaultPublicId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("vaultLog")
      .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vaultPublicId))
      .collect(),
  );

describe("the Vault", { timeout: 30_000 }, () => {
  test("a Personal Vault: its owner makes it once, nobody else sees it", async () => {
    const t = setup();
    const a = await person(t, "vault-a@example.com");
    const b = await person(t, "vault-b@example.com");
    expect(await a.as.query(api.vault.get, { scope: PERSONAL })).toEqual({ exists: false, personal: true, role: "owner" });
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL, client: { deviceLabel: "Chrome on macOS", timeZone: "Europe/London" } });
    expect(await a.as.mutation(api.vault.create, { scope: PERSONAL })).toEqual({ id });
    expect(await a.as.query(api.vault.get, { scope: PERSONAL })).toMatchObject({ exists: true, id, personal: true, role: "owner", keyVersion: 0, hasAccessKey: false, autoLockMinutes: 5 });
    // Someone else's Personal is theirs: b sees their own (not yet made), never a's.
    expect(await b.as.query(api.vault.get, { scope: PERSONAL })).toEqual({ exists: false, personal: true, role: "owner" });
    expect(await codeOf(b.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 10 }))).toBe("not_found");
  });

  test("a team Vault: only its owner makes it; admins and members aren't in until added; leaving the workspace ends it", async () => {
    const t = setup();
    const owner = await person(t, "vault-owner@example.com");
    const admin = await person(t, "vault-admin@example.com");
    const member = await person(t, "vault-member@example.com");
    const custodian = await person(t, "vault-custodian@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, admin, "vault-admin@example.com", workspaceId, "admin");
    await join(t, owner, member, "vault-member@example.com", workspaceId, "editor");
    await join(t, owner, custodian, "vault-custodian@example.com", workspaceId, "editor");

    // Before it's made: only the owner sees it (to make it).
    expect(await admin.as.query(api.vault.get, { scope })).toBeNull();
    expect(await codeOf(admin.as.mutation(api.vault.create, { scope }))).toBe("forbidden");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    expect(await owner.as.query(api.vault.get, { scope })).toMatchObject({ exists: true, role: "owner", personal: false });

    // An admin and a member: nothing, not even that it exists.
    expect(await admin.as.query(api.vault.get, { scope })).toBeNull();
    expect(await member.as.query(api.vault.get, { scope })).toBeNull();
    expect(await codeOf(admin.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 10 }))).toBe("not_found");

    // Added: a custodian and a member, each with their role.
    await addToVault(t, id, custodian, "custodian", owner);
    await addToVault(t, id, member, "member", owner);
    expect(await custodian.as.query(api.vault.get, { scope })).toMatchObject({ role: "custodian" });
    expect(await member.as.query(api.vault.get, { scope })).toMatchObject({ role: "member" });

    // Settings: custodians set auto-lock (1 to 30), only the owner chooses who names custodians, members neither.
    await custodian.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 15 });
    expect(await codeOf(custodian.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 45 }))).toBe("invalid_argument");
    expect(await codeOf(custodian.as.mutation(api.vault.updateSettings, { vaultId: id, custodiansNameCustodians: true }))).toBe("forbidden");
    expect(await codeOf(member.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 10 }))).toBe("forbidden");
    await owner.as.mutation(api.vault.updateSettings, { vaultId: id, custodiansNameCustodians: true });
    expect(await owner.as.query(api.vault.get, { scope })).toMatchObject({ autoLockMinutes: 15, custodiansNameCustodians: true });

    // Removed from the workspace: out of the Vault at once.
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect(await codeOf(member.as.query(api.vault.get, { scope }))).toBe("not_found");
  });

  test("the log: every entry chains to the one before it, and changing one breaks the chain", async () => {
    const t = setup();
    const a = await person(t, "vault-log@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL, client: { deviceId: "dev-1", deviceLabel: "Safari on macOS", timeZone: "Asia/Dhaka", sessionId: "s1" } });
    await a.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 10 });
    await a.as.mutation(api.vault.updateSettings, { vaultId: id, autoLockMinutes: 3 });
    const log = await logOf(t, id);
    expect(log.map((e) => [e.seq, e.event])).toEqual([
      [1, "vault.created"],
      [2, "vault.settings"],
      [3, "vault.settings"],
    ]);
    expect(log[0]).toMatchObject({ actorName: expect.any(String), actorEmail: "vault-log@example.com", actorRole: "owner", outcome: "ok", source: "server", timeZone: "Asia/Dhaka", device: { id: "dev-1", label: "Safari on macOS" }, sessionId: "s1" });
    expect(log[1]!.detail).toEqual({ before: { autoLockMinutes: 5 }, after: { autoLockMinutes: 10 } });
    // Kept 3 years.
    expect(log[0]!.expiresAt - log[0]!.at).toBeGreaterThan(3 * 365 * 24 * 3600 * 1000);
    // The chain: genesis, then each entry's hash is the next one's prevHash, and recomputes.
    expect(log[0]!.prevHash).toBe(await genesisHash(id));
    for (let i = 0; i < log.length; i++) {
      const { _id, _creationTime, hash, ...rest } = log[i]!;
      void _id;
      void _creationTime;
      expect(await entryHash(rest)).toBe(hash);
      if (i > 0) expect(log[i]!.prevHash).toBe(log[i - 1]!.hash);
    }
    // Tampering with an entry's detail no longer matches its hash.
    const { _id, _creationTime, hash, ...first } = log[1]!;
    void _id;
    void _creationTime;
    expect(await entryHash({ ...first, detail: { before: { autoLockMinutes: 5 }, after: { autoLockMinutes: 30 } } })).not.toBe(hash);
  });
});
