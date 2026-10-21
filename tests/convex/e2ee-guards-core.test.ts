// End-to-end encryption guards in the core modules (docs/E2EE_DESIGN.md §5.7, WP4 rows): search, collections,
// comments, sharing, tasks, study, exports, imports, maintenance, migrations, migration, users, workspaces,
// notifications, calendar feeds, bookmarks, proposals and the dev-only scan. One test per row marked Device,
// Skip, Off or Switch (and the Sealed/Blind rows with server work), each on a sealed note.
//
// Notes are written as Standard first (sync.push), then the space gets its `e2eeSpaces` row and the note is
// sealed by patching its rows, the way a finished seal migration leaves them (WP3's purge is not needed for
// these checks: where it matters, a test leaves the derived plaintext in place to show the guard alone
// skips it).
import { describe, expect, test, vi } from "vitest";
import { unzipSync } from "fflate";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scopeKey, type Scope } from "../../convex/lib/scope";
import { DEFAULT_SELECTED_SWITCHES, type Switches } from "../../convex/lib/e2ee/validators";
import { sha256Hex } from "../../convex/lib/crypto";
import { copyCollectionsInto } from "../../convex/lib/collections";
import { proposeAppend } from "../../convex/proposals";
import { markerNeedles } from "../../convex/testSupport";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, inWorkspace, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const secret = "a".repeat(64);
const TODAY = new Date().toISOString().slice(0, 10);
const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const sealedField = (label: string) => ({ c: bytes(`FLV1-${label}`), k: 1 });
const MAC = "A".repeat(22);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

async function push(p: Person, scope: ScopeArg, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope, deviceId: "device-e2ee-core", ops: ops as never });
}

/** A Standard note with these blocks (paragraph text by default). */
async function note(p: Person, scope: ScopeArg, title: string, blocks: { id?: string; type?: string; text: string; props?: Record<string, unknown> }[] = []) {
  const id = ulid();
  const ops: unknown[] = [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }];
  const ids: string[] = [];
  for (const b of blocks) {
    const block = { ...para(b.id ?? ulid(), b.text), ...(b.type ? { type: b.type } : {}), ...(b.props ? { props: b.props } : {}) };
    ids.push(block.id);
    ops.push({ opId: ulid(), kind: "block.upsert", documentId: id, block, baseRevision: null, fields: ["content", "position"] });
  }
  await push(p, scope, ops);
  return { id, blockIds: ids };
}

async function docOf(t: T, publicId: string): Promise<Doc<"documents">> {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

async function workspaceIdOf(t: T, publicId: string): Promise<Id<"workspaces">> {
  return await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!._id);
}

const personal = (p: Person): Scope => ({ kind: "personal", profileId: p.profileId as Id<"profiles"> });

/** Gives a space its E2EE row: encrypted at `level` (or Standard with locks), with these switches. */
async function encrypt(t: T, scope: Scope, by: Person, level: "standard" | "selected" | "full" = "selected", switches: Partial<Switches> = {}) {
  await t.run(async (ctx) => {
    const fields = scope.kind === "personal" ? { ownerProfileId: scope.profileId } : { workspaceId: scope.workspaceId };
    const existing = await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey(scope))).unique();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("e2eeSpaces", {
      ...fields,
      scopeKey: scopeKey(scope),
      level,
      state: "on",
      switches: { ...DEFAULT_SELECTED_SWITCHES, ...switches },
      currentKeyVersion: 1,
      lockedCount: level === "standard" ? 1 : 0,
      changedBy: by.profileId as Id<"profiles">,
      changedAt: Date.now(),
      seq: 1,
    });
  });
}

/**
 * Seals a note as a finished migration leaves it: sealed title and appearance, placeholders in the plain
 * columns (unless `keepPlain`, to show a guard skips it on its own), every block sealed, note key v1.
 */
async function seal(t: T, publicId: string, opts: { keepPlain?: boolean; locked?: boolean } = {}) {
  await t.run(async (ctx) => {
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!;
    await ctx.db.patch(doc._id, {
      sealedAt: Date.now(),
      sealedTitle: { ...sealedField(`title-${publicId}`), mac: MAC },
      sealedAppearance: sealedField(`appearance-${publicId}`),
      ...(opts.keepPlain ? {} : { title: "", searchText: "", excerpt: "", icon: undefined }),
      ...(opts.locked ? { locked: true } : {}),
    });
    for (const b of await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect()) {
      await ctx.db.patch(b._id, { type: "sealed", schemaVersion: 0, text: [], props: {}, sealed: { c: bytes(`FLV1-block-${b.blockId}`), mac: MAC, k: 1 } });
    }
    const fields = doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : { workspaceId: doc.workspaceId! };
    await ctx.db.insert("e2eeNoteKeys", { ...fields, documentId: doc._id, version: 1, wrappedBy: "space", spaceVersion: 1, wrapped: bytes("wrapped-nk"), createdBy: doc.createdBy, createdAt: Date.now(), seq: 1 });
  });
}

/** Gives someone E2EE account keys (an active epoch), as e2ee.keys.createAccount leaves them. */
async function giveKeys(t: T, p: Person) {
  await t.run(async (ctx) => {
    await ctx.db.insert("e2eeAccounts", {
      profileId: p.profileId as Id<"profiles">,
      epoch: 1,
      x25519Pub: new Uint8Array(32).buffer,
      ed25519Pub: new Uint8Array(32).buffer,
      amkCheck: new Uint8Array(16).buffer,
      statement: { kind: "account-key", body: "{}", sig: "sig" },
      status: "active",
      createdAt: Date.now(),
    });
  });
}

async function mirror(t: T, publicId: string, purpose: "search" | "ai" | "apps", title: string, text: string, tasks?: Doc<"e2eeMirrors">["tasks"]) {
  await t.run(async (ctx) => {
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!;
    const fields = doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : { workspaceId: doc.workspaceId! };
    await ctx.db.insert("e2eeMirrors", { ...fields, purpose, documentId: doc._id, title, text, ...(tasks ? { tasks } : {}), contentHash: "h", updatedAt: Date.now() });
  });
}

