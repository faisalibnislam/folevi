// People in a team Vault (convex/vaultPeople.ts) with real keys: who may add whom, the owner's custodian rule, admins
// not in by default, removal and leaving the workspace, and the new key version everyone left gets.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { e2eeLib, e2eePerson, enableFlag, join, setup, teamWorkspace, wire, type E2eePerson, type T } from "./helpers";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

const bytes = (b: ArrayBuffer) => new Uint8Array(b);
const KDF = { m: 65536, t: 3, p: 1 };

async function setUpVault(p: E2eePerson, vaultId: string) {
  const e2ee = await e2eeLib();
  const vk = e2ee.newVaultKey();
  const keys = await e2ee.deriveVaultKeys(vk);
  const g = { vaultId, keyVersion: 1, profileId: p.profileId };
  const inner = await e2ee.sealVaultKeyTo(vk, p.account.x25519.publicKey, g);
  const salt = e2ee.randomBytes(16);
  const passcodeKey = await e2ee.vaultPasscodeKey("owner passcode!", { name: "argon2id", ...KDF, salt });
  const recoveryKey = await e2ee.vaultRecoveryKey(e2ee.newRecoveryKey().bytes);
  await p.as.mutation(api.vaultKeys.setUp, {
    vaultId,
    check: wire(keys.check),
    passcode: { version: 1, epoch: p.epoch, wrapped: wire(await e2ee.wrapWithPasscode(inner, passcodeKey, g)), salt: wire(salt), kdf: KDF },
    recovery: { version: 1, epoch: p.epoch, wrapped: wire(await e2ee.wrapWithRecovery(inner, recoveryKey, g)) },
  });
  return vk;
}

/** What a custodian's device does for everyone waiting (lib/vault/keys.ts grantWaiting). */
async function grantWaiting(custodian: E2eePerson, vaultId: string, vks: Map<number, Uint8Array>) {
  const e2ee = await e2eeLib();
  const waiting = await custodian.as.query(api.vaultKeys.pending, { vaultId });
  for (const p of waiting.people) {
    if (!p.account) continue;
    const grants = [];
    for (const version of waiting.keyVersions) grants.push({ version, epoch: p.account.epoch, wrapped: wire(await e2ee.sealVaultKeyTo(vks.get(version)!, bytes(p.account.x25519Pub), { vaultId, keyVersion: version, profileId: p.profileId })) });
    await custodian.as.mutation(api.vaultKeys.grant, { vaultId, profileId: p.profileId, grants });
  }
}

