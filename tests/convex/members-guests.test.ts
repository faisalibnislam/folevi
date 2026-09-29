// Members vs guests (docs/ACCOUNT_MODEL_PLAN.md, Phase D). Numbers in test names are the specification's
// scenarios.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { normalizeMembership, requestedRole, type DocumentAccessInfo } from "../../convex/lib/auth";
import { canInviteGuest, canInviteMember, canManageMember, canManageWorkspace, memberCanManageBilling, sharePermissions } from "../../convex/lib/permissions";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid, verifyAccountModel, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.useRealTimers();
});

async function workspaceDbId(t: T, publicId: string): Promise<Id<"workspaces">> {
  return await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!._id);
}

async function newPage(p: Person, workspaceId: string, title = "Page", extra: { parentDocumentId?: string; folderId?: string } = {}) {
  const { id } = await p.as.mutation(api.documents.create, { scope: inWorkspace(workspaceId), title, ...extra });
  return id;
}

async function upsert(p: Person, documentId: string, text: string) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-guests",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] }],
  });
  return r!;
}

async function seats(p: Person, workspaceId: string) {
  const s = await p.as.query(api.workspaceBilling.summary, { workspaceId });
  return { seats: s.seats, guests: s.guests, pending: s.pendingInvites };
}

/** A workspace with an owner, an editing member and an outside person (not yet a guest). */
async function world(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const member = await person(t, `${prefix}-member@example.com`);
  const outsider = await person(t, `${prefix}-guest@example.com`);
  const { workspaceId } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, member, `${prefix}-member@example.com`, workspaceId, "editor");
  return { owner, member, outsider, workspaceId, guestEmail: `${prefix}-guest@example.com`, memberEmail: `${prefix}-member@example.com` };
}

// ---------------------------------------------------------------------------------------------------