const rows = async <N extends "e2eePendingGrants" | "e2eeSpaceGrants" | "e2eeNoteKeys" | "notifications">(t: T, table: N) => await t.run(async (ctx) => (await ctx.db.query(table).collect()) as Doc<N>[]);

describe("search (Skip; Switch searchEverywhere; Switch backgroundAi)", () => {
  test("sealed notes are left out even with stale derived text; sealed tags never match", async () => {
    const t = setup();
    const a = await person(t, "e2ee-search@example.com");
    const plain = await note(a, PERSONAL, "Quixotic plain", [{ text: "quixotic words" }]);
    const hidden = await note(a, PERSONAL, "Quixotic sealed", [{ text: "quixotic secret" }]);
    await encrypt(t, personal(a), a, "standard");
    await seal(t, hidden.id, { keepPlain: true, locked: true });
    const found = await a.as.query(api.search.documents, { scope: PERSONAL, query: "quixotic" });
    expect(found.map((r) => r.id)).toEqual([plain.id]);
    // A sealed tag's normalizedName is a MAC: it is never compared with the query.
    await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", plain.id)).unique())!;
      const tagId = await ctx.db.insert("tags", { ownerProfileId: doc.ownerProfileId!, publicId: ulid(), name: "", normalizedName: "quixoticmac", nameMac: "quixoticmac", sealedName: sealedField("tag"), color: "coral", createdAt: Date.now(), seq: 1 });
      await ctx.db.insert("documentTags", { ownerProfileId: doc.ownerProfileId!, documentId: doc._id, tagId });
    });
    expect((await a.as.query(api.search.documents, { scope: PERSONAL, query: "quixoticmac" })).length).toBe(0);
  });

  test("with Search everywhere on, hits come from the readable search copies, never a locked note's", async () => {
    const t = setup();
    const a = await person(t, "e2ee-search-mirror@example.com");
    const n = await note(a, PERSONAL, "Zanzibar", [{ text: "zanzibar spices" }]);
    const locked = await note(a, PERSONAL, "Zanzibar locked", [{ text: "zanzibar too" }]);
    await encrypt(t, personal(a), a, "selected", { searchEverywhere: false });
    await seal(t, n.id);
    await seal(t, locked.id, { locked: true });
    await mirror(t, n.id, "search", "Zanzibar", "Zanzibar\nzanzibar spices");
    await mirror(t, locked.id, "search", "Zanzibar locked", "Zanzibar locked\nzanzibar too");
    // Switch off: nothing from the copies.
    expect(await a.as.query(api.search.documents, { scope: PERSONAL, query: "zanzibar" })).toEqual([]);
    await encrypt(t, personal(a), a, "selected", { searchEverywhere: true });
    const found = await a.as.query(api.search.documents, { scope: PERSONAL, query: "zanzibar" });
    expect(found.map((r) => [r.id, r.title, r.icon])).toEqual([[n.id, "Zanzibar", null]]);
    expect(found[0]!.snippet).toContain("spices");
    const everywhere = await a.as.query(api.search.everywhere, { query: "zanzibar" });
    expect(everywhere.map((r) => r.id)).toEqual([n.id]);
    // Fully encrypted turns every switch off.
    await encrypt(t, personal(a), a, "full", { searchEverywhere: true });
    expect(await a.as.query(api.search.documents, { scope: PERSONAL, query: "zanzibar" })).toEqual([]);
  });

  test("search by meaning needs Background Foli AI in an encrypted space", async () => {
    const t = setup();
    const a = await person(t, "e2ee-meaning@example.com");
    await encrypt(t, personal(a), a, "selected", { backgroundAi: false });
    expect(await a.as.query(api.search.meaningAvailable, { scope: PERSONAL })).toBe(false);
    expect(await codeOf(a.as.action(api.search.byMeaning, { scope: PERSONAL, query: "anything at all" }))).toBe("e2ee_switch_off");
  });
});

describe("collections and charts (Device)", () => {
  test("a sealed host's collections are refused with e2ee_device_only; charts leave them out", async () => {
    const t = setup();
    const a = await person(t, "e2ee-coll@example.com");
    const host = await note(a, PERSONAL, "Host");
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: host.id });
    expect((await a.as.query(api.charts.collections, { scope: PERSONAL })).map((c) => c.id)).toContain(collectionId);
    await encrypt(t, personal(a), a, "standard");
    await seal(t, host.id, { locked: true });
    expect(await codeOf(a.as.query(api.collections.get, { collectionId }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.collections.rename, { collectionId, name: "Renamed" }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.collections.addRow, { collectionId, title: "Row" }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.collections.create, { documentId: host.id }))).toBe("e2ee_device_only");
    expect((await a.as.query(api.charts.collections, { scope: PERSONAL })).map((c) => c.id)).not.toContain(collectionId);
    const doc = await docOf(t, host.id);
    expect(await codeOf(t.run(async (ctx) => await copyCollectionsInto(ctx, doc)))).toBe("e2ee_device_only");
  });

  test("plaintext collection edits in an encrypted space are refused (an old client)", async () => {
    const t = setup();
    const a = await person(t, "e2ee-coll-space@example.com");
    const host = await note(a, PERSONAL, "Host");
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: host.id });
    await encrypt(t, personal(a), a, "selected");
    // Reading a not-yet-sealed host still works during a migration; writing plaintext doesn't.
    expect((await a.as.query(api.collections.get, { collectionId })).id).toBe(collectionId);
    expect(await codeOf(a.as.mutation(api.collections.rename, { collectionId, name: "X" }))).toBe("e2ee_required");
  });
});

