// Folder sharing (docs/SHARING.md): a folder shared with people and roles; every note inside (subfolders
// too, notes added later) follows the folder, moving a note out takes the access away, the highest of a
// note grant and a folder grant wins, and the device copy's shared feed keeps exactly what is still shared.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

async function create(p: Person, title: string, extra: { folderId?: string | null; parentDocumentId?: string | null } = {}, scope: ScopeArg = PERSONAL) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-folder-share",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: extra.parentDocumentId ?? null, folderId: extra.folderId ?? null, kind: "document", title, icon: null } as never }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function write(p: Person, documentId: string, text: string, scope: ScopeArg = PERSONAL) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-folder-share",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] }],
  });
  return r!;
}

const accessOf = async (p: Person, documentId: string) => (await p.as.query(api.documents.get, { documentId }))?.access ?? "none";

async function folder(p: Person, name: string, parentFolderId?: string, scope: ScopeArg = PERSONAL) {
  return (await p.as.mutation(api.organization.createFolder, { scope, name, ...(parentFolderId ? { parentFolderId } : {}) })).id;
}

const sharedIds = async (p: Person) => (await p.as.query(api.sync.sharedManifest, {})).notes.map((n) => n.id);

// The first test pays for loading the backend modules.
describe("folder sharing: notes follow the folder", { timeout: 30_000 }, () => {
  test("a viewer reads every note inside, nested folders and pages too, notes added later; nothing outside", async () => {
    const t = setup();
    const a = await person(t, "fs-owner@example.com");
    const b = await person(t, "fs-viewer@example.com");
    const projects = await folder(a, "Projects");
    const inner = await folder(a, "Inner", projects);
    const deepest = await folder(a, "Deepest", inner);
    const plan = await create(a, "Plan", { folderId: projects });
    const sub = await create(a, "Plan details", { parentDocumentId: plan });
    const nested = await create(a, "Inner note", { folderId: deepest });
    const outside = await create(a, "Diary");
    const sibling = await folder(a, "Sibling");
    const elsewhere = await create(a, "Elsewhere", { folderId: sibling });

    expect(await a.as.mutation(api.folderSharing.grant, { folderId: projects, email: "fs-viewer@example.com", role: "viewer" })).toEqual({ status: "shared" });
    expect(await accessOf(b, plan)).toBe("read");
    expect(await accessOf(b, sub)).toBe("read");
    expect(await accessOf(b, nested)).toBe("read");
    expect(await accessOf(b, outside)).toBe("none");
    expect(await accessOf(b, elsewhere)).toBe("none");
    // Read only: writing is refused per operation.
    expect((await write(b, plan, "nope")).error?.code).toBe("forbidden");
    expect(await b.as.query(api.blocks.list, { documentId: plan })).not.toBeNull();

    // A note added later is shared at once.
    const later = await create(a, "Added later", { folderId: inner });
    expect(await accessOf(b, later)).toBe("read");

    // The shared folder opens like a folder: the folder's own notes, its subfolders with their counts.
    const opened = (await b.as.query(api.folderSharing.open, { folderId: projects }))!;
    expect(opened.access).toBe("read");
    expect(opened.notes.map((n) => n.id)).toEqual([plan]);
    expect(opened.subfolders.map((f) => [f.id, f.noteCount])).toEqual([[inner, 2]]);
    expect(opened.path).toEqual([]);
    // A subfolder shows the way up as far as the shared folder, never above it.
    const deep = (await b.as.query(api.folderSharing.open, { folderId: deepest }))!;
    expect(deep.path.map((p) => p.id)).toEqual([projects, inner]);
    expect(await b.as.query(api.folderSharing.open, { folderId: sibling })).toBeNull();

    // Shared with Me lists the folder (its subfolders open from it), with its note count.
    const shared = await b.as.query(api.folderSharing.sharedFolders, {});
    expect(shared.map((f) => [f.id, f.role, f.noteCount])).toEqual([[projects, "viewer", 3]]);
    // Its notes carry their folder for the guest (the folder is theirs to open).
    const summary = (await b.as.query(api.documents.get, { documentId: plan }))!;
    expect(summary.isMember).toBe(false);
  });

  test("an editor writes; guests still can't add pages or move notes between folders, nor share", async () => {
    const t = setup();
    const a = await person(t, "fs-ed-owner@example.com");
    const b = await person(t, "fs-ed@example.com");
    const box = await folder(a, "Box");
    const other = await folder(a, "Other");
    const note = await create(a, "Shopping", { folderId: box });
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fs-ed@example.com", role: "editor" });
    expect(await accessOf(b, note)).toBe("write");
    expect((await write(b, note, "milk")).status).toBe("applied");
    const [nested] = await b.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-folder-share",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: note, folderId: null, kind: "document", title: "Sub", icon: null } as never }],
    });
    expect(nested!.error?.code).toBe("forbidden");
    await expect(b.as.mutation(api.documents.move, { documentId: note, folderId: other })).rejects.toThrow();
    expect(await codeOf(b.as.mutation(api.folderSharing.grant, { folderId: box, email: "fs-ed-owner@example.com", role: "viewer" }))).toBe("forbidden");
    expect(await codeOf(b.as.mutation(api.folderSharing.setRole, { folderId: box, profileId: b.profileId, role: "editor" }))).toBe("forbidden");
    // A comment-only role comments but doesn't write; a viewer doesn't comment (comments go by documentAccess).
    await a.as.mutation(api.folderSharing.setRole, { folderId: box, profileId: b.profileId, role: "commenter" });
    expect(await accessOf(b, note)).toBe("comment");
    await b.as.mutation(api.comments.create, { documentId: note, body: [{ type: "text", text: "Oat milk?" }] });
    expect((await write(b, note, "eggs")).error?.code).toBe("forbidden");
    await a.as.mutation(api.folderSharing.setRole, { folderId: box, profileId: b.profileId, role: "viewer" });
    await expect(b.as.mutation(api.comments.create, { documentId: note, body: [{ type: "text", text: "No" }] })).rejects.toThrow();
  });

  test("moving a note out of a shared folder removes inherited access; moving one in adds it", async () => {
    const t = setup();
    const a = await person(t, "fs-move-owner@example.com");
    const b = await person(t, "fs-move@example.com");
    const shared = await folder(a, "Shared");
    const priv = await folder(a, "Private");
    const note = await create(a, "Travelling", { folderId: shared });
    const kid = await create(a, "Travelling sub", { parentDocumentId: note });
    await a.as.mutation(api.folderSharing.grant, { folderId: shared, email: "fs-move@example.com", role: "viewer" });
    expect(await accessOf(b, kid)).toBe("read");
    // The app warns before: who would lose access.
    const check = await a.as.query(api.folderSharing.moveCheck, { documentIds: [note], folderId: priv });
    expect(check).toMatchObject({ loseCount: 1, gainCount: 0, loses: ["fs-move"] });
    await a.as.mutation(api.documents.move, { documentId: note, folderId: priv });
    expect(await accessOf(b, note)).toBe("none");
    expect(await accessOf(b, kid)).toBe("none");
    expect(await a.as.query(api.folderSharing.moveCheck, { documentIds: [note], folderId: shared })).toMatchObject({ gainCount: 1, loseCount: 0 });
    await a.as.mutation(api.documents.move, { documentId: note, folderId: shared });
    expect(await accessOf(b, note)).toBe("read");
    // To Drafts: gone again.
    await a.as.mutation(api.documents.move, { documentId: note, folderId: null });
    expect(await accessOf(b, note)).toBe("none");
    // Moving a whole subfolder under the shared folder shares its notes.
    const moved = await create(a, "In private", { folderId: priv });
    expect(await accessOf(b, moved)).toBe("none");
    await a.as.mutation(api.organization.moveFolder, { folderId: priv, parentFolderId: shared });
    expect(await accessOf(b, moved)).toBe("read");
    await a.as.mutation(api.organization.moveFolder, { folderId: priv, parentFolderId: null });
    expect(await accessOf(b, moved)).toBe("none");
  });

  test("the highest of a note grant and a folder grant wins, both ways", async () => {
    const t = setup();
    const a = await person(t, "fs-max-owner@example.com");
    const b = await person(t, "fs-max@example.com");
    const box = await folder(a, "Box");
    const n1 = await create(a, "One", { folderId: box });
    const n2 = await create(a, "Two", { folderId: box });
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fs-max@example.com", role: "editor" });
    await a.as.mutation(api.sharing.grant, { documentId: n1, email: "fs-max@example.com", role: "viewer" });
    expect(await accessOf(b, n1)).toBe("write");
    await a.as.mutation(api.folderSharing.setRole, { folderId: box, profileId: b.profileId, role: "viewer" });
    await a.as.mutation(api.sharing.grant, { documentId: n2, email: "fs-max@example.com", role: "editor" });
    expect(await accessOf(b, n2)).toBe("write");
    expect(await accessOf(b, n1)).toBe("read");
    // Revoking the folder leaves the note shared on its own.
    await a.as.mutation(api.folderSharing.revoke, { folderId: box, profileId: b.profileId });
    expect(await accessOf(b, n2)).toBe("write");
    expect(await accessOf(b, n1)).toBe("read");
    await a.as.mutation(api.sharing.revoke, { documentId: n1, profileId: b.profileId });
    expect(await accessOf(b, n1)).toBe("none");
    // A grant on a folder above and one on the folder below: the higher one.
    const top = await folder(a, "Top");
    const below = await folder(a, "Below", top);
    const n3 = await create(a, "Three", { folderId: below });
    await a.as.mutation(api.folderSharing.grant, { folderId: top, email: "fs-max@example.com", role: "commenter" });
    await a.as.mutation(api.folderSharing.grant, { folderId: below, email: "fs-max@example.com", role: "viewer" });
    expect(await accessOf(b, n3)).toBe("comment");
  });

  test("revoking, leaving and deleting the folder end access; the person is told", async () => {
    const t = setup();
    const a = await person(t, "fs-rev-owner@example.com");
    const b = await person(t, "fs-rev@example.com");
    const box = await folder(a, "Recipes");
    const note = await create(a, "Bread", { folderId: box });
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fs-rev@example.com", role: "viewer" });
    const share = (await b.as.query(api.notifications.list, {})).find((n) => n.kind === "share")!;
    expect(share.folderId).toBe(box);
    expect(share.title).toContain("Recipes");
    // The owner's dialog: the person, the note count.
    const dialog = await a.as.query(api.folderSharing.get, { folderId: box });
    expect(dialog).toMatchObject({ canManage: true, noteCount: 1, blocked: null });
    expect(dialog.people.map((p) => [p.profileId, p.role, p.guest, p.email])).toEqual([[b.profileId, "viewer", true, "fs-rev@example.com"]]);
    // The guest's: only themselves, and who shared it.
    const theirs = await b.as.query(api.folderSharing.get, { folderId: box });
    expect(theirs).toMatchObject({ canManage: false, youAreGuest: true, sharedBy: "fs-rev-owner" });
    expect(theirs.people.map((p) => p.profileId)).toEqual([b.profileId]);

    await a.as.mutation(api.folderSharing.revoke, { folderId: box, profileId: b.profileId });
    expect(await accessOf(b, note)).toBe("none");
    expect(await b.as.query(api.folderSharing.open, { folderId: box })).toBeNull();
    expect(await b.as.query(api.folderSharing.sharedFolders, {})).toEqual([]);
    const told = (await b.as.query(api.notifications.list, {})).find((n) => n.kind === "share_change")!;
    expect(told.title).toContain("removed your access to the folder");
    // The old share notification no longer links anywhere.
    expect((await b.as.query(api.notifications.list, {})).find((n) => n.kind === "share")!.folderId).toBeNull();

    // Leaving it yourself.
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fs-rev@example.com", role: "viewer" });
    await b.as.mutation(api.folderSharing.revoke, { folderId: box, profileId: b.profileId });
    expect(await accessOf(b, note)).toBe("none");

    // Deleting the folder: its sharing goes with it (the notes go to Drafts).
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fs-rev@example.com", role: "viewer" });
    await a.as.mutation(api.organization.deleteFolder, { folderId: box });
    expect(await accessOf(b, note)).toBe("none");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("folderPermissions").collect()).toEqual([]);
    });
  });
});

