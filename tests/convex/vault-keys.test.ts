// The Vault's keys with real cryptography (docs/VAULT_PLAN.md §3): the owner sets it up, opens it with their
// passcode or their recovery key, wrong passcodes lock them out for a while, a custodian's device shares the key
// with someone added, who adds their own passcode, and a forgotten passcode is reset through a custodian.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enableFlag, e2eeLib, e2eePerson, join, PERSONAL, setup, teamWorkspace, wire, type E2eePerson, type T } from "./helpers";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

const bytes = (b: ArrayBuffer) => new Uint8Array(b);

/** What the owner's device does on first open: a vault key, a passcode grant and a recovery grant. */
async function setUpVault(p: E2eePerson, vaultId: string, passcode: string) {
  const e2ee = await e2eeLib();
  const vk = e2ee.newVaultKey();
  const keys = await e2ee.deriveVaultKeys(vk);
  const g = { vaultId, keyVersion: 1, profileId: p.profileId };
  const inner = await e2ee.sealVaultKeyTo(vk, p.account.x25519.publicKey, g);
  const salt = e2ee.randomBytes(16);
  const kdf = { m: 65536, t: 3, p: 1 };
  const passcodeKey = await e2ee.vaultPasscodeKey(passcode, { name: "argon2id", ...kdf, salt });
  const recovery = e2ee.newRecoveryKey();
  const recoveryKey = await e2ee.vaultRecoveryKey(recovery.bytes);
  await p.as.mutation(api.vaultKeys.setUp, {
    vaultId,
    check: wire(keys.check),
    passcode: { version: 1, epoch: p.epoch, wrapped: wire(await e2ee.wrapWithPasscode(inner, passcodeKey, g)), salt: wire(salt), kdf },
    recovery: { version: 1, epoch: p.epoch, wrapped: wire(await e2ee.wrapWithRecovery(inner, recoveryKey, g)) },
  });
  return { vk, recovery };
}

/** What a device does to unlock: fetch the grant, open it with the passcode (or recovery key), report how it went. */
async function unlockWith(p: E2eePerson, vaultId: string, secret: { passcode: string } | { recovery: Uint8Array }) {
  const e2ee = await e2eeLib();
  const way = "passcode" in secret ? "passcode" : "recovery";
  const r = await p.as.mutation(api.vaultKeys.unlock, { vaultId, way });
  if (r.locked) return r.lockedUntil;
  const grant = r.grants.find((g) => g.version === r.keyVersion)!;
  const check = bytes(r.keys.find((k) => k.version === r.keyVersion)!.check);
  const g = { vaultId, keyVersion: grant.version, profileId: p.profileId };
  try {
    const key =
      "passcode" in secret
        ? await e2ee.vaultPasscodeKey(secret.passcode, { name: "argon2id", ...grant.kdf!, salt: bytes(grant.salt!) })
        : await e2ee.vaultRecoveryKey(secret.recovery);
    const vk = await e2ee.openVaultGrant(bytes(grant.wrapped), { kind: way, key }, p.account.x25519, g, check);
    await p.as.mutation(api.vaultKeys.unlockResult, { vaultId, ok: true, way });
    return vk;
  } catch {
    return (await p.as.mutation(api.vaultKeys.unlockResult, { vaultId, ok: false, way })).lockedUntil ?? false;
  }
}

const logEvents = (t: T, vaultId: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vaultId))
        .collect()
    ).map((e) => `${e.event}${e.outcome === "failed" ? `:failed:${e.reason}` : ""}`),
  );

