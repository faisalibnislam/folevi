// Phase E sweep (docs/ACCOUNT_MODEL_PLAN.md, "Phase E"): what a guest, a stranger, a removed or view-only
// member, or the owner of a workspace being deleted must not be able to do. Each test is a bug the sweep
// found and fixed.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { verifyFileSignature } from "../../convex/lib/fileUrls";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function newPage(p: Person, scope: ScopeArg, title = "Page", parentDocumentId?: string) {
  const { id } = await p.as.mutation(api.documents.create, { scope, title, ...(parentDocumentId ? { parentDocumentId } : {}) });
  return id;
}

async function push(p: Person, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-sweep", ops: ops as never });
}

async function world(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const member = await person(t, `${prefix}-member@example.com`);
  const guest = await person(t, `${prefix}-guest@example.com`);
  const { workspaceId, scope } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, member, `${prefix}-member@example.com`, workspaceId, "editor");
  return { owner, member, guest, workspaceId, scope, guestEmail: `${prefix}-guest@example.com`, memberEmail: `${prefix}-member@example.com` };
}

describe("sync replays only report what you can still open", () => {
  test("an op id reused for someone else's page or block returns nothing of it", async () => {
    const t = setup();
    const victim = await person(t, "replay-victim@example.com");
    const attacker = await person(t, "replay-attacker@example.com");
    const secret = await newPage(victim, PERSONAL, "Salary review");
    const blockId = ulid();
    await victim.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-victim",
      ops: [{ opId: ulid(), kind: "block.upsert", documentId: secret, block: para(blockId, "Confidential numbers"), baseRevision: null, fields: ["content", "position"] }],
    });
    const mine = await newPage(attacker, PERSONAL, "Mine");
    const docOp = ulid();
    const blockOp = ulid();
    await push(attacker, [
      { opId: docOp, kind: "document.update", documentId: mine, patch: { title: "Mine!" }, baseRevision: null },
      { opId: blockOp, kind: "block.upsert", documentId: mine, block: para(ulid(), "hello"), baseRevision: null, fields: ["content", "position"] },
    ]);
    // The same op ids again, now naming the victim's page and block.
    const [d, b] = await push(attacker, [
      { opId: docOp, kind: "document.update", documentId: secret, patch: { title: "x" }, baseRevision: null },
      { opId: blockOp, kind: "block.upsert", documentId: secret, block: para(blockId, "x"), baseRevision: null, fields: ["content", "position"] },
    ]);
    expect(d).toMatchObject({ status: "rejected", error: { code: "invalid_op" } });
    expect(b).toMatchObject({ status: "rejected", error: { code: "invalid_op" } });
    expect(JSON.stringify([d, b])).not.toMatch(/Salary review|Confidential/);
    // A genuine redelivery still reports the original outcome.
    const [again] = await push(attacker, [{ opId: docOp, kind: "document.update", documentId: mine, patch: { title: "Mine!" }, baseRevision: null }]);
    expect(again).toMatchObject({ status: "duplicate", document: { title: "Mine!" } });
  });

  test("a creator who lost access gets nothing back from re-sending their create", async () => {
    const t = setup();
    const w = await world(t, "recreate");
    const id = ulid();
    const create = { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Team plan", icon: null, scope: w.scope } };
    expect((await push(w.member, [create]))[0]!.status).toBe("applied");
    await w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    // A new op id for the same create (another device, say): refused, and the page isn't described.
    const [r] = await push(w.member, [{ ...create, opId: ulid() }]);
    expect(r!.status).toBe("rejected");
    expect(JSON.stringify(r)).not.toMatch(/Team plan/);
  });
});

