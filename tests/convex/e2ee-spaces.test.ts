// End-to-end encryption per space and key grants (docs/E2EE_DESIGN.md §4.9, §5.3, §5.6, §7.1, §8; WP2):
// setting a space up, enabling, switches, lowering, rotating; who may do each (members can't); key holders
// and pending grants; note keys for guests; and the guard helpers other packages call.
import { describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { personalScope, workspaceScope } from "../../convex/lib/scope";
import { isLocked, readableFor, requirePlainWrite, requirePlainWriteInScope, spaceE2ee, switchesOf } from "../../convex/lib/e2ee/state";
import { e2eeLib, e2eePerson, e2eeRecoveryMethods, e2eeSpace, join, person, PERSONAL, setup, spaceGrant, spaceKeyInput, teamWorkspace, wire, type E2eePerson, type T } from "./helpers";

const dataOf = (e: unknown) => (e as { data?: Record<string, unknown> }).data;
const PICKED = { foliAi: "ask" as const, backgroundAi: true, searchEverywhere: true, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };

async function docByPublicId(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db
    .query("documents")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique())!);
}

/** A first note key row for a note (WP3's sealed document.create writes it; here it's inserted directly). */
async function seedNoteKey(t: T, documentId: Id<"documents">, by: string, spaceVersion = 1) {
  await t.run(async (ctx) => {
    const doc = (await ctx.db.get(documentId))!;
    await ctx.db.insert("e2eeNoteKeys", {
      ...(doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : { workspaceId: doc.workspaceId }),
      documentId,
      version: 1,
      wrappedBy: "space",
      spaceVersion,
      wrapped: new ArrayBuffer(70),
      createdBy: by as Id<"profiles">,
      createdAt: Date.now(),
      seq: 1,
    });
  });
}

async function scheduledPurges(t: T) {
  return await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("mirrors")).map((f) => (f.args[0] as { purpose: string }).purpose));
}