describe("Vault keys", { timeout: 120_000 }, () => {
  test("a Personal Vault: set up, unlock with the passcode or the recovery key, nothing else opens it", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const e2ee = await e2eeLib();
    const a = await e2eePerson(t, "vk-a@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    const { vk, recovery } = await setUpVault(a, id, "correct horse battery");
    expect(await a.as.query(api.vault.get, { scope: PERSONAL })).toMatchObject({ keyVersion: 1, hasAccessKey: true, hasRecovery: true });
    expect(await codeOf(setUpVault(a, id, "again and again"))).toBe("conflict");

    const opened = await unlockWith(a, id, { passcode: "correct horse battery" });
    expect(e2ee.constantTimeEqual(opened as Uint8Array, vk)).toBe(true);
    expect(await unlockWith(a, id, { passcode: "wrong horse battery" })).toBe(false);
    const viaRecovery = await unlockWith(a, id, { recovery: recovery.bytes });
    expect(e2ee.constantTimeEqual(viaRecovery as Uint8Array, vk)).toBe(true);
    // Someone else's account key can't open the inner layer even with the right passcode.
    const b = await e2eePerson(t, "vk-b@example.com");
    expect(await codeOf(b.as.mutation(api.vaultKeys.unlock, { vaultId: id, way: "passcode" }))).toBe("not_found");

    expect(await logEvents(t, id)).toEqual([
      "vault.created",
      "key.created",
      "passcode.set",
      "recovery.set",
      "vault.unlockAttempt",
      "vault.unlock",
      "vault.unlockAttempt",
      "vault.unlock:failed:wrong_passcode",
      "vault.unlockAttempt",
      "vault.unlock",
    ]);
  });

  test("wrong passcodes: five in a row lock the person out, and the attempts while locked are logged", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const a = await e2eePerson(t, "vk-lock@example.com");
    const { id } = await a.as.mutation(api.vault.create, { scope: PERSONAL });
    await setUpVault(a, id, "the right passcode");
    for (let i = 0; i < 4; i++) expect(await a.as.mutation(api.vaultKeys.unlockResult, { vaultId: id, ok: false, way: "passcode" })).toEqual({ lockedUntil: null });
    const { lockedUntil } = await a.as.mutation(api.vaultKeys.unlockResult, { vaultId: id, ok: false, way: "passcode" });
    expect(lockedUntil! - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await a.as.mutation(api.vaultKeys.unlock, { vaultId: id, way: "passcode" })).toEqual({ locked: true, lockedUntil });
    expect((await logEvents(t, id)).at(-1)).toBe("vault.unlock:failed:locked_out");
  });

  test("a team Vault: a custodian's device shares the key, the member adds their passcode; a reset goes through a custodian", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const e2ee = await e2eeLib();
    const owner = await e2eePerson(t, "vk-owner@example.com");
    const member = await e2eePerson(t, "vk-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "vk-member@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    const { vk } = await setUpVault(owner, id, "owner passcode here");

    // Added (vaultPeople comes later): a member row and a pending grant.
    await t.run(async (ctx) => {
      const vault = (await ctx.db
        .query("vaults")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique())!;
      await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: member.profileId as Id<"profiles">, role: "member", addedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
      await ctx.db.insert("vaultPendingGrants", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: member.profileId as Id<"profiles">, reason: "added", createdAt: Date.now() });
    });
    expect(await member.as.query(api.vault.get, { scope })).toMatchObject({ role: "member", waitingForKey: true, hasAccessKey: false });
    // Only custodians see who's waiting.
    expect(await codeOf(member.as.query(api.vaultKeys.pending, { vaultId: id }))).toBe("forbidden");

    // The owner's device seals the key to the member's account key.
    const waiting = await owner.as.query(api.vaultKeys.pending, { vaultId: id });
    expect(waiting.people).toHaveLength(1);
    const target = waiting.people[0]!;
    const g = { vaultId: id, keyVersion: 1, profileId: member.profileId };
    const inner = await e2ee.sealVaultKeyTo(vk, bytes(target.account!.x25519Pub), g);
    await owner.as.mutation(api.vaultKeys.grant, { vaultId: id, profileId: target.profileId, grants: [{ version: 1, epoch: target.account!.epoch, wrapped: wire(inner) }] });
    expect(await member.as.query(api.vault.get, { scope })).toMatchObject({ needsPasscode: true, waitingForKey: false });

    // The member opens the custodian's grant with their account key and adds their passcode.
    const r = await member.as.mutation(api.vaultKeys.unlock, { vaultId: id, way: "passcode" });
    if (r.locked) throw new Error("locked");
    const check = bytes(r.keys[0]!.check);
    const opened = await e2ee.openVaultGrant(bytes(r.fromCustodian[0]!.wrapped), { kind: "custodian" }, member.account.x25519, g, check);
    expect(e2ee.constantTimeEqual(opened, vk)).toBe(true);
    const salt = e2ee.randomBytes(16);
    const kdf = { m: 65536, t: 3, p: 1 };
    const passcodeKey = await e2ee.vaultPasscodeKey("member passcode 1", { name: "argon2id", ...kdf, salt });
    await member.as.mutation(api.vaultKeys.setPasscode, { vaultId: id, reason: "first", grants: [{ version: 1, epoch: member.epoch, wrapped: wire(await e2ee.wrapWithPasscode(inner, passcodeKey, g)), salt: wire(salt), kdf }] });
    expect(await member.as.query(api.vault.get, { scope })).toMatchObject({ hasAccessKey: true, needsPasscode: false });
    expect(e2ee.constantTimeEqual((await unlockWith(member, id, { passcode: "member passcode 1" })) as Uint8Array, vk)).toBe(true);
    // Too-cheap passcode settings are refused (nobody can weaken a passcode layer).
    expect(await codeOf(member.as.mutation(api.vaultKeys.setPasscode, { vaultId: id, reason: "changed", grants: [{ version: 1, epoch: member.epoch, wrapped: wire(inner), salt: wire(salt), kdf: { m: 1024, t: 3, p: 1 } }] }))).toBe("invalid_argument");

    // Forgot the passcode and has no recovery key: ask a custodian; their grants go, they wait again.
    await member.as.mutation(api.vaultKeys.requestReset, { vaultId: id });
    expect(await member.as.query(api.vault.get, { scope })).toMatchObject({ hasAccessKey: false, waitingForKey: true });
    expect((await owner.as.query(api.vaultKeys.pending, { vaultId: id })).people[0]).toMatchObject({ reason: "reset" });
    // A Personal Vault has no custodian to ask.
    const { id: personal } = await owner.as.mutation(api.vault.create, { scope: PERSONAL });
    expect(await codeOf(owner.as.mutation(api.vaultKeys.requestReset, { vaultId: personal }))).toBe("forbidden");

    expect(await logEvents(t, id)).toEqual(expect.arrayContaining(["access.granted", "passcode.set", "access.resetRequested"]));
  });
});