describe("comments (Blind; create, reply and edit Sealed)", () => {
  test("threads carry sealed bodies and no block text; plaintext writes are refused; remove clears the sealed body", async () => {
    const t = setup();
    const a = await person(t, "e2ee-comments@example.com");
    const n = await note(a, PERSONAL, "Commented", [{ text: "commented line" }]);
    const { threadId, commentId } = await a.as.mutation(api.comments.create, { documentId: n.id, blockId: n.blockIds[0], body: [{ type: "text", text: "first" }] });
    await a.as.mutation(api.comments.reply, { threadId, body: [{ type: "text", text: "second" }] });
    await encrypt(t, personal(a), a, "standard");
    await seal(t, n.id, { locked: true });
    await t.run(async (ctx) => {
      const c = (await ctx.db.query("comments").withIndex("by_public_id", (q) => q.eq("publicId", commentId)).unique())!;
      await ctx.db.patch(c._id, { body: [], sealedBody: sealedField("comment") });
    });
    const out = await a.as.query(api.comments.threads, { documentId: n.id });
    expect(out.threads[0]!.blockText).toBe("");
    const first = out.threads[0]!.comments.find((c) => c.id === commentId)! as { body: unknown[]; sealedBody?: { k: number } };
    expect(first.body).toEqual([]);
    expect(first.sealedBody?.k).toBe(1);
    expect(await codeOf(a.as.mutation(api.comments.create, { documentId: n.id, body: [{ type: "text", text: "plain" }] }))).toBe("e2ee_required");
    expect(await codeOf(a.as.mutation(api.comments.reply, { threadId, body: [{ type: "text", text: "plain" }] }))).toBe("e2ee_required");
    expect(await codeOf(a.as.mutation(api.comments.edit, { commentId, body: [{ type: "text", text: "plain" }] }))).toBe("e2ee_required");
    // Blind actions keep working.
    await a.as.mutation(api.comments.react, { commentId, kind: "heart" });
    await a.as.mutation(api.comments.setResolved, { threadId, resolved: true });
    await a.as.mutation(api.comments.remove, { commentId });
    const removed = await t.run(async (ctx) => (await ctx.db.query("comments").withIndex("by_public_id", (q) => q.eq("publicId", commentId)).unique())!);
    expect(removed.sealedBody).toBeUndefined();
  });
});