describe("roles: owner | admin | member", () => {
  test("a member's access (edit / comment / view) decides what they can do; old role names from older clients are stored as Member + access", async () => {
    const t = setup();
    const owner = await person(t, "acc-owner@example.com");
    const c = await person(t, "acc-commenter@example.com");
    const vw = await person(t, "acc-viewer@example.com");
    const ed = await person(t, "acc-editor@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Access");
    const wsId = await workspaceDbId(t, workspaceId);
    const page = await newPage(owner, workspaceId, "Plan");
    // Invited with the old role names, as the paused Mac app still sends them.
    await join(t, owner, c, "acc-commenter@example.com", workspaceId, "commenter");
    await join(t, owner, vw, "acc-viewer@example.com", workspaceId, "viewer");
    await join(t, owner, ed, "acc-editor@example.com", workspaceId, "editor");
    await owner.as.mutation(api.workspaces.invite, { workspaceId, email: "later@example.com", role: "viewer" });
    const rows = await t.run(async (ctx) => (await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", wsId)).collect()).map((m) => [m.role, m.memberAccess ?? "edit"]));
    expect(rows.sort()).toEqual([["member", "comment"], ["member", "view"], ["member", "edit"], ["owner", "edit"]].sort());
    const invite = await t.run(async (ctx) => (await ctx.db.query("workspaceInvites").collect()).find((i) => i.email === "later@example.com")!);
    expect([invite.role, invite.memberAccess]).toEqual(["member", "view"]);

    const w = (await c.as.query(api.workspaces.mine, {}))[0]!;
    expect([w.role, w.memberAccess, w.canEdit]).toEqual(["member", "comment", false]);
    const v2 = (await vw.as.query(api.workspaces.mine, {}))[0]!;
    expect([v2.role, v2.memberAccess, v2.canEdit]).toEqual(["member", "view", false]);
    const e = (await ed.as.query(api.workspaces.mine, {}))[0]!;
    expect([e.role, e.memberAccess, e.canEdit]).toEqual(["member", "edit", true]);
    expect((await c.as.query(api.documents.get, { documentId: page }))!.access).toBe("comment");
    expect((await vw.as.query(api.documents.get, { documentId: page }))!.access).toBe("read");
    expect((await ed.as.query(api.documents.get, { documentId: page }))!.access).toBe("write");
    await expect(vw.as.mutation(api.documents.create, { scope: inWorkspace(workspaceId), title: "Nope" })).rejects.toThrow(/permission/);
    // Every membership role is a seat.
    expect((await seats(owner, workspaceId)).seats).toBe(4);
    // The data passes the account-model integrity check.
    const report = await verifyAccountModel(t);
    expect(report.ok).toBe(true);
  });

  test("invitations and role changes use Member (with access) and Admin; old names from older clients still work", async () => {
    const t = setup();
    const owner = await person(t, "inv-owner@example.com");
    const a = await person(t, "inv-a@example.com");
    const b = await person(t, "inv-b@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Invites");
    await owner.as.mutation(api.workspaces.invite, { workspaceId, email: "inv-a@example.com", role: "member", memberAccess: "comment" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId, email: "inv-b@example.com", role: "viewer" });
    const roster = await owner.as.query(api.workspaces.members, { workspaceId });
    expect(roster.invites.map((i) => [i.email, i.role, i.memberAccess]).sort()).toEqual([
      ["inv-a@example.com", "member", "comment"],
      ["inv-b@example.com", "member", "view"],
    ]);
    for (const [p, email] of [[a, "inv-a@example.com"], [b, "inv-b@example.com"]] as const) {
      const id = roster.invites.find((i) => i.email === email)!.id;
      await p.as.mutation(api.workspaces.acceptInvite, { inviteId: id });
    }
    const stored = await t.run(async (ctx) => (await ctx.db.query("workspaceMembers").collect()).map((m) => m.role));
    expect(stored).not.toContain("viewer");
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId, profileId: a.profileId, role: "member", memberAccess: "edit" });
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId, profileId: b.profileId, role: "admin" });
    const after = await owner.as.query(api.workspaces.members, { workspaceId });
    expect(after.members.find((m) => m.profileId === a.profileId)).toMatchObject({ role: "member", memberAccess: "edit" });
    expect(after.members.find((m) => m.profileId === b.profileId)).toMatchObject({ role: "admin" });
    // An admin can't make admins, change another admin, or change their own role.
    await expect(b.as.mutation(api.workspaces.changeRole, { workspaceId, profileId: a.profileId, role: "admin" })).rejects.toThrow(/owner/);
    await expect(b.as.mutation(api.workspaces.invite, { workspaceId, email: "x@example.com", role: "admin" })).rejects.toThrow(/owner/);
    await b.as.mutation(api.workspaces.changeRole, { workspaceId, profileId: a.profileId, role: "member", memberAccess: "view" });
    // Members can see the list but not manage it.
    const asMember = await a.as.query(api.workspaces.members, { workspaceId });
    expect(asMember.members.length).toBe(3);
    expect(asMember.invites).toEqual([]);
    expect(asMember.seats).toBeNull();
    expect(asMember.guests).toBeNull();
    await expect(a.as.mutation(api.workspaces.invite, { workspaceId, email: "y@example.com", role: "member" })).rejects.toThrow(/owner and admins/);
    await expect(a.as.mutation(api.workspaces.rename, { workspaceId, name: "Mine now" })).rejects.toThrow(/owner and admins/);
    await expect(a.as.query(api.workspaces.guests, { workspaceId })).rejects.toThrow(/owner and admins/);
  });

  test("permission helpers: the role matrix", () => {
    const owner = { role: "owner" as const };
    const admin = { role: "admin" as const };
    const billingAdmin = { role: "admin" as const, canManageBilling: true };
    const member = { role: "member" as const };
    const viewOnly = { role: "member" as const, memberAccess: "view" as const };
    const commentOnly = { role: "member" as const, memberAccess: "comment" as const };
    expect([owner, admin, member, viewOnly, commentOnly, null].map(canManageWorkspace)).toEqual([true, true, false, false, false, false]);
    expect([owner, admin, member, viewOnly, commentOnly, null].map((m) => canInviteGuest(m))).toEqual([true, true, true, false, false, false]);
    expect([owner, admin, billingAdmin, member, null].map(memberCanManageBilling)).toEqual([true, false, true, false, false]);
    expect(canInviteMember(owner, "admin")).toBe(true);
    expect(canInviteMember(admin, "admin")).toBe(false);
    expect(canInviteMember(admin, "member")).toBe(true);
    expect(canInviteMember(member, "member")).toBe(false);
    expect(canManageMember(owner, admin)).toBe(true);
    expect(canManageMember(admin, admin)).toBe(false);
    expect(canManageMember(admin, member)).toBe(true);
    expect(canManageMember(admin, owner)).toBe(false);
    expect(canManageMember(owner, owner)).toBe(false);
    expect(canManageMember(member, viewOnly)).toBe(false);
    expect(normalizeMembership({ role: "member" })).toEqual({ role: "member", memberAccess: "edit" });
    expect(normalizeMembership({ role: "member", memberAccess: "comment" })).toEqual({ role: "member", memberAccess: "comment" });
    expect(normalizeMembership({ role: "admin", memberAccess: "view" })).toEqual({ role: "admin", memberAccess: "edit" });
    expect(requestedRole("viewer")).toEqual({ role: "member", memberAccess: "view" });
    expect(requestedRole("member", "comment")).toEqual({ role: "member", memberAccess: "comment" });
    const m = (x: object) => ({ _id: "m", workspaceId: "w", profileId: "p", joinedAt: 0, _creationTime: 0, ...x }) as never;
    const info = (access: DocumentAccessInfo["access"], member: object | null, restricted = false, inScope = true): DocumentAccessInfo => ({ access, inScope, member: member ? m(member) : null, restricted });
    expect(sharePermissions(info("manage", admin))).toEqual({ manage: true, share: true });
    expect(sharePermissions(info("write", member))).toEqual({ manage: false, share: true });
    expect(sharePermissions(info("write", member, true))).toEqual({ manage: false, share: false });
    expect(sharePermissions(info("read", viewOnly))).toEqual({ manage: false, share: false });
    // A guest with an edit grant never shares.
    expect(sharePermissions(info("write", null, false, false))).toEqual({ manage: false, share: false });
  });
});