describe("guests work inside what was shared with them", () => {
  test("a guest can't put pages at the workspace's top level, file them in folders or change tags", async () => {
    const t = setup();
    const w = await world(t, "gmove");
    const shared = await newPage(w.owner, w.scope, "Shared");
    const other = await newPage(w.owner, w.scope, "Also shared");
    await w.owner.as.mutation(api.sharing.grant, { documentId: shared, email: w.guestEmail, role: "editor" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: other, email: w.guestEmail, role: "editor" });
    const { id: folderId } = await w.owner.as.mutation(api.organization.createFolder, { scope: w.scope, name: "Board" });
    const { id: tagId } = await w.owner.as.mutation(api.organization.createTag, { scope: w.scope, name: "board" });
    // A sub-page of the shared page (the guest can edit it) can't be taken to the top level.
    const child = await newPage(w.owner, w.scope, "Sub-page", shared);
    expect((await w.guest.as.query(api.documents.get, { documentId: child }))!.access).toBe("write");
    await expect(w.guest.as.mutation(api.documents.move, { documentId: child, parentDocumentId: null })).rejects.toThrow(/Only members can move a page to the top level/);
    await expect(w.guest.as.mutation(api.documents.move, { documentId: shared, folderId })).rejects.toThrow(/Only members can move pages between folders/);
    await expect(w.guest.as.mutation(api.organization.setDocumentTags, { documentId: shared, tagIds: [tagId] })).rejects.toThrow(/Only members can tag pages/);
    // Moving between pages shared with them is fine.
    await w.guest.as.mutation(api.documents.move, { documentId: child, parentDocumentId: other });
    const moved = (await w.owner.as.query(api.documents.get, { documentId: child }))!;
    expect(moved.document.parentDocumentId).toBe(other);
    // Members can do all of it.
    await w.member.as.mutation(api.documents.move, { documentId: child, parentDocumentId: null });
    await w.member.as.mutation(api.documents.move, { documentId: child, folderId });
    await w.member.as.mutation(api.organization.setDocumentTags, { documentId: child, tagIds: [tagId] });
  });

  test("a page can't be taken out from under a restricted page by someone who only edits it", async () => {
    const t = setup();
    const w = await world(t, "rmove");
    const board = await newPage(w.owner, w.scope, "Board");
    const minutes = await newPage(w.owner, w.scope, "Minutes", board);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: board, mode: "restricted" });
    // The member was invited to edit the restricted page (and so its sub-pages).
    await w.owner.as.mutation(api.sharing.grant, { documentId: board, email: w.memberEmail, role: "editor" });
    expect((await w.member.as.query(api.documents.get, { documentId: minutes }))!.access).toBe("write");
    const open = await newPage(w.member, w.scope, "Open page");
    await expect(w.member.as.mutation(api.documents.move, { documentId: minutes, parentDocumentId: null })).rejects.toThrow(/move it out of a restricted page/);
    await expect(w.member.as.mutation(api.documents.move, { documentId: minutes, parentDocumentId: open })).rejects.toThrow(/move it out of a restricted page/);
    // Other members still can't see it.
    const third = await person(t, "rmove-third@example.com");
    await join(t, w.owner, third, "rmove-third@example.com", w.workspaceId, "editor");
    expect(await third.as.query(api.documents.get, { documentId: minutes })).toBeNull();
    // Whoever manages it can.
    await w.owner.as.mutation(api.documents.move, { documentId: minutes, parentDocumentId: null });
    expect((await third.as.query(api.documents.get, { documentId: minutes }))!.access).toBe("write");
  });
});

describe("permanent deletion needs current access", () => {
  test("a creator who was removed or made view-only can't delete their old page for good", async () => {
    const t = setup();
    const w = await world(t, "perm");
    const page = await newPage(w.member, w.scope, "Member's page");
    const kid = await newPage(w.owner, w.scope, "Owner's sub-page", page);
    await w.member.as.mutation(api.documents.moveToTrash, { documentId: page });
    await w.owner.as.mutation(api.workspaces.changeRole, { workspaceId: w.workspaceId, profileId: w.member.profileId, role: "member", memberAccess: "view" });
    await expect(w.member.as.mutation(api.documents.deletePermanently, { documentId: page, confirmTitle: "Member's page" })).rejects.toThrow(/forbidden/);
    await w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    await expect(w.member.as.mutation(api.documents.deletePermanently, { documentId: page, confirmTitle: "Member's page" })).rejects.toThrow(/not_found/);
    await expect(w.member.as.mutation(api.documents.restoreFromTrash, { documentId: page })).rejects.toThrow(/not_found/);
    expect(await t.run(async (ctx) => (await ctx.db.query("deletionJobs").collect()).length)).toBe(0);
    // The owner still decides.
    await w.owner.as.mutation(api.documents.restoreFromTrash, { documentId: page });
    expect((await w.owner.as.query(api.documents.get, { documentId: kid }))!.access).toBe("manage");
    expect((await w.owner.as.query(api.documents.get, { documentId: page }))!.access).toBe("manage");
  });
});