describe("sharing (Blind; grant needs a note key grant; encrypted links and published copies)", () => {
  test("granting a sealed page: a person with keys needs the note key first; without keys a pending page grant; revoke drops the key", async () => {
    const t = setup();
    const a = await person(t, "e2ee-share-a@example.com");
    const b = await person(t, "e2ee-share-b@example.com");
    const c = await person(t, "e2ee-share-c@example.com");
    const n = await note(a, PERSONAL, "Private plans");
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    const doc = await docOf(t, n.id);
    await giveKeys(t, b);
    expect(await codeOf(a.as.mutation(api.sharing.grant, { documentId: n.id, email: "e2ee-share-b@example.com", role: "viewer" }))).toBe("e2ee_not_set_up");
    // The sharer's device seals the note key to b first (e2ee.grants.grantNote, WP2): stubbed as its row.
    await t.run(async (ctx) => {
      await ctx.db.insert("e2eeNoteKeys", { ownerProfileId: doc.ownerProfileId!, documentId: doc._id, version: 1, wrappedBy: "grant", profileId: b.profileId as Id<"profiles">, wrapped: bytes("nk-to-b"), createdBy: doc.createdBy, createdAt: Date.now(), seq: 2 });
    });
    expect(await a.as.mutation(api.sharing.grant, { documentId: n.id, email: "e2ee-share-b@example.com", role: "viewer" })).toEqual({ status: "shared" });
    const toB = (await rows(t, "notifications")).filter((x) => x.profileId === (b.profileId as Id<"profiles">) && x.kind === "share");
    expect(toB.map((x) => x.title)).toEqual(["e2ee-share-a shared a note with you"]);
    // c has no keys yet: shared now, the key follows when they set encryption up.
    expect(await a.as.mutation(api.sharing.grant, { documentId: n.id, email: "e2ee-share-c@example.com", role: "viewer" })).toEqual({ status: "shared" });
    expect((await rows(t, "e2eePendingGrants")).map((p) => [p.profileId, p.reason, p.documentId])).toEqual([[c.profileId, "page", doc._id]]);
    // What they see in "Shared with me": the sealed title, never a plaintext one.
    const shared = (await b.as.query(api.sharing.sharedWithMe, {})).find((x) => x.id === n.id)! as { title: string; sealed?: { title: { mac: string } } };
    expect(shared.title).toBe("");
    expect(shared.sealed?.title?.mac).toBe(MAC);
    await a.as.mutation(api.sharing.revoke, { documentId: n.id, profileId: b.profileId });
    expect((await rows(t, "e2eeNoteKeys")).filter((k) => k.wrappedBy === "grant")).toEqual([]);
    await a.as.mutation(api.sharing.revoke, { documentId: n.id, profileId: c.profileId });
    expect(await rows(t, "e2eePendingGrants")).toEqual([]);
  });

  test("an email invitation to a sealed page carries no title, previews generically and leaves a pending page grant", async () => {
    const t = setup();
    const a = await person(t, "e2ee-invite-a@example.com");
    const n = await note(a, PERSONAL, "Secret recipe");
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    expect(await a.as.mutation(api.sharing.grant, { documentId: n.id, email: "newcomer@example.com", role: "viewer" })).toEqual({ status: "invited" });
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(JSON.stringify(scheduled.map((s) => s.args))).not.toContain("Secret recipe");
    // The invitee signs up and opens the invitation (its token is only in the email: stored here by hash).
    const doc = await docOf(t, n.id);
    const token = "t".repeat(40);
    await t.run(async (ctx) => {
      const invite = (await ctx.db.query("pageInvites").withIndex("by_document", (q) => q.eq("documentId", doc._id)).first())!;
      await ctx.db.patch(invite._id, { tokenHash: await sha256Hex(token) });
    });
    const newcomer = await person(t, "newcomer@example.com");
    const preview = await newcomer.as.query(api.sharing.previewPageInvite, { token });
    expect(preview).toMatchObject({ valid: true, title: "A note shared with you" });
    await newcomer.as.mutation(api.sharing.acceptPageInvite, { token });
    expect((await rows(t, "e2eePendingGrants")).map((p) => [p.profileId, p.reason])).toEqual([[newcomer.profileId, "page"]]);
  });

  test("links to a sealed note: encrypted links serve sealed rows and the link wrap; plain links stop; published copies serve the copy", async () => {
    const t = setup();
    const a = await person(t, "e2ee-links@example.com");
    const n = await note(a, PERSONAL, "Linked secret", [{ text: "ZQXJ-BODY-link" }]);
    const plainNote = await note(a, PERSONAL, "Plain");
    const old = await a.as.mutation(api.sharing.createPublicLink, { documentId: n.id });
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    // A plain link made before: shows nothing now.
    expect((await t.mutation(api.sharing.openPublicLink, { token: old.token, serverSecret: secret, clientKey: "k1" })).status).toBe("not_found");
    // Plaintext link requests (an old client) are refused; e2ee on a plain note too.
    expect(await codeOf(a.as.mutation(api.sharing.createPublicLink, { documentId: n.id }))).toBe("e2ee_required");
    expect(await codeOf(a.as.mutation(api.sharing.createPublicLink, { documentId: plainNote.id, plainCopy: true }))).toBe("invalid_argument");
    expect(await codeOf(a.as.mutation(api.sharing.createPublicLink, { documentId: n.id, e2ee: { noteVersion: 9, wrapped: bytes("w") } }))).toBe("invalid_argument");
    const linkId = ulid();
    const link = await a.as.mutation(api.sharing.createPublicLink, { documentId: n.id, linkId, allowIndexing: true, e2ee: { noteVersion: 1, wrapped: bytes("nk-for-link") } });
    expect(link.id).toBe(linkId);
    const opened = await t.mutation(api.sharing.openPublicLink, { token: link.token, serverSecret: secret, clientKey: "k2" });
    if (opened.status !== "ok" || !("e2ee" in opened)) throw new Error("expected an encrypted share");
    expect(opened.allowIndexing).toBe(false);
    expect(opened.document.title).toBe("");
    expect(opened.blocks).toEqual([]);
    expect(opened.e2ee.documentId).toBe(n.id);
    expect(opened.e2ee.linkId).toBe(linkId);
    expect(opened.e2ee.noteKey.version).toBe(1);
    expect(new TextDecoder().decode(opened.e2ee.noteKey.wrapped)).toBe("nk-for-link");
    expect(opened.e2ee.blocks.map((b) => b.id)).toEqual(n.blockIds);
    expect(JSON.stringify(opened)).not.toContain("ZQXJ-BODY-link");
    // Revoking deletes the link's note key wrap.
    const before = (await rows(t, "e2eeNoteKeys")).filter((k) => k.wrappedBy === "link").length;
    expect(before).toBe(1);
    await a.as.mutation(api.sharing.revokePublicLink, { linkId });
    expect((await rows(t, "e2eeNoteKeys")).filter((k) => k.wrappedBy === "link")).toEqual([]);

    // A published readable copy: the link waits for the copy (e2ee.links.publishCopy, WP5: stubbed as rows).
    const pub = await a.as.mutation(api.sharing.createPublicLink, { documentId: n.id, plainCopy: true, allowIndexing: true });
    expect((await t.mutation(api.sharing.openPublicLink, { token: pub.token, serverSecret: secret, clientKey: "k3" })).status).toBe("not_found");
    const doc = await docOf(t, n.id);
    await t.run(async (ctx) => {
      const l = (await ctx.db.query("publicLinks").withIndex("by_public_id", (q) => q.eq("publicId", pub.id)).unique())!;
      const copyId = await ctx.db.insert("e2eePublishedCopies", { ownerProfileId: doc.ownerProfileId!, linkId: l._id, documentId: doc._id, title: "Published title", cover: { kind: "none" }, style: doc.style, chunkCount: 1, publishedBy: doc.createdBy, publishedAt: Date.now() });
      await ctx.db.insert("e2eePublishedChunks", { copyId, index: 0, data: JSON.stringify({ blocks: [para("01JAAAAAAAAAAAAAAAAAAAAAAA", "published words")] }) });
    });
    const served = await t.mutation(api.sharing.openPublicLink, { token: pub.token, serverSecret: secret, clientKey: "k4" });
    if (served.status !== "ok") throw new Error(served.status);
    expect(served.document.title).toBe("Published title");
    expect(served.blocks.map((b) => b.id)).toEqual(["01JAAAAAAAAAAAAAAAAAAAAAAA"]);
    expect(served.allowIndexing).toBe(true);
  });

  test("an Always fully encrypted note is never published as a readable copy", async () => {
    const t = setup();
    const a = await person(t, "e2ee-locked-publish@example.com");
    const n = await note(a, PERSONAL, "Locked");
    await encrypt(t, personal(a), a, "standard");
    await seal(t, n.id, { locked: true });
    expect(await codeOf(a.as.mutation(api.sharing.createPublicLink, { documentId: n.id, plainCopy: true }))).toBe("e2ee_locked");
  });
});