describe("guests see only what was shared with them", () => {
  test("8, 9, 10: a guest edits a granted page, can't open other pages by URL, and takes no seat", async () => {
    const t = setup();
    const w = await world(t, "g8");
    const shared = await newPage(w.owner, w.workspaceId, "Shared plan");
    const other = await newPage(w.owner, w.workspaceId, "Internal budget");
    expect(await w.owner.as.mutation(api.sharing.grant, { documentId: shared, email: w.guestEmail, role: "editor" })).toEqual({ status: "shared" });
    expect((await upsert(w.outsider, shared, "Guest line")).status).toBe("applied");
    expect((await w.outsider.as.query(api.documents.get, { documentId: shared }))!.access).toBe("write");
    // 9: by URL, another page of the same workspace is "not found".
    expect(await w.outsider.as.query(api.documents.get, { documentId: other })).toBeNull();
    expect(await w.outsider.as.query(api.blocks.list, { documentId: other })).toBeNull();
    expect((await upsert(w.outsider, other, "Sneaky")).status).not.toBe("applied");
    await expect(w.outsider.as.query(api.sharing.get, { documentId: other })).rejects.toThrow(/not found/);
    // No workspace-wide lists.
    await expect(w.outsider.as.query(api.documents.list, { scope: inWorkspace(w.workspaceId), view: "all", paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(/Workspace not found/);
    await expect(w.outsider.as.query(api.workspaces.members, { workspaceId: w.workspaceId })).rejects.toThrow(/Workspace not found/);
    await expect(w.outsider.as.action(api.exports.exportScope, { scope: inWorkspace(w.workspaceId) })).rejects.toThrow(/Workspace not found/);
    expect(await w.outsider.as.query(api.workspaces.mine, {})).toEqual([]);
    // 10: guests take no seat.
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 2, guests: 1, pending: 0 });
  });

  test("31: a guest's search never reaches the workspace (they find shared pages in Shared with Me)", async () => {
    const t = setup();
    const w = await world(t, "g31");
    const shared = await newPage(w.owner, w.workspaceId, "Seed catalogue");
    await newPage(w.owner, w.workspaceId, "Seed budget");
    await w.owner.as.mutation(api.sharing.grant, { documentId: shared, email: w.guestEmail, role: "viewer" });
    await expect(w.outsider.as.query(api.search.documents, { scope: inWorkspace(w.workspaceId), query: "Seed" })).rejects.toThrow(/Workspace not found/);
    // Their own Personal search never includes the workspace's pages either.
    const mine = await w.outsider.as.query(api.search.documents, { scope: PERSONAL, query: "Seed" });
    expect(mine.map((r) => r.title)).not.toContain("Seed budget");
    expect(mine.map((r) => r.title)).not.toContain("Seed catalogue");
    const sharedWithMe = await w.outsider.as.query(api.sharing.sharedWithMe, {});
    expect(sharedWithMe.map((d) => d.title)).toEqual(["Seed catalogue"]);
  });

  test("a guest learns no member names, folder or tag names, or other grant holders", async () => {
    const t = setup();
    const w = await world(t, "leak");
    const other = await person(t, "leak-other@example.com");
    const { id: folderId } = await w.owner.as.mutation(api.organization.createFolder, { scope: inWorkspace(w.workspaceId), name: "Secret project" });
    const { id: tagId } = await w.owner.as.mutation(api.organization.createTag, { scope: inWorkspace(w.workspaceId), name: "acquisition" });
    const page = await newPage(w.owner, w.workspaceId, "Shared", { folderId });
    await w.owner.as.mutation(api.organization.setDocumentTags, { documentId: page, tagIds: [tagId] });
    const { collectionId } = await w.owner.as.mutation(api.collections.create, { documentId: page, name: "Tracker" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: w.guestEmail, role: "viewer" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: "leak-other@example.com", role: "viewer" });

    // Members still see all of it.
    const asMember = (await w.member.as.query(api.documents.get, { documentId: page }))!;
    expect(asMember.folder?.name).toBe("Secret project");
    expect(asMember.document.tags.map((x) => x.name)).toEqual(["acquisition"]);

    const got = (await w.outsider.as.query(api.documents.get, { documentId: page }))!;
    expect(got.folder).toBeNull();
    expect(got.document.tags).toEqual([]);
    expect(got.document.homeFolder).toBeNull();
    expect(got.document.folderId).toBeNull();
    expect(got.isMember).toBe(false);
    expect(JSON.stringify(got)).not.toMatch(/Secret project|acquisition/);

    // Collections: people relevant to the page only (its creator, the people it's shared with) — not the member list.
    const coll = await w.outsider.as.query(api.collections.get, { collectionId });
    const names = coll.people.map((p) => p.name);
    expect(names).toContain("leak-owner");
    expect(names).not.toContain("leak-member");
    const memberView = await w.member.as.query(api.collections.get, { collectionId });
    expect(memberView.people.map((p) => p.name)).toContain("leak-member");

    // Share dialog: only themselves, the owner and who shared it.
    const share = await w.outsider.as.query(api.sharing.get, { documentId: page });
    expect(share.youAreGuest).toBe(true);
    expect(share.people.map((p) => p.displayName)).toEqual(["leak-guest"]);
    expect(share.sharedBy).toBe("leak-owner");
    expect(share.ownerName).toBe("leak-owner");
    expect(share.canShare).toBe(false);
    expect(share.pendingInvites).toEqual([]);
    expect(JSON.stringify(share)).not.toMatch(/leak-other/);
    // A member sees everyone it's shared with, marked as guests.
    const memberShare = await w.member.as.query(api.sharing.get, { documentId: page });
    expect(memberShare.people.map((p) => [p.displayName, p.guest]).sort()).toEqual([
      ["leak-guest", true],
      ["leak-other", true],
    ]);
    void other;
  });
});

describe("sharing by members", () => {
  test("members who can edit share pages with guests (up to Can edit); managers keep access mode and links", async () => {
    const t = setup();
    const w = await world(t, "ms");
    const viewer = await person(t, "ms-viewer@example.com");
    await w.owner.as.mutation(api.workspaces.invite, { workspaceId: w.workspaceId, email: "ms-viewer@example.com", role: "member", memberAccess: "view" });
    const inv = (await w.owner.as.query(api.workspaces.members, { workspaceId: w.workspaceId })).invites[0]!;
    await viewer.as.mutation(api.workspaces.acceptInvite, { inviteId: inv.id });
    const page = await newPage(w.owner, w.workspaceId, "Roadmap");

    expect(await w.member.as.mutation(api.sharing.grant, { documentId: page, email: w.guestEmail, role: "editor" })).toEqual({ status: "shared" });
    expect((await w.outsider.as.query(api.documents.get, { documentId: page }))!.access).toBe("write");
    const s = await w.member.as.query(api.sharing.get, { documentId: page });
    expect([s.canShare, s.canManage, s.maxRole]).toEqual([true, false, "editor"]);
    expect(s.links).toEqual([]);
    await expect(w.member.as.mutation(api.sharing.setAccessMode, { documentId: page, mode: "restricted" })).rejects.toThrow(/permission/);
    await expect(w.member.as.mutation(api.sharing.createPublicLink, { documentId: page })).rejects.toThrow(/permission/);
    // View-only members don't share.
    await expect(viewer.as.mutation(api.sharing.grant, { documentId: page, email: "someone@example.com", role: "viewer" })).rejects.toThrow(/edit/);
    // A grant made by the owner can't be changed or removed by a member; their own can.
    const other = await person(t, "ms-other@example.com");
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: "ms-other@example.com", role: "viewer" });
    await expect(w.member.as.mutation(api.sharing.grant, { documentId: page, email: "ms-other@example.com", role: "editor" })).rejects.toThrow(/Someone else/);
    await expect(w.member.as.mutation(api.sharing.revoke, { documentId: page, profileId: other.profileId })).rejects.toThrow(/admin/);
    await w.member.as.mutation(api.sharing.revoke, { documentId: page, profileId: w.outsider.profileId });
    expect(await w.outsider.as.query(api.documents.get, { documentId: page })).toBeNull();
    // Restricted pages are shared only by their managers.
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: page, mode: "restricted" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: w.memberEmail, role: "editor" });
    await expect(w.member.as.mutation(api.sharing.grant, { documentId: page, email: w.guestEmail, role: "viewer" })).rejects.toThrow(/restricted/);
    // Guests never share.
    const page2 = await newPage(w.owner, w.workspaceId, "Notes");
    await w.owner.as.mutation(api.sharing.grant, { documentId: page2, email: w.guestEmail, role: "editor" });
    await expect(w.outsider.as.mutation(api.sharing.grant, { documentId: page2, email: "friend@example.com", role: "viewer" })).rejects.toThrow(/edit/);
  });
});