describe("files", () => {
  test("a far-future clock can't mint a long-lived link, and one minted before is refused", async () => {
    const t = setup();
    const a = await person(t, "clock@example.com");
    const page = await newPage(a, PERSONAL, "Pictures");
    const fileId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", page)).unique())!;
      const publicId = ulid();
      await ctx.db.insert("files", { publicId, storageId, ownerProfileId: a.profileId as Id<"profiles">, documentId: doc._id, uploadedBy: a.profileId as Id<"profiles">, filename: "p.png", mimeType: "image/png", size: 3, sha256: "", kind: "image", status: "ready", createdAt: Date.now() });
      return publicId;
    });
    const urls = await a.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() + 50 * 365 * 86_400_000 });
    const exp = Number(new URL(urls[fileId]!.url, "https://x.test").searchParams.get("exp"));
    expect(exp).toBeLessThan(Date.now() + 4 * 3_600_000);
    const sig = new URL(urls[fileId]!.url, "https://x.test").searchParams.get("sig")!;
    expect(await verifyFileSignature(fileId, exp, sig)).toBe(true);
    // A link signed for decades from now (as the old code would have) no longer opens.
    const { signFileUrl } = await import("../../convex/lib/fileUrls");
    const far = Date.now() + 50 * 365 * 86_400_000;
    expect(await verifyFileSignature(fileId, far, await signFileUrl(`${fileId}:${far}`))).toBe(false);
  });

  test("a workspace export goes only to the person who made it", async () => {
    const t = setup();
    const w = await world(t, "zip");
    await newPage(w.owner, w.scope, "Plans");
    const { url } = await w.owner.as.action(api.exports.exportScope, { scope: w.scope });
    const fileId = /\/files\/([0-9A-Z]{26})/.exec(url)![1]!;
    expect(Object.keys(await w.owner.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() }))).toEqual([fileId]);
    expect(await w.member.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() })).toEqual({});
    expect(await w.guest.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() })).toEqual({});
  });
});

describe("a workspace scheduled for deletion", () => {
  test("its public links stop working and its billing can't be revived; canceling the plan still works", async () => {
    const t = setup();
    const w = await world(t, "closing");
    const page = await newPage(w.owner, w.scope, "Public roadmap");
    const { token } = await w.owner.as.mutation(api.sharing.createPublicLink, { documentId: page });
    const open = () => t.mutation(api.sharing.openPublicLink, { token, serverSecret: "a".repeat(64), clientKey: "client-closing" });
    expect((await open()).status).toBe("ok");
    await w.owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: w.workspaceId, planId: "workspace_team_monthly" });
    await w.owner.as.mutation(api.workspaces.scheduleDeletion, { workspaceId: w.workspaceId, confirmName: "closing team" });
    expect((await open()).status).toBe("not_found");
    await expect(w.owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: w.workspaceId, planId: "workspace_business_monthly" })).rejects.toThrow(/scheduled for deletion/);
    await expect(w.owner.as.action(api.workspaceBilling.resume, { workspaceId: w.workspaceId })).rejects.toThrow(/scheduled for deletion/);
    await w.owner.as.action(api.workspaceBilling.cancel, { workspaceId: w.workspaceId });
    // Canceling the deletion brings the link back.
    await w.owner.as.mutation(api.workspaces.cancelDeletion, { workspaceId: w.workspaceId });
    expect((await open()).status).toBe("ok");
  });
});

describe("AI in a workspace is for its members", () => {
  test("a guest on a Team workspace's page doesn't get the workspace's AI (nor does their Pro cover it)", async () => {
    const t = setup();
    const w = await world(t, "aig");
    await w.owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: w.workspaceId, planId: "workspace_team_monthly" });
    await w.guest.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const page = await newPage(w.owner, w.scope, "Brief");
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: w.guestEmail, role: "editor" });
    await expect(w.guest.as.mutation(internal.ai.begin, { scope: PERSONAL, documentId: page, noteOnly: true })).rejects.toThrow(/for members of this workspace/);
    await expect(w.guest.as.mutation(internal.ai.begin, { scope: PERSONAL, documentId: page })).rejects.toThrow(/for members of this workspace/);
    // Members get it; the guest's own Personal is covered by their Pro.
    await w.member.as.mutation(internal.ai.begin, { scope: w.scope, documentId: page, noteOnly: true });
    await w.guest.as.mutation(internal.ai.begin, { scope: PERSONAL });
  });
});

describe("link labels", () => {
  test("a link to a page you can't open doesn't learn its new title", async () => {
    const t = setup();
    const victim = await person(t, "label-victim@example.com");
    const snoop = await person(t, "label-snoop@example.com");
    const target = await newPage(victim, PERSONAL, "Old title");
    const mine = await newPage(snoop, PERSONAL, "Notes");
    const blockId = ulid();
    await push(snoop, [
      {
        opId: ulid(),
        kind: "block.upsert",
        documentId: mine,
        block: { ...para(blockId, ""), text: [{ type: "pageLink", documentId: target, label: "?" }] },
        baseRevision: null,
        fields: ["content", "position"],
      },
    ]);
    const doc = (await victim.as.query(api.documents.get, { documentId: target }))!;
    const [renamed] = await push(victim, [{ opId: ulid(), kind: "document.update", documentId: target, patch: { title: "Acquisition of Globex" }, baseRevision: doc.document.revision }]);
    expect(renamed!.status).toBe("applied");
    const blocks = (await snoop.as.query(api.blocks.list, { documentId: mine }))!;
    expect(JSON.stringify(blocks)).not.toMatch(/Globex/);
  });
});