describe("tasks (Device lists; composed edits; Inbox; repeat and reminders Skip)", () => {
  test("lists, ranges and the calendar skip sealed notes' to-dos; editing one is device-only", async () => {
    const t = setup();
    const a = await person(t, "e2ee-tasks@example.com");
    const todo = ulid();
    const n = await note(a, PERSONAL, "Chores", [{ id: todo, type: "todo", text: "water plants", props: { checked: false, dueDate: TODAY } }]);
    const target = await note(a, PERSONAL, "Elsewhere");
    expect((await a.as.query(api.tasks.list, { scope: PERSONAL, view: "all", today: TODAY })).map((x) => x.blockId)).toContain(todo);
    await encrypt(t, personal(a), a, "standard");
    await seal(t, n.id, { keepPlain: true, locked: true });
    // The task row is still there (a purge removes it); the guard alone leaves it out.
    expect((await a.as.query(api.tasks.list, { scope: PERSONAL, view: "all", today: TODAY })).map((x) => x.blockId)).not.toContain(todo);
    expect((await a.as.query(api.tasks.range, { scope: PERSONAL, from: TODAY, to: TODAY })).map((x) => x.blockId)).not.toContain(todo);
    expect(await codeOf(a.as.mutation(api.tasks.update, { blockId: todo, checked: true }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.tasks.moveToDocument, { blockId: todo, documentId: target.id }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "into a sealed note", today: TODAY, documentId: n.id }))).toBe("e2ee_device_only");
    // Repeating and reminders skip it.
    await t.mutation(internal.tasks.repeatTask, { blockId: todo, actorId: a.profileId as Id<"profiles"> });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", todo)).unique())!;
      await ctx.db.patch(row._id, { reminderAt: Date.now() - 1000 });
    });
    await t.mutation(internal.tasks.processReminders, {});
    expect((await rows(t, "notifications")).filter((x) => x.title.startsWith("Reminder:"))).toEqual([]);
    const feed = await a.as.mutation(api.calendarFeeds.create, { includeWorkspaces: false });
    const cal = await t.query(internal.calendarFeeds.render, { tokenHash: await sha256Hex(feed.token) });
    expect(cal!.ics).not.toContain("water plants");
  });

  test("an encrypted space's Quick Add and Inbox are the device's; the space's sealed Inbox is found by id", async () => {
    const t = setup();
    const a = await person(t, "e2ee-inbox@example.com");
    await encrypt(t, personal(a), a, "selected");
    expect(await codeOf(a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Buy milk", today: TODAY }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.tasks.inbox, { scope: PERSONAL }))).toBe("e2ee_device_only");
    await encrypt(t, personal(a), a, "standard");
    const inbox = await note(a, PERSONAL, "Inbox");
    await encrypt(t, personal(a), a, "selected");
    await seal(t, inbox.id);
    const doc = await docOf(t, inbox.id);
    await t.run(async (ctx) => {
      const space = (await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey(personal(a)))).unique())!;
      await ctx.db.patch(space._id, { inboxDocumentId: doc._id });
    });
    expect((await a.as.mutation(api.tasks.inbox, { scope: PERSONAL })).documentId).toBe(inbox.id);
  });
});

describe("study (Device)", () => {
  test("a sealed note's cards are left out of the queue; its own review and rating are device-only", async () => {
    const t = setup();
    const a = await person(t, "e2ee-study@example.com");
    const card = ulid();
    const n = await note(a, PERSONAL, "Biology", [{ id: card, type: "toggle", text: "What divides cells?", props: { collapsed: true, study: "card" } }]);
    const now = Date.now();
    const w = { now, dayStart: now - (now % 86_400_000), dayEnd: now - (now % 86_400_000) + 86_400_000 };
    expect((await a.as.query(api.study.queue, { ...w }))!.cards.map((c) => c.blockId)).toContain(card);
    await encrypt(t, personal(a), a, "standard");
    await seal(t, n.id, { keepPlain: true, locked: true });
    expect((await a.as.query(api.study.queue, { ...w }))!.cards.map((c) => c.blockId)).not.toContain(card);
    expect((await a.as.query(api.study.summary, { scope: PERSONAL, ...w }))!.new).toBe(0);
    expect(await codeOf(a.as.query(api.study.queue, { documentId: n.id, ...w }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.study.review, { blockId: card, rating: "good", lastReview: null }))).toBe("e2ee_device_only");
  });
});

describe("exports and imports (Device; composed)", () => {
  test("the server's export leaves sealed notes out and says how many in ENCRYPTED.txt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const t = setup();
      const a = await person(t, "e2ee-export@example.com");
      await note(a, PERSONAL, "Exported plain", [{ text: "plain words" }]);
      const s = await note(a, PERSONAL, "ZQXJ-TITLE-export", [{ text: "ZQXJ-BODY-export" }]);
      await encrypt(t, personal(a), a, "standard");
      await seal(t, s.id, { keepPlain: true, locked: true });
      const page = await t.query(internal.exports.documentPage, { profileId: a.profileId as Id<"profiles">, scope: personal(a), cursor: null });
      expect(page.sealed).toBe(1);
      expect(page.docs.map((d) => d.id)).not.toContain(s.id);
      await a.as.action(api.exports.exportScope, { scope: PERSONAL });
      const zip = await t.run(async (ctx) => {
        const file = (await ctx.db.query("files").collect()).find((f) => f.kind === "export")!;
        return await (await ctx.storage.get(file.storageId))!.arrayBuffer();
      });
      const files = unzipSync(new Uint8Array(zip));
      expect(new TextDecoder().decode(files["ENCRYPTED.txt"]!)).toMatch(/^1 end-to-end encrypted note was left out/);
      const all = Object.values(files).map((f) => new TextDecoder().decode(f)).join("\n");
      expect(all).not.toContain("ZQXJ-BODY-export");
      expect(all).not.toContain("ZQXJ-TITLE-export");
    } finally {
      vi.useRealTimers();
    }
  });

  test("imports into an encrypted space or a locked folder are composed on the device", async () => {
    const t = setup();
    const a = await person(t, "e2ee-import@example.com");
    const { id: folderId } = await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Vault" });
    const { id: inner } = await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Inner", parentFolderId: folderId });
    await t.run(async (ctx) => {
      const f = (await ctx.db.query("folders").withIndex("by_public_id", (q) => q.eq("publicId", folderId)).unique())!;
      await ctx.db.patch(f._id, { locked: true });
    });
    await encrypt(t, personal(a), a, "standard");
    expect(await codeOf(a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "a.md", content: "# Hi", format: "markdown", folderId }))).toBe("e2ee_device_only");
    expect(await codeOf(a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "a.md", content: "# Hi", format: "markdown", folderId: inner }))).toBe("e2ee_device_only");
    expect((await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "a.md", content: "# Hi", format: "markdown" })).document.title).toBe("Hi");
    await encrypt(t, personal(a), a, "selected");
    expect(await codeOf(a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "b.md", content: "# Hi", format: "markdown" }))).toBe("e2ee_device_only");
  });
});