describe("page invitations (sharing with an address that has no account)", () => {
  test("pending grants nothing and costs nothing; the new account is told and accepting creates the grant", async () => {
    const t = setup();
    const w = await world(t, "pi");
    const page = await newPage(w.owner, w.workspaceId, "Launch plan");
    const other = await newPage(w.owner, w.workspaceId, "Other");
    expect(await w.member.as.mutation(api.sharing.grant, { documentId: page, email: "Newcomer@Example.com", role: "commenter" })).toEqual({ status: "invited" });
    const dialog = await w.member.as.query(api.sharing.get, { documentId: page });
    expect(dialog.pendingInvites.map((i) => [i.email, i.role])).toEqual([["newcomer@example.com", "commenter"]]);
    // Not billed, and not a guest yet.
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 2, guests: 0, pending: 0 });
    const guestsList = await w.owner.as.query(api.workspaces.guests, { workspaceId: w.workspaceId });
    expect(guestsList.guests).toEqual([]);
    expect(guestsList.pendingInvites.map((i) => i.email)).toEqual(["newcomer@example.com"]);
    // The email goes to the address (no account yet): the share email with an accept link.
    const email = await t.run(async (ctx) => (await ctx.db.query("pageInvites").collect())[0]!);
    expect(email.tokenHash).not.toContain("newcomer");

    const newcomer = await person(t, "newcomer@example.com");
    expect(await newcomer.as.query(api.documents.get, { documentId: page })).toBeNull();
    const notes = await newcomer.as.query(api.notifications.list, {});
    const notice = notes.find((n) => n.pageInviteId);
    expect(notice?.title).toMatch(/pi-member shared “Launch plan” with you/);
    await newcomer.as.mutation(api.sharing.acceptPageInvite, { inviteId: notice!.pageInviteId! });
    expect((await newcomer.as.query(api.documents.get, { documentId: page }))!.access).toBe("comment");
    expect(await newcomer.as.query(api.documents.get, { documentId: other })).toBeNull();
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 2, guests: 1, pending: 0 });
    // Used once.
    await expect(newcomer.as.mutation(api.sharing.acceptPageInvite, { inviteId: notice!.pageInviteId! })).rejects.toThrow(/no longer valid/);
  });

  test("another address can't accept; revoked and expired invitations don't work; a removed inviter's invitation dies", async () => {
    const t = setup();
    const w = await world(t, "pj");
    const page = await newPage(w.owner, w.workspaceId, "Plan");
    const token = async (email?: string) => {
      // The raw token only travels in the email; tests accept by invitation id (what the in-app notice uses).
      const row = await t.run(async (ctx) => (await ctx.db.query("pageInvites").collect()).find((i) => i.status === "pending" && (!email || i.email === email))!);
      return row.publicId;
    };
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: "pj-new@example.com", role: "viewer" });
    const stranger = await person(t, "pj-stranger@example.com");
    await expect(stranger.as.mutation(api.sharing.acceptPageInvite, { inviteId: await token() })).rejects.toThrow(/different email/);
    // Revoke.
    await w.owner.as.mutation(api.sharing.revokePageInvite, { inviteId: await token() });
    const invited = await person(t, "pj-new@example.com");
    const revokedId = await t.run(async (ctx) => (await ctx.db.query("pageInvites").collect())[0]!.publicId);
    await expect(invited.as.mutation(api.sharing.acceptPageInvite, { inviteId: revokedId })).rejects.toThrow(/no longer valid/);
    // Expiry.
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: "pj-late@example.com", role: "viewer" });
    const lateId = await token();
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("pageInvites").collect()).find((i) => i.publicId === lateId)!;
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    const late = await person(t, "pj-late@example.com");
    await expect(late.as.mutation(api.sharing.acceptPageInvite, { inviteId: lateId })).rejects.toThrow(/expired/);
    expect(await late.as.query(api.documents.get, { documentId: page })).toBeNull();
    // An invitation from a member who is then removed grants nothing.
    await w.member.as.mutation(api.sharing.grant, { documentId: page, email: "pj-via-member@example.com", role: "editor" });
    const viaMember = await token("pj-via-member@example.com");
    await w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    const p = await person(t, "pj-via-member@example.com");
    await expect(p.as.mutation(api.sharing.acceptPageInvite, { inviteId: viaMember })).rejects.toThrow(/no longer valid/);
    expect(await p.as.query(api.documents.get, { documentId: page })).toBeNull();
  });

  test("the emailed link: preview shows the page only to the invited address, and accepting by token works", async () => {
    const t = setup();
    const owner = await person(t, "tok-owner@example.com");
    const { id: page } = await owner.as.mutation(api.documents.create, { scope: PERSONAL, title: "Recipes" });
    await owner.as.mutation(api.sharing.grant, { documentId: page, email: "tok-friend@example.com", role: "viewer" });
    // The share email carries the accept link (the raw token exists only there).
    const sent = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((f) => f.args[0] as { key?: string; to?: string; dataVariables?: Record<string, string> }));
    const mail = sent.find((a) => a.key === "share_notification" && a.to === "tok-friend@example.com")!;
    expect(mail.dataVariables!.role).toBe("Can view");
    const token = /\/share-invite\/([A-Za-z0-9_-]+)$/.exec(mail.dataVariables!.documentUrl!)![1]!;
    const stranger = await person(t, "tok-stranger@example.com");
    expect(await stranger.as.query(api.sharing.previewPageInvite, { token })).toMatchObject({ valid: true, emailMatches: false, title: null });
    const friend = await person(t, "tok-friend@example.com");
    expect(await friend.as.query(api.sharing.previewPageInvite, { token })).toMatchObject({ valid: true, emailMatches: true, title: "Recipes", roleLabel: "Can view" });
    expect(await friend.as.mutation(api.sharing.acceptPageInvite, { token })).toEqual({ documentId: page });
    expect((await friend.as.query(api.documents.get, { documentId: page }))!.access).toBe("read");
    expect(await friend.as.query(api.sharing.previewPageInvite, { token })).toEqual({ valid: false });
  });

  test("sharing from Personal with a new address works the same way", async () => {
    const t = setup();
    const owner = await person(t, "pp-owner@example.com");
    const { id: page } = await owner.as.mutation(api.documents.create, { scope: PERSONAL, title: "Garden" });
    expect(await owner.as.mutation(api.sharing.grant, { documentId: page, email: "pp-friend@example.com", role: "editor" })).toEqual({ status: "invited" });
    const friend = await person(t, "pp-friend@example.com");
    const inviteId = (await friend.as.query(api.notifications.list, {})).find((n) => n.pageInviteId)!.pageInviteId!;
    await friend.as.mutation(api.sharing.acceptPageInvite, { inviteId });
    expect((await friend.as.query(api.documents.get, { documentId: page }))!.access).toBe("write");
  });
});