describe("a Personal space", () => {
  test("set up, then encrypted: the space key is granted to its owner, and the space appears in mine()", async () => {
    const t = setup();
    const a = await e2eePerson(t, "space@example.com");
    const { sk, scopeId, pending } = await e2eeSpace(a, PERSONAL);
    expect(pending).toBe(0);
    expect(await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).toMatchObject({ scopeId, setUp: true, level: "standard", state: "off", currentKeyVersion: 1, active: false, keyHolders: 1 });
    // Set up but Standard with no locks: nothing for the device to do yet.
    expect(await a.as.query(api.e2ee.spaces.mine, {})).toEqual([]);
    await e2eeRecoveryMethods(a);
    const { migrationId } = await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: PICKED });
    expect(migrationId).toBeTruthy();
    const got = await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL });
    expect(got).toMatchObject({ level: "selected", state: "enabling", switches: PICKED, active: true, migration: { direction: "seal", phase: "documents", done: 0 } });
    const mine = await a.as.query(api.e2ee.spaces.mine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ scope: { kind: "personal" }, scopeId, level: "selected", currentKeyVersion: 1 });
    const e2ee = await e2eeLib();
    expect(await e2ee.openSealed(a.account.x25519.privateKey, a.account.x25519.publicKey, e2ee.ctx.spaceGrant(scopeId, 1, a.profileId), new Uint8Array(mine[0]!.grants[0]!.wrapped))).toEqual(sk);
    // The inbox public key is the one derived from the space key.
    expect(new Uint8Array(got.inboxPub!)).toEqual((await e2ee.deriveSpaceKeys(sk.slice())).inbox.publicKey);
  });

  test("setUp is refused twice, without a self-grant, and for a version other than 1", async () => {
    const t = setup();
    const a = await e2eePerson(t, "setup-twice@example.com");
    const { key } = await spaceKeyInput(1);
    await expect(a.as.mutation(api.e2ee.spaces.setUp, { scope: PERSONAL, key, grants: [] })).rejects.toThrow(/yourself/);
    const v2 = await spaceKeyInput(2);
    await expect(a.as.mutation(api.e2ee.spaces.setUp, { scope: PERSONAL, key: v2.key, grants: [] })).rejects.toThrow(/version 1/);
    await e2eeSpace(a, PERSONAL);
    await expect(e2eeSpace(a, PERSONAL)).rejects.toThrow(/already has a key/);
  });

  test("enable needs the flag, a space key and two recovery methods; encrypting at the same level again is refused", async () => {
    const t = setup();
    const a = await e2eePerson(t, "enable@example.com");
    await e2eeRecoveryMethods(a);
    expect(await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: PICKED }).catch(dataOf)).toMatchObject({ code: "e2ee_not_set_up" });
    await e2eeSpace(a, PERSONAL);
    await t.run(async (ctx) => {
      const flag = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "e2ee"))
        .unique();
      await ctx.db.patch(flag!._id, { enabled: false });
    });
    expect(await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: PICKED }).catch(dataOf)).toMatchObject({ code: "e2ee_unavailable" });
    await t.run(async (ctx) => {
      const flag = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "e2ee"))
        .unique();
      await ctx.db.patch(flag!._id, { enabled: true });
    });
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: PICKED });
    // Fully encrypted turns every switch off, whatever was sent.
    expect((await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).switches).toEqual({ foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false });
    await expect(a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: PICKED })).rejects.toThrow(/use Lower/);
    await expect(a.as.mutation(api.e2ee.spaces.setSwitches, { scope: PERSONAL, switches: PICKED })).rejects.toThrow(/every feature off/);
  });

  test("turning a switch off schedules the purge of its readable copies; selected to full purges every one that was on", async () => {
    const t = setup();
    const a = await e2eePerson(t, "switches@example.com");
    await e2eeRecoveryMethods(a);
    await e2eeSpace(a, PERSONAL);
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: { ...PICKED, apps: true } });
    expect(await a.as.mutation(api.e2ee.spaces.setSwitches, { scope: PERSONAL, switches: { ...PICKED, apps: true, searchEverywhere: false } })).toEqual({ purged: ["search"] });
    expect(await scheduledPurges(t)).toEqual(["search"]);
    const { purged } = await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: PICKED });
    expect(purged.sort()).toEqual(["ai", "apps"]);
    expect((await scheduledPurges(t)).sort()).toEqual(["ai", "apps", "search"]);
  });

  test("lower needs a recovery method re-checked in the last 10 minutes; full to selected changes no data, to standard decrypts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 12, 0));
    try {
      const t = setup();
      const a = await e2eePerson(t, "lower@example.com");
      const { recoveryWrapId } = await e2eeRecoveryMethods(a);
      await e2eeSpace(a, PERSONAL);
      await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: PICKED });
      expect(await a.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "selected", recheckedWrapId: recoveryWrapId }).catch(dataOf)).toMatchObject({ code: "e2ee_recovery_required" });
      await a.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" });
      expect(await a.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "selected", recheckedWrapId: recoveryWrapId })).toEqual({ migrationId: null });
      expect(await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).toMatchObject({ level: "selected", switches: { foliAi: "ask", searchEverywhere: false } });
      vi.setSystemTime(Date.UTC(2026, 9, 21, 12, 11));
      await expect(a.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "standard", recheckedWrapId: recoveryWrapId })).rejects.toThrow(/again first/);
      await a.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" });
      const { migrationId } = await a.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "standard", recheckedWrapId: recoveryWrapId });
      expect(migrationId).toBeTruthy();
      expect(await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).toMatchObject({ level: "standard", state: "disabling", active: true, migration: { direction: "unseal" } });
      // While it decrypts, encrypting again waits.
      await expect(a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: PICKED })).rejects.toThrow(/Wait until/);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function teamWithMembers(t: T) {
  const owner = await e2eePerson(t, "team-owner@example.com");
  const admin = await e2eePerson(t, "team-admin@example.com");
  const editor = await e2eePerson(t, "team-editor@example.com");
  const late = await person(t, "team-late@example.com");
  const { workspaceId, scope } = await teamWorkspace(owner);
  await join(t, owner, admin, "team-admin@example.com", workspaceId, "admin");
  await join(t, owner, editor, "team-editor@example.com", workspaceId, "editor");
  await join(t, owner, late, "team-late@example.com", workspaceId, "viewer");
  return { owner, admin, editor, late, workspaceId, scope };
}