describe("migration (Blind with sealed fields), migrations (Skip), users (composed starter pages)", () => {
  test("migration.documents carries sealed fields; fileTexts is empty for a sealed note", async () => {
    const t = setup();
    const a = await person(t, "e2ee-migration@example.com");
    const n = await note(a, PERSONAL, "To local");
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    const page = await a.as.query(api.migration.documents, { scope: PERSONAL, paginationOpts: { numItems: 100, cursor: null } });
    const row = page.page.find((d) => d.id === n.id)!;
    expect(row.title).toBe("");
    expect(row.sealed?.title?.mac).toBe(MAC);
    expect(row.sealed?.appearance?.k).toBe(1);
    expect(await a.as.query(api.migration.fileTexts, { documentId: n.id })).toEqual([]);
  });

  test("backfills leave sealed notes' placeholders alone", async () => {
    const t = setup();
    const a = await person(t, "e2ee-backfill@example.com");
    const n = await note(a, PERSONAL, "Iconless");
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    await t.mutation(internal.migrations.backfillNoteIcons, {});
    await t.mutation(internal.migrations.backfillDocumentPreviews, {});
    const doc = await docOf(t, n.id);
    expect(doc.icon).toBeUndefined();
    expect(doc.searchText).toBe("");
  });

  test("onboarding in an encrypted Personal adds no plaintext starter pages", async () => {
    const t = setup();
    const a = await person(t, "e2ee-onboarding@example.com");
    const count = async () => (await t.run(async (ctx) => await ctx.db.query("documents").collect())).length;
    const before = await count();
    await encrypt(t, personal(a), a, "selected");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["work"] });
    expect(await count()).toBe(before);
    const me = await a.as.query(api.users.me, {});
    if (me.state !== "ready") throw new Error(me.state);
  });
});