describe("member ↔ guest", () => {
  test("16: a member made a guest loses the seat and keeps pages they created or were given (never restricted content)", async () => {
    const t = setup();
    const w = await world(t, "m2g");
    const created = await newPage(w.member, w.workspaceId, "Member's notes");
    const secretChild = await newPage(w.member, w.workspaceId, "Private child", { parentDocumentId: undefined });
    const parentWithSecret = await newPage(w.member, w.workspaceId, "Parent");
    const restrictedKid = await newPage(w.owner, w.workspaceId, "Board only", { parentDocumentId: parentWithSecret });
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: restrictedKid, mode: "restricted" });
    const ownersPage = await newPage(w.owner, w.workspaceId, "Owner's page");
    const given = await newPage(w.owner, w.workspaceId, "Given");
    await w.owner.as.mutation(api.sharing.grant, { documentId: given, email: w.memberEmail, role: "commenter" });
    expect((await seats(w.owner, w.workspaceId)).seats).toBe(2);

    const r = await w.owner.as.mutation(api.workspaces.convertMemberToGuest, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    expect(r.granted).toBe(2);
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 1, guests: 1, pending: 0 });
    expect(await w.member.as.query(api.workspaces.mine, {})).toEqual([]);
    expect((await w.member.as.query(api.documents.get, { documentId: created }))!.access).toBe("write");
    expect((await w.member.as.query(api.documents.get, { documentId: secretChild }))!.access).toBe("write");
    expect((await w.member.as.query(api.documents.get, { documentId: given }))!.access).toBe("comment");
    // No grant on a page whose subtree holds a restricted page; nothing else.
    expect(await w.member.as.query(api.documents.get, { documentId: parentWithSecret })).toBeNull();
    expect(await w.member.as.query(api.documents.get, { documentId: restrictedKid })).toBeNull();
    expect(await w.member.as.query(api.documents.get, { documentId: ownersPage })).toBeNull();
    // Listed as a guest; the owner can't be made one.
    const list = await w.owner.as.query(api.workspaces.guests, { workspaceId: w.workspaceId });
    expect(list.guests.map((g) => g.displayName)).toEqual(["m2g-member"]);
    await expect(w.owner.as.mutation(api.workspaces.convertMemberToGuest, { workspaceId: w.workspaceId, profileId: w.owner.profileId })).rejects.toThrow(/yourself/);
  });

  test("17: a guest invited to become a member takes a seat only once they accept, and keeps their pages", async () => {
    const t = setup();
    const w = await world(t, "g2m");
    const page = await newPage(w.owner, w.workspaceId, "Shared");
    await w.owner.as.mutation(api.sharing.grant, { documentId: page, email: w.guestEmail, role: "editor" });
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 2, guests: 1, pending: 0 });
    await w.owner.as.mutation(api.workspaces.convertGuestToMember, { workspaceId: w.workspaceId, profileId: w.outsider.profileId });
    // Pending: still a guest, no seat.
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 2, guests: 1, pending: 1 });
    const inviteId = (await w.outsider.as.query(api.notifications.list, {})).find((n) => n.inviteId)!.inviteId!;
    await w.outsider.as.mutation(api.workspaces.acceptInvite, { inviteId });
    expect(await seats(w.owner, w.workspaceId)).toEqual({ seats: 3, guests: 0, pending: 0 });
    expect((await w.outsider.as.query(api.workspaces.mine, {}))[0]).toMatchObject({ role: "member", memberAccess: "edit" });
    expect((await w.outsider.as.query(api.documents.get, { documentId: page }))!.access).toBe("write");
  });

  test("guests list: change access per page, remove from the workspace", async () => {
    const t = setup();
    const w = await world(t, "gl");
    const a = await newPage(w.owner, w.workspaceId, "A");
    const b = await newPage(w.owner, w.workspaceId, "B");
    await w.owner.as.mutation(api.sharing.grant, { documentId: a, email: w.guestEmail, role: "viewer" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: b, email: w.guestEmail, role: "editor" });
    const list = await w.owner.as.query(api.workspaces.guests, { workspaceId: w.workspaceId });
    expect(list.guests[0]!.pages.map((p) => [p.title, p.role])).toEqual([
      ["A", "viewer"],
      ["B", "editor"],
    ]);
    await w.owner.as.mutation(api.workspaces.setGuestAccess, { workspaceId: w.workspaceId, profileId: w.outsider.profileId, documentId: a, role: "commenter" });
    expect((await w.outsider.as.query(api.documents.get, { documentId: a }))!.access).toBe("comment");
    // Members can't manage guests; a member isn't a guest.
    await expect(w.member.as.mutation(api.workspaces.removeGuest, { workspaceId: w.workspaceId, profileId: w.outsider.profileId })).rejects.toThrow(/owner and admins/);
    await expect(w.owner.as.mutation(api.workspaces.removeGuest, { workspaceId: w.workspaceId, profileId: w.member.profileId })).rejects.toThrow(/Guest not found/);
    await w.owner.as.mutation(api.workspaces.removeGuest, { workspaceId: w.workspaceId, profileId: w.outsider.profileId });
    expect(await w.outsider.as.query(api.documents.get, { documentId: a })).toBeNull();
    expect(await w.outsider.as.query(api.documents.get, { documentId: b })).toBeNull();
    expect((await w.owner.as.query(api.workspaces.guests, { workspaceId: w.workspaceId })).guests).toEqual([]);
  });

  test("27: removing a member never touches their Personal or their own subscription", async () => {
    const t = setup();
    const w = await world(t, "rm27");
    await w.member.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const { id: mine } = await w.member.as.mutation(api.documents.create, { scope: PERSONAL, title: "My diary" });
    const planBefore = (await w.member.as.query(api.billing.mine, {})).plan;
    await w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    expect((await w.member.as.query(api.documents.get, { documentId: mine }))!.access).toBe("manage");
    expect((await w.member.as.query(api.billing.mine, {})).plan).toEqual(planBefore);
    expect(await w.member.as.query(api.workspaces.mine, {})).toEqual([]);
  });
});