/** A member's device finishing with their passcode (every version a custodian sealed to them). */
async function finish(m: E2eePerson, vaultId: string, reason: "first" | "rotation") {
  const e2ee = await e2eeLib();
  const r = await m.as.mutation(api.vaultKeys.unlock, { vaultId, way: "passcode" });
  if (r.locked) throw new Error("locked");
  const salt = e2ee.randomBytes(16);
  const passcodeKey = await e2ee.vaultPasscodeKey("member passcode", { name: "argon2id", ...KDF, salt });
  const inners = new Map<number, Uint8Array>();
  for (const g of r.grants) inners.set(g.version, await e2ee.innerOfGrant(bytes(g.wrapped), { kind: "passcode", key: passcodeKey }, { vaultId, keyVersion: g.version, profileId: m.profileId }).catch(() => new Uint8Array()));
  for (const g of r.fromCustodian) inners.set(g.version, bytes(g.wrapped));
  const grants = [];
  for (const [version, inner] of inners) grants.push({ version, epoch: m.epoch, wrapped: wire(await e2ee.wrapWithPasscode(inner, passcodeKey, { vaultId, keyVersion: version, profileId: m.profileId })), salt: wire(salt), kdf: KDF });
  await m.as.mutation(api.vaultKeys.setPasscode, { vaultId, grants, reason });
  return r;
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

describe("people in a team Vault", { timeout: 180_000 }, () => {
  test("adding and roles follow the owner's custodian rule; admins aren't in; the owner can't be removed", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await e2eePerson(t, "vp-owner@example.com");
    const custodian = await e2eePerson(t, "vp-custodian@example.com");
    const admin = await e2eePerson(t, "vp-admin@example.com");
    const member = await e2eePerson(t, "vp-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, custodian, "vp-custodian@example.com", workspaceId, "editor");
    await join(t, owner, admin, "vp-admin@example.com", workspaceId, "admin");
    await join(t, owner, member, "vp-member@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await setUpVault(owner, id);

    expect(await admin.as.query(api.vault.get, { scope })).toBeNull();
    expect(await codeOf(admin.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: admin.profileId, role: "custodian" }))).toBe("not_found");
    await owner.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: custodian.profileId, role: "custodian" });
    // A custodian adds members, but names custodians only if the owner allows it.
    expect(await codeOf(custodian.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: member.profileId, role: "custodian" }))).toBe("forbidden");
    await custodian.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: member.profileId, role: "member" });
    expect(await codeOf(custodian.as.mutation(api.vaultPeople.setRole, { vaultId: id, profileId: member.profileId, role: "custodian" }))).toBe("forbidden");
    await owner.as.mutation(api.vault.updateSettings, { vaultId: id, custodiansNameCustodians: true });
    await custodian.as.mutation(api.vaultPeople.setRole, { vaultId: id, profileId: member.profileId, role: "custodian" });
    await custodian.as.mutation(api.vaultPeople.setRole, { vaultId: id, profileId: member.profileId, role: "member" });
    // Members can't add or remove anyone; the owner can't be removed or demoted.
    expect(await codeOf(member.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: admin.profileId, role: "member" }))).toBe("forbidden");
    expect(await codeOf(custodian.as.mutation(api.vaultPeople.remove, { vaultId: id, profileId: owner.profileId }))).toBe("not_found");
    expect(await codeOf(owner.as.mutation(api.vaultPeople.remove, { vaultId: id, profileId: owner.profileId }))).toBe("invalid_argument");
    // Only workspace members can be added.
    const outsider = await e2eePerson(t, "vp-outsider@example.com");
    expect(await codeOf(owner.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: outsider.profileId, role: "member" }))).toBe("not_found");

    const people = await owner.as.query(api.vaultPeople.list, { vaultId: id });
    expect(people.people.map((p) => [p.name, p.role, p.ready, p.waiting])).toEqual([
      ["vp-owner", "owner", true, false],
      ["vp-custodian", "custodian", false, true],
      ["vp-member", "member", false, true],
    ]);
    expect(people.onlyOneCustodian).toBe(false);
    // Members see names and roles, not emails.
    expect((await member.as.query(api.vaultPeople.list, { vaultId: id })).people.every((p) => p.email === null)).toBe(true);
  });

  test("removing someone who held the key: a new key version for everyone left, adopted at their next unlock", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const e2ee = await e2eeLib();
    const owner = await e2eePerson(t, "vr-owner@example.com");
    const member = await e2eePerson(t, "vr-member@example.com");
    const leaver = await e2eePerson(t, "vr-leaver@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "vr-member@example.com", workspaceId, "editor");
    await join(t, owner, leaver, "vr-leaver@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    const vk1 = await setUpVault(owner, id);
    for (const p of [member, leaver]) await owner.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: p.profileId, role: "member" });
    await grantWaiting(owner, id, new Map([[1, vk1]]));
    await finish(member, id, "first");
    await finish(leaver, id, "first");
    expect((await owner.as.query(api.vaultPeople.list, { vaultId: id })).people.every((p) => p.ready)).toBe(true);

    await owner.as.mutation(api.vaultPeople.remove, { vaultId: id, profileId: leaver.profileId });
    expect(await codeOf(leaver.as.mutation(api.vaultKeys.unlock, { vaultId: id, way: "passcode" }))).toBe("not_found");
    expect(await owner.as.query(api.vault.get, { scope })).toMatchObject({ rotationNeeded: true });

    // The owner's device makes version 2 for the owner and the member, not the one who left.
    const holders = await owner.as.query(api.vaultPeople.keyHolders, { vaultId: id });
    expect(holders.people.map((p) => p.profileId).sort()).toEqual([owner.profileId, member.profileId].sort());
    const vk2 = e2ee.newVaultKey();
    const k2 = await e2ee.deriveVaultKeys(vk2);
    // Leaving someone out is refused.
    expect(await codeOf(owner.as.mutation(api.vaultPeople.rotate, { vaultId: id, version: 2, check: wire(k2.check), grants: [] }))).toBe("invalid_argument");
    const grants = [];
    for (const p of holders.people) grants.push({ profileId: p.profileId, epoch: p.epoch, wrapped: wire(await e2ee.sealVaultKeyTo(vk2, bytes(p.x25519Pub), { vaultId: id, keyVersion: 2, profileId: p.profileId })) });
    await owner.as.mutation(api.vaultPeople.rotate, { vaultId: id, version: 2, check: wire(k2.check), grants });
    expect(await owner.as.query(api.vault.get, { scope })).toMatchObject({ keyVersion: 2, rotationNeeded: false });

    // The member's next unlock: their passcode grant for version 1, version 2 from the custodian; both get the passcode layer.
    const r = await finish(member, id, "rotation");
    expect(r.grants.map((g) => g.version)).toEqual([1]);
    expect(r.fromCustodian.map((g) => g.version)).toEqual([2]);
    const opened = await e2ee.openVaultGrant(bytes(r.fromCustodian[0]!.wrapped), { kind: "custodian" }, member.account.x25519, { vaultId: id, keyVersion: 2, profileId: member.profileId }, bytes(r.keys.find((k) => k.version === 2)!.check));
    expect(e2ee.constantTimeEqual(opened, vk2)).toBe(true);
    expect(await member.as.query(api.vault.get, { scope })).toMatchObject({ hasAccessKey: true, needsPasscode: false });
    expect(await events(t, id)).toEqual(expect.arrayContaining(["person.added", "access.granted", "person.removed", "key.rotated", "key.adopted"]));
  });

  test("leaving the workspace takes someone out of its Vault, logged by the system, and a new key is due", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await e2eePerson(t, "vw-owner@example.com");
    const member = await e2eePerson(t, "vw-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "vw-member@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    const vk1 = await setUpVault(owner, id);
    await owner.as.mutation(api.vaultPeople.add, { vaultId: id, profileId: member.profileId, role: "member" });
    await grantWaiting(owner, id, new Map([[1, vk1]]));
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect((await owner.as.query(api.vaultPeople.list, { vaultId: id })).people.map((p) => p.name)).toEqual(["vw-owner"]);
    expect(await owner.as.query(api.vault.get, { scope })).toMatchObject({ rotationNeeded: true });
    expect((await events(t, id)).at(-1)).toBe("person.leftWorkspace");
  });
});