describe("workspaces (pending grants on join; keys dropped and rotation on removal; guests Blind)", () => {
  test("joining an encrypted workspace waits for a key; leaving drops the grants and asks for a rotation", async () => {
    const t = setup();
    const owner = await person(t, "e2ee-ws-owner@example.com");
    const member = await person(t, "e2ee-ws-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Vault team");
    const wsId = await workspaceIdOf(t, workspaceId);
    const scope: Scope = { kind: "workspace", workspaceId: wsId };
    await encrypt(t, scope, owner, "selected");
    await join(t, owner, member, "e2ee-ws-member@example.com", workspaceId, "editor");
    expect((await rows(t, "e2eePendingGrants")).map((p) => [p.profileId, p.reason])).toEqual([[member.profileId, "joined"]]);
    // An admin's device grants the key (e2ee.grants.grantSpace, WP2): stubbed as its rows.
    await t.run(async (ctx) => {
      for (const p of await ctx.db.query("e2eePendingGrants").collect()) await ctx.db.delete(p._id);
      await ctx.db.insert("e2eeSpaceGrants", { workspaceId: wsId, scopeKey: scopeKey(scope), version: 1, profileId: member.profileId as Id<"profiles">, epoch: 1, wrapped: bytes("sk"), statement: { kind: "space-grant", body: "{}", sig: "s" }, grantedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
    });
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect(await rows(t, "e2eeSpaceGrants")).toEqual([]);
    expect((await rows(t, "e2eePendingGrants")).map((p) => [p.profileId, p.reason])).toEqual([[member.profileId, "rotation"]]);
  });

  test("a Standard workspace gets no E2EE rows", async () => {
    const t = setup();
    const owner = await person(t, "std-ws-owner@example.com");
    const member = await person(t, "std-ws-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Plain team");
    await join(t, owner, member, "std-ws-member@example.com", workspaceId, "editor");
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect(await rows(t, "e2eePendingGrants")).toEqual([]);
  });

  test("guests list sealed pages with their sealed titles; a member made a guest waits for note keys", async () => {
    const t = setup();
    const owner = await person(t, "e2ee-guests-owner@example.com");
    const member = await person(t, "e2ee-guests-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Guests team");
    const wsId = await workspaceIdOf(t, workspaceId);
    await join(t, owner, member, "e2ee-guests-member@example.com", workspaceId, "editor");
    const page = await note(member, inWorkspace(workspaceId), "Member's page");
    await encrypt(t, { kind: "workspace", workspaceId: wsId }, owner, "selected");
    await seal(t, page.id);
    await t.run(async (ctx) => {
      for (const p of await ctx.db.query("e2eePendingGrants").collect()) await ctx.db.delete(p._id);
    });
    await owner.as.mutation(api.workspaces.convertMemberToGuest, { workspaceId, profileId: member.profileId });
    const pending = await rows(t, "e2eePendingGrants");
    const doc = await docOf(t, page.id);
    expect(pending.filter((p) => p.reason === "page").map((p) => [p.profileId, p.documentId])).toEqual([[member.profileId, doc._id]]);
    expect(pending.filter((p) => p.reason === "rotation").map((p) => p.profileId)).toEqual([member.profileId]);
    const list = await owner.as.query(api.workspaces.guests, { workspaceId });
    const pages = list.guests[0]!.pages as { documentId: string; sealed?: { title: { mac: string } } }[];
    expect(pages.find((p) => p.documentId === page.id)?.sealed?.title.mac).toBe(MAC);
  });
});

describe("notifications (Blind), calendar feeds (Switch apps), bookmarks (Off), proposals (inbox instead)", () => {
  test("notifications about a sealed note are marked so the device fills in the title", async () => {
    const t = setup();
    const a = await person(t, "e2ee-notes-a@example.com");
    const n = await note(a, PERSONAL, "Noted");
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    const doc = await docOf(t, n.id);
    await t.run(async (ctx) => {
      await ctx.db.insert("notifications", { profileId: doc.createdBy, kind: "system", documentId: doc._id, title: "You have a new comment", sealedDocument: true, createdAt: Date.now() });
    });
    const [first] = (await a.as.query(api.notifications.list, {})) as ({ sealedDocument?: true; documentSealed?: { title: { mac: string } } | null; documentId: string | null })[];
    expect(first!.documentId).toBe(n.id);
    expect(first!.sealedDocument).toBe(true);
    expect(first!.documentSealed?.title.mac).toBe(MAC);
  });

  test("the calendar feed shows an encrypted Personal's to-dos only from the apps copy, with Apps on", async () => {
    const t = setup();
    const a = await person(t, "e2ee-ical@example.com");
    const n = await note(a, PERSONAL, "Sealed chores");
    const locked = await note(a, PERSONAL, "Locked chores");
    await encrypt(t, personal(a), a, "selected", { apps: false });
    await seal(t, n.id);
    await seal(t, locked.id, { locked: true });
    await mirror(t, n.id, "apps", "Sealed chores", "", [{ blockId: ulid(), text: "Mirror task", done: false, due: TODAY }]);
    await mirror(t, locked.id, "apps", "Locked chores", "", [{ blockId: ulid(), text: "Locked task", done: false, due: TODAY }]);
    const feed = await a.as.mutation(api.calendarFeeds.create, { includeWorkspaces: false });
    const render = async () => (await t.query(internal.calendarFeeds.render, { tokenHash: await sha256Hex(feed.token) }))!.ics;
    expect(await render()).not.toContain("Mirror task");
    await encrypt(t, personal(a), a, "selected", { apps: true });
    const ics = await render();
    expect(ics).toContain("Mirror task");
    expect(ics).not.toContain("Locked task");
  });

  test("bookmark previews are off for encrypted spaces and sealed notes", async () => {
    const t = setup();
    const a = await person(t, "e2ee-bookmark@example.com");
    const n = await note(a, PERSONAL, "Links");
    await encrypt(t, personal(a), a, "standard");
    await seal(t, n.id, { locked: true });
    expect(await codeOf(a.as.action(api.bookmarks.preview, { url: "https://example.com/page", documentId: n.id }))).toBe("e2ee_unavailable");
    await encrypt(t, personal(a), a, "selected");
    expect(await codeOf(a.as.action(api.bookmarks.preview, { url: "https://example.com/page", scope: PERSONAL }))).toBe("e2ee_unavailable");
  });

  test("an app's append to a sealed note is never stored as a plaintext proposal; old ones can't be accepted", async () => {
    const t = setup();
    const a = await person(t, "e2ee-proposals@example.com");
    const n = await note(a, PERSONAL, "Target");
    const doc0 = await docOf(t, n.id);
    // One proposed before the note was encrypted.
    const before = await t.run(async (ctx) => {
      const profile = (await ctx.db.get(doc0.createdBy))!;
      return await proposeAppend(ctx, profile, doc0, [para(ulid(), "appended")], { source: "app", name: "App", device: "mcp:app", reason: "mcp" }, "req-1");
    });
    await encrypt(t, personal(a), a, "selected");
    await seal(t, n.id);
    const doc = await docOf(t, n.id);
    expect(
      await codeOf(
        t.run(async (ctx) => {
          const profile = (await ctx.db.get(doc.createdBy))!;
          await proposeAppend(ctx, profile, doc, [para(ulid(), "appended")], { source: "app", name: "App", device: "mcp:app", reason: "mcp" }, "req-2");
        }),
      ),
    ).toBe("e2ee_device_only");
    const list = await a.as.query(api.proposals.list, {});
    expect(list.find((p) => p.id === before.proposalId)).toMatchObject({ documentId: null, blocks: [], problem: expect.stringMatching(/end-to-end encrypted/) });
    expect(await codeOf(a.as.mutation(api.proposals.accept, { proposalId: before.proposalId }))).toBe("e2ee_device_only");
  });
});

describe("maintenance (Blind; deletes the new tables' rows)", () => {
  test("deleting a note removes its note keys, records, mirrors, reminders, published copies and waiting grants", async () => {
    const t = setup();
    const a = await person(t, "e2ee-purge-doc@example.com");
    const n = await note(a, PERSONAL, "Doomed");
    await encrypt(t, personal(a), a, "selected", { searchEverywhere: true });
    await seal(t, n.id);
    await mirror(t, n.id, "search", "Doomed", "Doomed");
    const doc = await docOf(t, n.id);
    await t.run(async (ctx) => {
      const owner = doc.ownerProfileId!;
      await ctx.db.insert("e2eeRecords", { ownerProfileId: owner, kind: "collection", recordId: ulid(), documentId: doc._id, keyVersion: 1, sealed: bytes("r"), size: 1, rev: 1, updatedBy: owner, updatedAt: 1, seq: 1 });
      await ctx.db.insert("e2eeReminders", { ownerProfileId: owner, profileId: owner, documentId: doc._id, blockId: ulid(), remindAt: 1, updatedAt: 1 });
      await ctx.db.insert("e2eePendingGrants", { ownerProfileId: owner, scopeKey: scopeKey(personal(a)), profileId: owner, reason: "page", documentId: doc._id, createdAt: 1 });
      const linkId = await ctx.db.insert("publicLinks", { ownerProfileId: owner, publicId: ulid(), documentId: doc._id, tokenHash: "x", tokenHint: "x", allowIndexing: false, createdBy: owner, createdAt: 1, viewCount: 0, plainCopy: true });
      const copyId = await ctx.db.insert("e2eePublishedCopies", { ownerProfileId: owner, linkId, documentId: doc._id, title: "copy", cover: { kind: "none" }, style: doc.style, chunkCount: 1, publishedBy: owner, publishedAt: 1 });
      await ctx.db.insert("e2eePublishedChunks", { copyId, index: 0, data: "{}" });
      await ctx.db.insert("deletionJobs", { kind: "document", targetId: doc._id, requestedBy: owner, requestedByAdmin: false, reason: "test", scheduledFor: 0, status: "scheduled", progress: 0, createdAt: 0 });
    });
    for (let i = 0; i < 10; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const left = await t.run(async (ctx) => ({
      noteKeys: (await ctx.db.query("e2eeNoteKeys").collect()).length,
      records: (await ctx.db.query("e2eeRecords").collect()).length,
      mirrors: (await ctx.db.query("e2eeMirrors").collect()).length,
      reminders: (await ctx.db.query("e2eeReminders").collect()).length,
      pending: (await ctx.db.query("e2eePendingGrants").collect()).length,
      copies: (await ctx.db.query("e2eePublishedCopies").collect()).length,
      chunks: (await ctx.db.query("e2eePublishedChunks").collect()).length,
      doc: await ctx.db.get(doc._id),
    }));
    expect(left).toEqual({ noteKeys: 0, records: 0, mirrors: 0, reminders: 0, pending: 0, copies: 0, chunks: 0, doc: null });
  });

  test("deleting an account removes its keys, wraps, devices and approvals; a workspace takes its E2EE rows", async () => {
    const t = setup();
    const a = await person(t, "e2ee-purge-account@example.com");
    const { workspaceId } = await teamWorkspace(a, "Solo");
    const wsId = await workspaceIdOf(t, workspaceId);
    await encrypt(t, personal(a), a, "selected");
    await encrypt(t, { kind: "workspace", workspaceId: wsId }, a, "selected");
    await giveKeys(t, a);
    const pid = a.profileId as Id<"profiles">;
    await t.run(async (ctx) => {
      await ctx.db.insert("e2eeAccountWraps", { profileId: pid, epoch: 1, publicId: ulid(), kind: "recoveryKey", wrapped: bytes("w"), createdAt: 1 });
      await ctx.db.insert("e2eeDevices", { profileId: pid, deviceId: "d1", kind: "browser", label: "B", platform: "web", x25519Pub: bytes("x"), ed25519Pub: bytes("e"), status: "trusted", createdAt: 1, lastSeenAt: 1 });
      await ctx.db.insert("e2eeApprovals", { publicId: ulid(), profileId: pid, deviceId: "d2", commit: bytes("c"), status: "waiting", createdAt: 1, expiresAt: Date.now() + 60_000 });
      await ctx.db.insert("e2eeSpaceKeys", { workspaceId: wsId, scopeKey: scopeKey({ kind: "workspace", workspaceId: wsId }), version: 1, inboxPub: bytes("i"), skCheck: bytes("s"), createdBy: pid, createdAt: 1 });
      await ctx.db.insert("e2eeInbox", { workspaceId: wsId, publicId: ulid(), scopeKey: "w", keyVersion: 1, kind: "email", sealed: bytes("s"), size: 1, status: "waiting", receivedAt: 1, expiresAt: Date.now() + 60_000 });
      await ctx.db.patch(pid, { status: "pending_deletion" });
      await ctx.db.insert("deletionJobs", { kind: "account", targetId: pid, requestedBy: pid, requestedByAdmin: false, reason: "test", scheduledFor: 0, status: "scheduled", progress: 0, createdAt: 0 });
    });
    for (let i = 0; i < 40; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const left = await t.run(async (ctx) => {
      const out: Record<string, number> = {};
      for (const table of ["e2eeAccounts", "e2eeAccountWraps", "e2eeDevices", "e2eeApprovals", "e2eeSpaces", "e2eeSpaceKeys", "e2eeInbox", "e2eeNoteKeys"] as const) out[table] = (await ctx.db.query(table).collect()).length;
      return out;
    });
    expect(left).toEqual({ e2eeAccounts: 0, e2eeAccountWraps: 0, e2eeDevices: 0, e2eeApprovals: 0, e2eeSpaces: 0, e2eeSpaceKeys: 0, e2eeInbox: 0, e2eeNoteKeys: 0 });
  });
});

describe("testSupport.e2eeScan (dev only)", () => {
  test("finds markers as text, UTF-8 and UTF-16 bytes and base64 anywhere; clean when there are none", async () => {
    const t = setup();
    const a = await person(t, "e2ee-scan@example.com");
    expect((await t.action(internal.testSupport.e2eeScan, { markers: ["ZQXJ-NOWHERE-0000"] })).clean).toBe(true);
    const pid = a.profileId as Id<"profiles">;
    const utf16 = new Uint8Array([..."ZQXJ-UTF16-aaaa"].flatMap((ch) => [ch.charCodeAt(0), 0]));
    await t.run(async (ctx) => {
      await ctx.db.insert("e2eeRecords", { ownerProfileId: pid, kind: "prefs", recordId: "r1", keyVersion: 1, sealed: utf16.buffer, size: 1, rev: 1, updatedBy: pid, updatedAt: 1, seq: 1 });
      await ctx.db.insert("e2eeRecords", { ownerProfileId: pid, kind: "prefs", recordId: "r2", keyVersion: 1, sealed: bytes(`xx${btoa("x" + "ZQXJ-B64-bbbbbb" + "yy")}`), size: 1, rev: 1, updatedBy: pid, updatedAt: 1, seq: 1 });
      await ctx.storage.store(new Blob(["before ZQXJ-BLOB-cccc after"]));
    });
    const out = await t.action(internal.testSupport.e2eeScan, { markers: ["ZQXJ-UTF16-aaaa", "ZQXJ-B64-bbbbbb", "ZQXJ-BLOB-cccc", "ZQXJ-NOWHERE-0000"] });
    expect(out.clean).toBe(false);
    expect(out.hits.map((h) => [h.table, h.marker, h.encoding]).sort()).toEqual(
      [
        ["_storage", "ZQXJ-BLOB-cccc", "text"],
        ["e2eeRecords", "ZQXJ-B64-bbbbbb", "base64"],
        ["e2eeRecords", "ZQXJ-UTF16-aaaa", "utf16le"],
      ].sort(),
    );
    expect(await codeOf(t.action(internal.testSupport.e2eeScan, { markers: ["short"] }))).toMatch(/at least 8/);
  });

  test("marker needles cover every base64 alignment", () => {
    const m = "ZQXJ-TITLE-7f3a";
    const needles = markerNeedles(m).filter((n) => n.encoding === "base64").map((n) => n.needle);
    for (const prefix of ["", "a", "ab"]) expect(needles.some((n) => btoa(prefix + m + "zz").includes(n))).toBe(true);
  });
});