describe("settings by role", () => {
  test("members can't export the whole workspace; owners and admins can", async () => {
    const t = setup();
    const w = await world(t, "exp");
    await expect(w.member.as.action(api.exports.exportScope, { scope: inWorkspace(w.workspaceId) })).rejects.toThrow(/owner and admins/);
  });

  test("the sole owner can't leave: transfer ownership or delete the workspace", async () => {
    const t = setup();
    const w = await world(t, "leave");
    await expect(w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.owner.profileId })).rejects.toThrow(/Transfer ownership .* or delete the workspace/);
    await w.member.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    expect(await w.member.as.query(api.workspaces.mine, {})).toEqual([]);
  });
});

describe("deleting a workspace", () => {
  test("owner only, typed name; hidden from members, read-only for the owner, cancelable", async () => {
    const t = setup();
    const w = await world(t, "delws");
    const page = await newPage(w.owner, w.workspaceId, "Notes");
    await w.owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: w.workspaceId, planId: "workspace_team_monthly" });
    await expect(w.member.as.mutation(api.workspaces.scheduleDeletion, { workspaceId: w.workspaceId, confirmName: "delws team" })).rejects.toThrow(/permission/);
    await expect(w.owner.as.mutation(api.workspaces.scheduleDeletion, { workspaceId: w.workspaceId, confirmName: "wrong" })).rejects.toThrow(/name exactly/);
    await w.owner.as.mutation(api.workspaces.scheduleDeletion, { workspaceId: w.workspaceId, confirmName: "delws team" });
    // Members are told and lose it; the owner still sees it, read-only.
    const notes = await w.member.as.query(api.notifications.list, {});
    expect(notes.some((n) => /scheduled “delws team” for deletion/.test(n.title))).toBe(true);
    expect(await w.member.as.query(api.workspaces.mine, {})).toEqual([]);
    expect(await w.member.as.query(api.documents.get, { documentId: page })).toBeNull();
    const own = (await w.owner.as.query(api.workspaces.mine, {}))[0]!;
    expect(own.deletionScheduledFor).not.toBeNull();
    expect(own.canEdit).toBe(false);
    expect((await w.owner.as.query(api.documents.get, { documentId: page }))!.access).toBe("read");
    await expect(w.owner.as.mutation(api.workspaces.rename, { workspaceId: w.workspaceId, name: "Back" })).rejects.toThrow(/scheduled for deletion/);
    await expect(w.owner.as.mutation(api.documents.create, { scope: inWorkspace(w.workspaceId), title: "New" })).rejects.toThrow(/scheduled for deletion/);
    // The plan stops renewing.
    const wsId = await workspaceDbId(t, w.workspaceId);
    const row = await t.run(async (ctx) => ctx.db.query("subscriptions").withIndex("by_workspace", (q) => q.eq("workspaceId", wsId)).first());
    expect(row?.cancelAtPeriodEnd).toBe(true);
    // Cancel: back for everyone.
    await w.owner.as.mutation(api.workspaces.cancelDeletion, { workspaceId: w.workspaceId });
    expect((await w.member.as.query(api.workspaces.mine, {})).length).toBe(1);
    expect((await w.member.as.query(api.documents.get, { documentId: page }))!.access).toBe("write");
    const jobs = await t.run(async (ctx) => ctx.db.query("deletionJobs").collect());
    expect(jobs.map((j) => j.status)).toEqual(["canceled"]);
  });

  test("after the grace period the workspace and its content are purged", async () => {
    const t = setup();
    const w = await world(t, "purge");
    const page = await newPage(w.owner, w.workspaceId, "Notes");
    await upsert(w.owner, page, "content");
    await w.owner.as.mutation(api.workspaces.scheduleDeletion, { workspaceId: w.workspaceId, confirmName: "purge team" });
    const wsId = await workspaceDbId(t, w.workspaceId);
    await t.run(async (ctx) => {
      for (const j of await ctx.db.query("deletionJobs").collect()) await ctx.db.patch(j._id, { scheduledFor: Date.now() - 1 });
    });
    for (let i = 0; i < 6; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const left = await t.run(async (ctx) => ({
      workspace: await ctx.db.get(wsId),
      docs: (await ctx.db.query("documents").collect()).filter((d) => d.workspaceId === wsId).length,
      members: (await ctx.db.query("workspaceMembers").collect()).filter((m) => m.workspaceId === wsId).length,
      job: (await ctx.db.query("deletionJobs").collect())[0]!.status,
    }));
    expect(left).toEqual({ workspace: null, docs: 0, members: 0, job: "completed" });
    // The members' own Personal is untouched.
    expect((await w.member.as.query(api.documents.recentNotes, { scope: PERSONAL })).length).toBeGreaterThan(0);
  });
});

