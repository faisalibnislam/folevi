// Sharing vault items (convex/vaultShares.ts): with a workspace member outside the Vault and with someone outside the
// workspace (an expiry), Shared with Me, recipients' opens and edits logged, ending a share; one-time links with a
// view limit, a password, expiry and revocation, the wrapped key gone once used up.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { e2eeLib, e2eePerson, enableFlag, join, setup, teamWorkspace, ulid, wire, type T } from "./helpers";

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
const SECRET = "server-secret-for-tests-0123456789";

beforeEach(() => vi.stubEnv("FOLEVI_SERVER_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

async function keyed(t: T, vaultId: string, by: string) {
  await t.run(async (ctx) => {
    const vault = (await ctx.db
      .query("vaults")
      .withIndex("by_public_id", (q) => q.eq("publicId", vaultId))
      .unique())!;
    await ctx.db.patch(vault._id, { keyVersion: 1 });
    await ctx.db.insert("vaultKeys", { vaultId: vault._id, workspaceId: vault.workspaceId!, version: 1, check: blob(16), createdBy: by as Id<"profiles">, createdAt: Date.now() });
  });
}

const events = (t: T, vaultId: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("vaultLog")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vaultId))
        .collect()
    ).map((e) => `${e.event}:${e.actorRole}${e.outcome === "failed" ? `:${e.reason}` : ""}`),
  );