describe("folder invitations", () => {
  async function inviteRow(t: T, email: string) {
    return await t.run(async (ctx) => (await ctx.db.query("folderInvites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => i.status === "pending") ?? null);
  }

  test("an address without an account: pending until they sign up and accept", async () => {
    const t = setup();
    const a = await person(t, "fsi-owner@example.com");
    const box = await folder(a, "Garden");
    const note = await create(a, "Tomatoes", { folderId: box });
    expect(await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsi-new@example.com", role: "editor" })).toEqual({ status: "invited" });
    expect((await a.as.query(api.folderSharing.get, { folderId: box })).pendingInvites.map((i) => [i.email, i.role])).toEqual([["fsi-new@example.com", "editor"]]);
    // Pending grants nothing; signing up brings a notice to accept.
    const b = await person(t, "fsi-new@example.com");
    expect(await accessOf(b, note)).toBe("none");
    const notice = (await b.as.query(api.notifications.list, {})).find((n) => n.folderInviteId)!;
    expect(notice.title).toContain("Garden");
    // Someone else can't take it.
    const c = await person(t, "fsi-other@example.com");
    expect(await codeOf(c.as.mutation(api.folderSharing.acceptInvite, { inviteId: notice.folderInviteId! }))).toBe("forbidden");
    expect(await b.as.mutation(api.folderSharing.acceptInvite, { inviteId: notice.folderInviteId! })).toEqual({ folderId: box });
    expect(await accessOf(b, note)).toBe("write");
    expect((await inviteRow(t, "fsi-new@example.com"))).toBeNull();
    // Used: it can't be accepted again.
    expect(await codeOf(b.as.mutation(api.folderSharing.acceptInvite, { inviteId: notice.folderInviteId! }))).toBe("not_found");
  });

  test("declined: unusable, the bell forgets it, nobody is told; revoked and expired ones are refused", async () => {
    const t = setup();
    const a = await person(t, "fsd-owner@example.com");
    const box = await folder(a, "Garage");
    const note = await create(a, "Tools", { folderId: box });
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsd-new@example.com", role: "viewer" });
    const b = await person(t, "fsd-new@example.com");
    const notice = (await b.as.query(api.notifications.list, {})).find((n) => n.folderInviteId)!;
    const ownerNotes = (await a.as.query(api.notifications.list, {})).length;
    await b.as.mutation(api.folderSharing.declineInvite, { inviteId: notice.folderInviteId! });
    expect((await b.as.query(api.notifications.list, {})).find((n) => n.folderInviteId)).toBeUndefined();
    await b.as.mutation(api.folderSharing.declineInvite, { inviteId: notice.folderInviteId! });
    expect(await codeOf(b.as.mutation(api.folderSharing.acceptInvite, { inviteId: notice.folderInviteId! }))).toBe("not_found");
    expect(await accessOf(b, note)).toBe("none");
    expect((await a.as.query(api.notifications.list, {})).length).toBe(ownerNotes);
    expect((await a.as.query(api.folderSharing.get, { folderId: box })).pendingInvites).toEqual([]);

    // Revoked by the owner before it's used.
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsd-later@example.com", role: "viewer" });
    const pending = (await a.as.query(api.folderSharing.get, { folderId: box })).pendingInvites[0]!;
    await a.as.mutation(api.folderSharing.revokeInvite, { inviteId: pending.id });
    const c = await person(t, "fsd-later@example.com");
    expect(await codeOf(c.as.mutation(api.folderSharing.acceptInvite, { inviteId: pending.id }))).toBe("not_found");

    // Expired.
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsd-late@example.com", role: "viewer" });
    const row = (await inviteRow(t, "fsd-late@example.com"))!;
    await t.run(async (ctx) => ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 }));
    const d = await person(t, "fsd-late@example.com");
    expect(await codeOf(d.as.mutation(api.folderSharing.acceptInvite, { inviteId: row.publicId }))).toBe("expired");
  });
});

describe("folder sharing in a team workspace", () => {
  test("guests, view-only members raised by a folder, restricted pages untouched, removed members lose it", async () => {
    const t = setup();
    const owner = await person(t, "fsw-owner@example.com");
    const member = await person(t, "fsw-member@example.com");
    const guest = await person(t, "fsw-guest@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "fsw-member@example.com", workspaceId, "viewer");
    const box = await folder(owner, "Design", undefined, scope);
    const note = await create(owner, "Brief", { folderId: box }, scope);
    const locked = await create(owner, "Salaries", { folderId: box }, scope);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: locked, mode: "restricted" });

    // A view-only member gets edit in the folder; a guest gets what they were given.
    expect(await accessOf(member, note)).toBe("read");
    await owner.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsw-member@example.com", role: "editor" });
    await owner.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsw-guest@example.com", role: "commenter" });
    expect(await accessOf(member, note)).toBe("write");
    expect(await accessOf(guest, note)).toBe("comment");
    // A restricted page stays for the people it was given to.
    expect(await accessOf(member, locked)).toBe("none");
    expect(await accessOf(guest, locked)).toBe("none");
    expect((await owner.as.query(api.folderSharing.get, { folderId: box })).noteCount).toBe(1);
    expect((await owner.as.query(api.folderSharing.forNote, { documentId: locked }))!.reason).toBe("restricted");
    // The guest shows in Guests (with the folder) and counts as a guest, not a seat.
    const guests = await owner.as.query(api.workspaces.guests, { workspaceId });
    expect(guests.guests.map((g) => [g.profileId, g.folders.map((f) => f.folderId)])).toEqual([[guest.profileId, [box]]]);
    // Members don't share folders; owners and admins manage everything anyway.
    expect(await codeOf(member.as.mutation(api.folderSharing.grant, { folderId: box, email: "x@example.com", role: "viewer" }))).toBe("forbidden");
    expect(await codeOf(owner.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsw-owner@example.com", role: "viewer" }))).toBe("invalid_argument");
    // The guest's lists stay out of the workspace; the shared folder opens.
    expect((await guest.as.query(api.folderSharing.open, { folderId: box }))!.notes.map((n) => n.id)).toEqual([note]);
    await expect(guest.as.query(api.organization.sidebar, { scope: inWorkspace(workspaceId) })).rejects.toThrow();

    // Removing the member and the guest takes their folder grants too.
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect(await accessOf(member, note)).toBe("none");
    await owner.as.mutation(api.workspaces.removeGuest, { workspaceId, profileId: guest.profileId });
    expect(await accessOf(guest, note)).toBe("none");
  });
});

describe("folder sharing and end-to-end encryption", () => {
  test("an always encrypted folder isn't shared as a folder; folder access never reaches a sealed note", async () => {
    const t = setup();
    const a = await person(t, "fse-owner@example.com");
    const b = await person(t, "fse@example.com");
    const box = await folder(a, "Vault");
    const plain = await create(a, "Plain", { folderId: box });
    const sealed = await create(a, "Sealed", { folderId: box });
    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fse@example.com", role: "viewer" });
    await t.run(async (ctx) => {
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", sealed)).unique();
      await ctx.db.patch(d!._id, { sealedAt: Date.now() });
    });
    expect(await accessOf(b, plain)).toBe("read");
    expect(await accessOf(b, sealed)).toBe("none");
    expect((await a.as.query(api.folderSharing.forNote, { documentId: sealed }))!.reason).toBe("encrypted");
    // A locked folder can't be shared (or shared with anyone new).
    await t.run(async (ctx) => {
      const f = await ctx.db.query("folders").withIndex("by_public_id", (q) => q.eq("publicId", box)).unique();
      await ctx.db.patch(f!._id, { locked: true });
    });
    expect((await a.as.query(api.folderSharing.get, { folderId: box })).blocked).toMatch(/always fully encrypted/);
    expect(await codeOf(a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fse-2@example.com", role: "viewer" }))).toBe("forbidden");
  });
});

describe("the device copy's shared feed", () => {
  test("includes notes seen through a shared folder, drops them when access is revoked or they move out", async () => {
    const t = setup();
    const a = await person(t, "fsc-owner@example.com");
    const b = await person(t, "fsc@example.com");
    const box = await folder(a, "Shared");
    const sub = await folder(a, "Sub", box);
    const n1 = await create(a, "One", { folderId: box });
    const n2 = await create(a, "Two", { folderId: sub });
    const kid = await create(a, "One child", { parentDocumentId: n1 });
    const solo = await create(a, "Solo");
    await write(a, n1, "hello there");
    const head0 = (await b.as.query(api.sync.sharedHead, {})).key;
    expect(await sharedIds(b)).toEqual([]);

    await a.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsc@example.com", role: "viewer" });
    await a.as.mutation(api.sharing.grant, { documentId: solo, email: "fsc@example.com", role: "viewer" });
    const head1 = (await b.as.query(api.sync.sharedHead, {})).key;
    expect(head1).not.toBe(head0);
    expect((await sharedIds(b)).sort()).toEqual([n1, n2, kid, solo].sort());
    const manifest = await b.as.query(api.sync.sharedManifest, {});
    expect(manifest.complete).toBe(true);
    const one = manifest.notes.find((n) => n.id === n1)!;
    expect(one.head).toBeGreaterThan(0);
    // The guest sees the note's folder (it's theirs to open), never the owner's other folders.
    expect(one.summary!.folderId).toBe(box);
    const pulled = await b.as.query(api.sync.pullDocs, { ids: [n1, n2] });
    expect(pulled.notes.map((n) => n.status)).toEqual(["ok", "ok"]);
    // The owner's own feed is their Personal (their notes aren't "shared" with them).
    expect(await sharedIds(a)).toEqual([]);

    // A note added later joins; one moved out leaves; the head moves each time.
    const n3 = await create(a, "Three", { folderId: sub });
    const head2 = (await b.as.query(api.sync.sharedHead, {})).key;
    expect(head2).not.toBe(head1);
    expect(await sharedIds(b)).toContain(n3);
    await a.as.mutation(api.documents.move, { documentId: n2, folderId: null });
    expect(await sharedIds(b)).not.toContain(n2);
    expect((await b.as.query(api.sync.sharedHead, {})).key).not.toBe(head2);
    expect((await b.as.query(api.sync.pullDocs, { ids: [n2] })).notes[0]!.status).toBe("missing");

    // Revoked: everything that came through the folder goes; the page shared on its own stays.
    await a.as.mutation(api.folderSharing.revoke, { folderId: box, profileId: b.profileId });
    expect(await sharedIds(b)).toEqual([solo]);
    expect((await b.as.query(api.sync.pullDocs, { ids: [n1, kid] })).notes.map((n) => n.status)).toEqual(["missing", "missing"]);
  });

  test("a member's own places stay out of the shared feed (their scope's feed keeps them)", async () => {
    const t = setup();
    const owner = await person(t, "fsc-ws-owner@example.com");
    const member = await person(t, "fsc-ws-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "fsc-ws-member@example.com", workspaceId, "viewer");
    const box = await folder(owner, "Team folder", undefined, scope);
    const note = await create(owner, "Team note", { folderId: box }, scope);
    await owner.as.mutation(api.folderSharing.grant, { folderId: box, email: "fsc-ws-member@example.com", role: "editor" });
    expect(await sharedIds(member)).toEqual([]);
    const manifest = await member.as.query(api.sync.manifest, { scope: inWorkspace(workspaceId), after: 0 });
    expect(manifest.notes.map((n) => n.id)).toContain(note);
    // Folder grants in Shared with Me say they're in your place.
    expect((await member.as.query(api.folderSharing.sharedFolders, {}))[0]).toMatchObject({ id: box, inYourPlace: true });
  });
});

describe("a note's Share dialog shows access from its folders", () => {
  test("in scope: everyone, from which folder; a guest: only themselves; restricted pages: none", async () => {
    const t = setup();
    const a = await person(t, "fsn-owner@example.com");
    const b = await person(t, "fsn-b@example.com");
    const c = await person(t, "fsn-c@example.com");
    const top = await folder(a, "Top");
    const below = await folder(a, "Below", top);
    const note = await create(a, "Inside", { folderId: below });
    await a.as.mutation(api.folderSharing.grant, { folderId: top, email: "fsn-b@example.com", role: "viewer" });
    await a.as.mutation(api.folderSharing.grant, { folderId: below, email: "fsn-c@example.com", role: "editor" });
    const mine = (await a.as.query(api.folderSharing.forNote, { documentId: note }))!;
    expect(mine.folders.map((f) => [f.id, f.people.map((p) => p.profileId), f.canManage])).toEqual([
      [below, [c.profileId], true],
      [top, [b.profileId], true],
    ]);
    const theirs = (await b.as.query(api.folderSharing.forNote, { documentId: note }))!;
    expect(theirs.folders.map((f) => [f.id, f.people.map((p) => p.profileId), f.canManage])).toEqual([[top, [b.profileId], false]]);
    // The subfolder's dialog shows the grant on the folder above as inherited.
    const sub = await a.as.query(api.folderSharing.get, { folderId: below });
    expect(sub.inherited.map((i) => [i.folderId, i.people.map((p) => p.profileId)])).toEqual([[top, [b.profileId]]]);
  });
});