describe("deleting an account", () => {
  test("blocked while you own a workspace other people use; allowed after transferring it; a solo workspace goes with the account", async () => {
    const t = setup();
    const w = await world(t, "acct");
    const { workspaceId: solo } = await teamWorkspace(w.owner, "Just me");
    const soloId = await workspaceDbId(t, solo);
    const blockers = await w.owner.as.query(api.users.deletionBlockers, {});
    expect(blockers.workspaces.map((b) => b.name)).toEqual(["acct team"]);
    await expect(w.owner.as.mutation(api.users.requestAccountDeletion, { confirmEmail: "acct-owner@example.com" })).rejects.toThrow(/Transfer ownership/);
    await w.owner.as.mutation(api.workspaces.transferOwnership, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    expect((await w.owner.as.query(api.users.deletionBlockers, {})).workspaces).toEqual([]);
    await w.owner.as.mutation(api.users.requestAccountDeletion, { confirmEmail: "acct-owner@example.com" });
    await t.run(async (ctx) => {
      for (const j of await ctx.db.query("deletionJobs").collect()) await ctx.db.patch(j._id, { scheduledFor: Date.now() - 1 });
    });
    for (let i = 0; i < 12; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const state = await t.run(async (ctx) => ({ solo: await ctx.db.get(soloId), team: await ctx.db.get(await (async () => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", w.workspaceId)).unique())!._id)()) }));
    expect(state.solo).toBeNull();
    expect(state.team?.ownerId).toBe(w.member.profileId);
    expect((await w.member.as.query(api.workspaces.mine, {}))[0]!.role).toBe("owner");
  });
});