describe("sharing vault items", { timeout: 120_000 }, () => {
  test("finding someone by email: their checked keys and whether they're outside, logged without the address; members can't", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await e2eePerson(t, "vf-owner@example.com");
    const colleague = await e2eePerson(t, "vf-colleague@example.com");
    const outsider = await e2eePerson(t, "vf-outsider@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, colleague, "vf-colleague@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    const login = ulid();
    await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId: login, kind: "login", item: sealed() });

    const c = await owner.as.mutation(api.vaultShares.findPerson, { vaultId: id, itemId: login, email: " VF-Colleague@example.com " });
    expect(c).toMatchObject({ profileId: colleague.profileId, inVault: false, outside: false, epoch: 1 });
    expect(c!.x25519Pub.byteLength).toBe(32);
    expect(await owner.as.mutation(api.vaultShares.findPerson, { vaultId: id, itemId: login, email: "vf-outsider@example.com" })).toMatchObject({ profileId: outsider.profileId, outside: true });
    expect(await owner.as.mutation(api.vaultShares.findPerson, { vaultId: id, itemId: login, email: "nobody@example.com" })).toBeNull();
    expect(await owner.as.mutation(api.vaultShares.findPerson, { vaultId: id, itemId: login, email: "vf-owner@example.com" })).toBeNull();
    expect(await codeOf(owner.as.mutation(api.vaultShares.findPerson, { vaultId: id, itemId: login, email: "not an email" }))).toBe("invalid_argument");
    // Not in the Vault: no lookups.
    expect(await codeOf(colleague.as.mutation(api.vaultShares.findPerson, { vaultId: id, itemId: login, email: "vf-outsider@example.com" }))).toBeDefined();
    const lookups = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", id))
          .collect()
      ).filter((e) => e.event === "share.lookup"),
    );
    expect(lookups).toHaveLength(4);
    expect(JSON.stringify(lookups)).not.toContain("nobody@example.com");
  });

  test("with a member outside the Vault and someone outside the workspace; their opens and edits are logged", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const e2ee = await e2eeLib();
    const owner = await e2eePerson(t, "vs-owner@example.com");
    const colleague = await e2eePerson(t, "vs-colleague@example.com");
    const outsider = await e2eePerson(t, "vs-outsider@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, colleague, "vs-colleague@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    const note = ulid();
    await owner.as.mutation(api.vaultFiles.createNote, { vaultId: id, itemId: note, item: sealed() });
    const login = ulid();
    await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId: login, kind: "login", item: sealed(2) });

    const itemKey = e2ee.randomBytes(32);
    const sealFor = async (p: typeof colleague) => wire(await e2ee.sealTo(p.account.x25519.publicKey, e2ee.vaultCtx.shareKey(id, note, p.profileId), itemKey));
    expect(await owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: note, shareId: ulid(), profileId: colleague.profileId, canEdit: true, wrappedKey: await sealFor(colleague), epoch: 1 })).toEqual({ expiresAt: null });
    const toOutsider = await owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: note, shareId: ulid(), profileId: outsider.profileId, canEdit: false, wrappedKey: await sealFor(outsider), epoch: 1 });
    expect(toOutsider.expiresAt! - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
    // Passwords can be shared to read only.
    expect(await codeOf(owner.as.mutation(api.vaultShares.share, { vaultId: id, itemId: login, shareId: ulid(), profileId: colleague.profileId, canEdit: true, wrappedKey: await sealFor(colleague), epoch: 1 }))).toBe("invalid_argument");

    const mine = await colleague.as.query(api.vaultShares.mine, {});
    expect(mine).toHaveLength(1);
    // The recipient opens the item key with their own account key.
    const opened = await colleague.as.mutation(api.vaultShares.openShared, { shareId: mine[0]!.shareId });
    const raw = await e2ee.openSealed(colleague.account.x25519.privateKey, colleague.account.x25519.publicKey, e2ee.vaultCtx.shareKey(id, note, colleague.profileId), new Uint8Array(opened.wrappedKey));
    expect(e2ee.constantTimeEqual(raw, itemKey)).toBe(true);
    expect(await colleague.as.mutation(api.vaultShares.saveShared, { shareId: mine[0]!.shareId, baseRevision: 1, sealedSummary: blob(64, 9), sealed: blob(96, 9) })).toEqual({ revision: 2 });
    const outsiderShare = (await outsider.as.query(api.vaultShares.mine, {}))[0]!;
    expect(await codeOf(outsider.as.mutation(api.vaultShares.saveShared, { shareId: outsiderShare.shareId, baseRevision: 2, sealedSummary: blob(), sealed: blob() }))).toBe("forbidden");
    // They never see the Vault itself.
    expect(await codeOf(colleague.as.query(api.vaultItems.list, { vaultId: id, section: "files" }))).toBe("not_found");

    const shares = await owner.as.query(api.vaultShares.ofItem, { vaultId: id, itemId: note });
    await owner.as.mutation(api.vaultShares.unshare, { vaultId: id, shareId: shares.people.find((p) => p.name === "vs-outsider")!.id });
    expect(await outsider.as.query(api.vaultShares.mine, {})).toEqual([]);
    expect(await codeOf(outsider.as.mutation(api.vaultShares.openShared, { shareId: outsiderShare.shareId }))).toBe("not_found");
    expect(await events(t, id)).toEqual(expect.arrayContaining(["item.shared:owner", "share.opened:recipient", "note.edited:recipient", "share.ended:owner"]));
  });

  test("one-time links: a password, a view limit that deletes the key, revoking", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const e2ee = await e2eeLib();
    const owner = await e2eePerson(t, "vl2-owner@example.com");
    const { scope } = await teamWorkspace(owner);
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await keyed(t, id, owner.profileId);
    const item = ulid();
    await owner.as.mutation(api.vaultItems.create, { vaultId: id, itemId: item, kind: "login", item: sealed() });

    const linkId = e2ee.toBase64Url(e2ee.randomBytes(18));
    const secret = e2ee.randomBytes(32);
    const itemKey = e2ee.randomBytes(32);
    const wrappedKey = wire(await e2ee.sealRecord(await e2ee.linkWrapKey(secret.slice()), 1, e2ee.vaultCtx.linkKey(id, item, linkId), itemKey));
    expect(await codeOf(owner.as.mutation(api.vaultShares.createLink, { vaultId: id, itemId: item, linkId, wrappedKey, maxViews: 11, expiresInMs: 3600_000 }))).toBe("invalid_argument");
    await owner.as.mutation(api.vaultShares.createLink, { vaultId: id, itemId: item, linkId, wrappedKey, maxViews: 2, expiresInMs: 3600_000, password: "hunter22" });

    const open = (password?: string) => t.mutation(api.vaultShares.openLink, { linkId, ...(password ? { password } : {}), serverSecret: SECRET, clientKey: "203.0.113.9" });
    expect(await codeOf(t.mutation(api.vaultShares.openLink, { linkId, serverSecret: "wrong", clientKey: "x" }))).toBe("forbidden");
    expect(await open()).toEqual({ status: "password", wrong: false });
    expect(await open("nope")).toEqual({ status: "password", wrong: true });
    const first = await open("hunter22");
    expect(first).toMatchObject({ status: "ok", viewsLeft: 1 });
    // Only the fragment's secret opens the item key.
    if (first.status !== "ok") throw new Error("not ok");
    const raw = await e2ee.openRecord(await e2ee.linkWrapKey(secret.slice()), e2ee.vaultCtx.linkKey(id, item, linkId), new Uint8Array(first.wrappedKey!));
    expect(e2ee.constantTimeEqual(raw, itemKey)).toBe(true);
    expect(await open("hunter22")).toMatchObject({ status: "ok", viewsLeft: 0 });
    expect(await open("hunter22")).toEqual({ status: "gone" });
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("vaultLinks")
        .withIndex("by_public_id", (q) => q.eq("publicId", linkId))
        .unique(),
    );
    expect(stored).toMatchObject({ views: 2, endedHow: "usedUp" });
    expect(stored!.wrappedKey).toBeUndefined();

    // Revoked before use.
    const other = e2ee.toBase64Url(e2ee.randomBytes(18));
    await owner.as.mutation(api.vaultShares.createLink, { vaultId: id, itemId: item, linkId: other, wrappedKey, maxViews: 1, expiresInMs: 3600_000 });
    await owner.as.mutation(api.vaultShares.revokeLink, { vaultId: id, linkId: other });
    expect(await t.mutation(api.vaultShares.openLink, { linkId: other, serverSecret: SECRET, clientKey: "x" })).toEqual({ status: "gone" });

    expect(await events(t, id)).toEqual(
      expect.arrayContaining(["link.created:owner", "link.opened:link:wrong_password", "link.opened:link", "link.usedUp:link", "link.opened:link:gone", "link.revoked:owner"]),
    );
  });
});