describe("a workspace", () => {
  test("only owners and admins set up, enable, switch, lower and rotate; members read", async () => {
    const t = setup();
    const { owner, admin, editor, scope } = await teamWithMembers(t);
    await e2eeRecoveryMethods(editor);
    const { key } = await spaceKeyInput(1);
    await expect(editor.as.mutation(api.e2ee.spaces.setUp, { scope, key, grants: [] })).rejects.toThrow(/owner and admins/);
    const space = await e2eeSpace(admin, scope, [owner, editor]);
    expect(space.pending).toBe(1);
    await expect(editor.as.mutation(api.e2ee.spaces.enable, { scope, level: "selected", switches: PICKED })).rejects.toThrow(/owner and admins/);
    await e2eeRecoveryMethods(owner);
    await owner.as.mutation(api.e2ee.spaces.enable, { scope, level: "selected", switches: PICKED });
    await expect(editor.as.mutation(api.e2ee.spaces.setSwitches, { scope, switches: PICKED })).rejects.toThrow(/owner and admins/);
    await expect(editor.as.mutation(api.e2ee.spaces.lower, { scope, level: "standard", recheckedWrapId: "x" })).rejects.toThrow(/owner and admins/);
    const v2 = await spaceKeyInput(2);
    await expect(editor.as.mutation(api.e2ee.spaces.rotate, { scope, key: v2.key, grants: [], noteKeys: [] })).rejects.toThrow(/owner and admins/);
    await expect(editor.as.mutation(api.e2ee.grants.grantSpace, { scope, grants: [] })).rejects.toThrow(/owner and admins/);
    await expect(editor.as.query(api.e2ee.grants.pending, { scope })).rejects.toThrow(/owner and admins/);
    // Members read the level and switches, and get their own grants.
    expect(await editor.as.query(api.e2ee.spaces.get, { scope })).toMatchObject({ level: "selected", switches: PICKED, keyHolders: 3 });
    const mine = (await editor.as.query(api.e2ee.spaces.mine, {})).find((s) => s.scope.kind === "workspace")!;
    expect(mine.grants.map((g) => g.version)).toEqual([1]);
    // People outside the workspace see nothing.
    const stranger = await e2eePerson(t, "stranger@example.com");
    await expect(stranger.as.query(api.e2ee.spaces.get, { scope })).rejects.toThrow(/Workspace not found/);
  });

  test("a member without keys waits as pending; once they set up, an admin grants the key and the pending row goes", async () => {
    const t = setup();
    const { owner, admin, late, scope } = await teamWithMembers(t);
    const space = await e2eeSpace(owner, scope, [admin]);
    expect(space.pending).toBe(2);
    const pending = await admin.as.query(api.e2ee.grants.pending, { scope });
    expect(pending.map((p) => [p.reason, p.hasKeys]).sort()).toEqual([["joined", false], ["joined", true]]);
    // Keys can't go to someone without an account, or outside the workspace.
    const fakeGrant = { profileId: late.profileId, version: 1, epoch: 1, wrapped: new ArrayBuffer(97), statement: { kind: "space-grant" as const, body: "{}", sig: "x" } };
    await expect(admin.as.mutation(api.e2ee.grants.grantSpace, { scope, grants: [fakeGrant] })).rejects.toThrow(/keys changed/);
    const outsider = await e2eePerson(t, "outsider@example.com");
    const toOutsider = await spaceGrant(space.scopeId, 1, space.sk, admin, { profileId: outsider.profileId, x25519Pub: outsider.account.x25519.publicKey, epoch: 1 });
    await expect(admin.as.mutation(api.e2ee.grants.grantSpace, { scope, grants: [toOutsider] })).rejects.toThrow(/people in this space/);
    // The late member sets up; the admin's device sees them with keys and grants the key.
    const { e2eeEpoch, deviceRegistration, e2eeDeviceKeys } = await import("./helpers");
    const e2ee = await e2eeLib();
    const ep = await e2eeEpoch(late.profileId, 1);
    const dev = await e2eeDeviceKeys();
    await late.as.mutation(api.e2ee.keys.createAccount, { ...{ x25519Pub: ep.registration.x25519Pub, ed25519Pub: ep.registration.ed25519Pub, amkCheck: ep.registration.amkCheck }, statement: ep.statement, device: deviceRegistration(dev), deviceWrap: wire(await e2ee.sealTo(dev.x.publicKey, e2ee.ctx.amkDevice(late.profileId, dev.deviceId), ep.amk)) });
    const keys = (await admin.as.query(api.e2ee.keys.accountKeysOf, { profileIds: [late.profileId] }))[0]!;
    const grant = await spaceGrant(space.scopeId, 1, space.sk, admin, { profileId: late.profileId, x25519Pub: new Uint8Array(keys.x25519Pub), epoch: keys.epoch });
    // A statement naming someone else as the granter is refused.
    const forged = await spaceGrant(space.scopeId, 1, space.sk, { profileId: owner.profileId, account: admin.account }, { profileId: late.profileId, x25519Pub: new Uint8Array(keys.x25519Pub), epoch: keys.epoch });
    await expect(admin.as.mutation(api.e2ee.grants.grantSpace, { scope, grants: [forged] })).rejects.toThrow(/grantedBy/);
    expect(await admin.as.mutation(api.e2ee.grants.grantSpace, { scope, grants: [grant] })).toEqual({ granted: 1 });
    const holders = await late.as.query(api.e2ee.spaces.keyHolders, { scope });
    expect(holders.count).toBe(3);
    expect(holders.pending.map((p) => p.reason)).toEqual(["joined"]);
  });

  test("rotate: version 2 for the remaining members, version 1 retired, note keys wrapped by the new version, a reseal job", async () => {
    const t = setup();
    const { owner, admin, editor, scope } = await teamWithMembers(t);
    const space = await e2eeSpace(owner, scope, [admin, editor]);
    const { id: docId } = await owner.as.mutation(api.documents.create, { scope, title: "Plan" });
    const doc = await docByPublicId(t, docId);
    await seedNoteKey(t, doc._id, owner.profileId);
    await t.run(async (ctx) => {
      const ws = (await ctx.db.get(doc.workspaceId!))!;
      await ctx.db.insert("e2eePendingGrants", { workspaceId: ws._id, scopeKey: `w:${ws._id}`, profileId: editor.profileId as Id<"profiles">, reason: "rotation", createdAt: Date.now() });
    });
    const v2 = await spaceKeyInput(2);
    const grants = [await spaceGrant(space.scopeId, 2, v2.sk, owner, { profileId: owner.profileId, x25519Pub: owner.account.x25519.publicKey, epoch: 1 }), await spaceGrant(space.scopeId, 2, v2.sk, owner, { profileId: admin.profileId, x25519Pub: admin.account.x25519.publicKey, epoch: 1 })];
    const noteKeys = [{ documentId: docId, version: 1, wrappedBy: "space" as const, spaceVersion: 2, wrapped: new ArrayBuffer(70) }];
    await expect(owner.as.mutation(api.e2ee.spaces.rotate, { scope, key: (await spaceKeyInput(3)).key, grants, noteKeys })).rejects.toThrow(/changed on another device/);
    const res = await owner.as.mutation(api.e2ee.spaces.rotate, { scope, key: v2.key, grants, noteKeys });
    expect(res).toMatchObject({ version: 2, pending: 2, noteKeys: 1 });
    expect(await owner.as.query(api.e2ee.spaces.get, { scope })).toMatchObject({ currentKeyVersion: 2, keyHolders: 2, migration: { direction: "reseal" } });
    const keys = await t.run(async (ctx) => (await ctx.db.query("e2eeSpaceKeys").collect()).map((k) => [k.version, k.retiredAt !== undefined]));
    expect(keys).toEqual([[1, true], [2, false]]);
    const noteKeyRows = await t.run(async (ctx) => (await ctx.db.query("e2eeNoteKeys").collect()).map((r) => r.spaceVersion).sort());
    expect(noteKeyRows).toEqual([1, 2]);
    // The rotation's pending entry went; the editor (left out) now waits for the new key.
    const pending = await owner.as.query(api.e2ee.grants.pending, { scope });
    expect(pending.filter((p) => p.profileId === editor.profileId).map((p) => p.reason)).toEqual(["joined"]);
    // Later batches: a note key version that doesn't exist is refused; a wrap by an old space version too.
    await expect(owner.as.mutation(api.e2ee.spaces.addNoteKeyWraps, { scope, noteKeys: [{ ...noteKeys[0]!, version: 5 }] })).rejects.toThrow(/doesn't exist/);
    await expect(owner.as.mutation(api.e2ee.spaces.addNoteKeyWraps, { scope, noteKeys: [{ ...noteKeys[0]!, spaceVersion: 1 }] })).rejects.toThrow(/new space key/);
    expect(await owner.as.mutation(api.e2ee.spaces.addNoteKeyWraps, { scope, noteKeys })).toEqual({ stored: 1 });
  });
});

describe("note keys for guests", () => {
  async function sharedPage(t: T) {
    const a = await e2eePerson(t, "sharer@example.com");
    const guest = await e2eePerson(t, "guest@example.com");
    const other = await e2eePerson(t, "not-shared@example.com");
    await e2eeSpace(a, PERSONAL);
    const { id: docId } = await a.as.mutation(api.documents.create, { scope: PERSONAL, title: "Shared" });
    const doc = await docByPublicId(t, docId);
    await seedNoteKey(t, doc._id, a.profileId);
    await t.run(async (ctx) => {
      await ctx.db.insert("documentPermissions", { documentId: doc._id, ownerProfileId: doc.ownerProfileId, profileId: guest.profileId as Id<"profiles">, role: "viewer", grantedBy: doc.createdBy, createdAt: Date.now() });
    });
    return { a, guest, other, docId, doc };
  }

  async function noteGrant(granter: E2eePerson, docId: string, version: number, nk: Uint8Array, grantee: E2eePerson) {
    const e2ee = await e2eeLib();
    const wrapped = await e2ee.sealTo(grantee.account.x25519.publicKey, e2ee.ctx.noteKeyGrant(docId, version, grantee.profileId), nk);
    const statement = await e2ee.signStatement(granter.account.ed25519.privateKey, "note-grant", { documentId: docId, version, profileId: grantee.profileId, granteeX25519Pub: e2ee.toBase64Url(grantee.account.x25519.publicKey), grantedBy: granter.profileId, at: Date.now() });
    return { wrapped: wire(wrapped), statement };
  }

  test("grantNote: the guest gets the note key (and opens it); noteAudience lists them with keys; others can't", async () => {
    const t = setup();
    const { a, guest, other, docId } = await sharedPage(t);
    const e2ee = await e2eeLib();
    const nk = e2ee.randomBytes(32);
    const audience = await a.as.query(api.e2ee.grants.noteAudience, { documentId: docId });
    expect(audience).toEqual([expect.objectContaining({ profileId: guest.profileId, role: "viewer", viaDocumentId: docId, keys: expect.objectContaining({ epoch: 1 }) })]);
    const g = await noteGrant(a, docId, 1, nk, guest);
    await a.as.mutation(api.e2ee.grants.grantNote, { documentId: docId, version: 1, profileId: guest.profileId, ...g });
    const keys = await guest.as.query(api.e2ee.grants.myNoteKeys, { documentIds: [docId] });
    expect(keys).toEqual([expect.objectContaining({ documentId: docId, version: 1, wrappedBy: "grant", grantedBy: a.profileId })]);
    expect(await e2ee.openSealed(guest.account.x25519.privateKey, guest.account.x25519.publicKey, e2ee.ctx.noteKeyGrant(docId, 1, guest.profileId), new Uint8Array(keys[0]!.wrapped))).toEqual(nk);
    expect(await e2ee.verifyStatement(a.account.ed25519.publicKey, keys[0]!.statement!)).toBe(true);
    // The owner, a member of the space, gets the space-wrapped key too.
    expect((await a.as.query(api.e2ee.grants.myNoteKeys, { documentIds: [docId] })).map((k) => k.wrappedBy)).toEqual(["space"]);
    // Someone the page isn't shared with: can't receive a key, and gets nothing.
    const toOther = await noteGrant(a, docId, 1, nk, other);
    await expect(a.as.mutation(api.e2ee.grants.grantNote, { documentId: docId, version: 1, profileId: other.profileId, ...toOther })).rejects.toThrow(/Share the page with them first/);
    expect(await other.as.query(api.e2ee.grants.myNoteKeys, { documentIds: [docId] })).toEqual([]);
    // The guest (a viewer) can't share it on.
    await expect(guest.as.mutation(api.e2ee.grants.grantNote, { documentId: docId, version: 1, profileId: guest.profileId, ...g })).rejects.toThrow(/permission/);
  });

  test("rotateNoteKey: version 2 for the space and the guests kept; a removed guest loses every version", async () => {
    const t = setup();
    const { a, guest, docId, doc } = await sharedPage(t);
    const e2ee = await e2eeLib();
    const nk1 = e2ee.randomBytes(32);
    await a.as.mutation(api.e2ee.grants.grantNote, { documentId: docId, version: 1, profileId: guest.profileId, ...(await noteGrant(a, docId, 1, nk1, guest)) });
    const space = [{ documentId: docId, version: 2, wrappedBy: "space" as const, spaceVersion: 1, wrapped: new ArrayBuffer(70) }];
    await expect(a.as.mutation(api.e2ee.grants.rotateNoteKey, { documentId: docId, version: 3, wraps: space })).rejects.toThrow(/changed on another device/);
    await expect(a.as.mutation(api.e2ee.grants.rotateNoteKey, { documentId: docId, version: 2, wraps: [] })).rejects.toThrow(/current space key/);
    // The guest is removed from the page, then the key is changed without them.
    await t.run(async (ctx) => {
      for (const p of await ctx.db
        .query("documentPermissions")
        .withIndex("by_document", (q) => q.eq("documentId", doc._id))
        .collect())
        await ctx.db.delete(p._id);
    });
    expect(await a.as.mutation(api.e2ee.grants.rotateNoteKey, { documentId: docId, version: 2, wraps: space })).toEqual({ version: 2 });
    const rows = await t.run(async (ctx) => (await ctx.db.query("e2eeNoteKeys").collect()).map((r) => [r.version, r.wrappedBy]).sort());
    expect(rows).toEqual([[1, "space"], [2, "space"]]);
    expect(await guest.as.query(api.e2ee.grants.myNoteKeys, { documentIds: [docId] })).toEqual([]);
  });
});

describe("the guard helpers (lib/e2ee/state.ts)", () => {
  test("Standard: no row, everything allowed, every switch on; encrypted: plaintext writes refused", async () => {
    const t = setup();
    const a = await e2eePerson(t, "guards@example.com");
    const { id: docId } = await a.as.mutation(api.documents.create, { scope: PERSONAL, title: "Groceries" });
    const doc = await docByPublicId(t, docId);
    const scope = personalScope(a.profileId as Id<"profiles">);
    await t.run(async (ctx) => {
      expect(await spaceE2ee(ctx, scope)).toBeNull();
      expect(switchesOf(null)).toEqual({ foliAi: "auto", backgroundAi: true, searchEverywhere: true, apps: true, emailToNote: true, webClipper: true, notificationPreviews: true });
      await requirePlainWrite(ctx, doc);
      await requirePlainWriteInScope(ctx, scope);
      expect(await isLocked(ctx, doc)).toBe(false);
      expect(await readableFor(ctx, doc, "search")).toMatchObject({ title: "Groceries" });
    });
    await e2eeRecoveryMethods(a);
    await e2eeSpace(a, PERSONAL);
    // Set up but still Standard: plaintext writes are fine.
    await t.run(async (ctx) => requirePlainWrite(ctx, doc));
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: PICKED });
    const refused = await t.run(async (ctx) => requirePlainWriteInScope(ctx, scope).then(() => null, (e) => dataOf(e)));
    expect(refused).toMatchObject({ code: "e2ee_required" });
    // A sealed note: readable only through its mirror, and only with the switch on and not locked.
    await t.run(async (ctx) => {
      await ctx.db.patch(doc._id, { sealedAt: Date.now(), title: "", searchText: "" });
      const sealed = (await ctx.db.get(doc._id))!;
      await expect(requirePlainWrite(ctx, sealed)).rejects.toThrow(/e2ee_required|end-to-end encrypted/);
      expect(await readableFor(ctx, sealed, "search")).toBeNull();
      await ctx.db.insert("e2eeMirrors", { ownerProfileId: sealed.ownerProfileId, purpose: "search", documentId: sealed._id, title: "Groceries", text: "milk eggs", contentHash: "h", updatedAt: Date.now() });
      expect(await readableFor(ctx, sealed, "search")).toEqual({ title: "Groceries", text: "milk eggs" });
      // apps is off at this space: no copy is read even if one existed.
      expect(await readableFor(ctx, sealed, "apps")).toBeNull();
      await ctx.db.patch(doc._id, { locked: true });
      expect(await readableFor(ctx, (await ctx.db.get(doc._id))!, "search")).toBeNull();
    });
  });

  test("a workspace guard reads its own row only", async () => {
    const t = setup();
    const { owner, scope, workspaceId } = await teamWithMembers(t);
    await e2eeRecoveryMethods(owner);
    await e2eeSpace(owner, scope);
    await owner.as.mutation(api.e2ee.spaces.enable, { scope, level: "full", switches: PICKED });
    await t.run(async (ctx) => {
      const ws = await ctx.db
        .query("workspaces")
        .withIndex("by_public_id", (q) => q.eq("publicId", workspaceId))
        .unique();
      await expect(requirePlainWriteInScope(ctx, workspaceScope(ws!._id))).rejects.toThrow();
      await requirePlainWriteInScope(ctx, personalScope(owner.profileId as Id<"profiles">));
    });
  });
});
