import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { authSession, identity, signedIn, para, person, setup, ulid } from "./helpers";

async function newDoc(p: Awaited<ReturnType<typeof person>>, title = "Doc") {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    workspaceId: p.workspaceId,
    deviceId: "device-test-1",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function upsert(p: Awaited<ReturnType<typeof person>>, documentId: string, block: ReturnType<typeof para>, baseRevision: number | null, fields: ("content" | "position")[] = ["content", "position"], opId = ulid()) {
  const [r] = await p.as.mutation(api.sync.push, { workspaceId: p.workspaceId, deviceId: "device-test-1", ops: [{ opId, kind: "block.upsert", documentId, block, baseRevision, fields }] });
  return r!;
}

describe("accounts", () => {
  test("bootstrap creates a profile, personal workspace and seed documents; is idempotent", async () => {
    const t = setup();
    const a = await person(t, "ada@example.com");
    const again = await a.as.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" });
    expect(again.created).toBe(false);
    const docs = await a.as.query(api.documents.list, { workspaceId: a.workspaceId, view: "all", paginationOpts: { numItems: 50, cursor: null } });
    expect(docs.page.map((d) => d.title)).toEqual(expect.arrayContaining(["Welcome to Folevi", "Project Atlas Brief", "Trip Sketch: Coastal Weekend", "Reading Shelf", "Field Notes: A Quiet Morning"]));
    const templates = await a.as.query(api.documents.list, { workspaceId: a.workspaceId, view: "templates", paginationOpts: { numItems: 50, cursor: null } });
    expect(templates.page.map((d) => d.title)).toContain("Weekly Reset");
  });

  test("unverified email and missing MFA are rejected by every protected function", async () => {
    const t = setup();
    const unverified = t.withIdentity(identity("u@example.com", { emailVerified: false, "https://folevi.com/email_verified": false }));
    expect((await unverified.query(api.users.me, {})).state).toBe("email_unverified");
    await expect(unverified.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" })).rejects.toThrow(/email_unverified/);
    const noMfa = t.withIdentity(identity("m@example.com", { "https://folevi.com/mfa": false }));
    expect((await noMfa.query(api.users.me, {})).state).toBe("mfa_required");
    await expect(noMfa.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" })).rejects.toThrow(/mfa_required/);
  });

  test("signed-out callers get nothing", async () => {
    const t = setup();
    expect((await t.query(api.users.me, {})).state).toBe("signed_out");
    await expect(t.query(api.workspaces.mine, {})).rejects.toThrow(/unauthenticated/);
  });

  test("a revoked session stops working immediately; the others keep working", async () => {
    const t = setup();
    const email = "s@example.com";
    const a = await person(t, email);
    await a.as.mutation(api.users.registerSession, { client: "web", label: "Chrome", deviceId: "dev-1" });
    const otherSession = await authSession(t, a.userId, "Folevi/1.0 (Macintosh)");
    const other = t.withIdentity(identity(email, { subject: a.userId, tokenIdentifier: `https://test.folevi.local|${a.userId}`, sessionId: otherSession }));
    await other.mutation(api.users.registerSession, { client: "mac", label: "Mac", deviceId: "dev-2" });
    const sessions = await a.as.query(api.users.listSessions, {});
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.current)?.label).toBe("Chrome");
    const mac = sessions.find((s) => !s.current)!;
    expect(mac.label).toBe("Mac");
    await a.as.mutation(api.users.revokeSession, { sessionId: mac.id });
    expect((await other.query(api.users.me, {})).state).toBe("session_revoked");
    await expect(other.query(api.workspaces.mine, {})).rejects.toThrow(/unauthenticated/);
    expect((await a.as.query(api.users.me, {})).state).toBe("ready");
    // Someone else's session can't be revoked (same answer as "doesn't exist").
    const b = await person(t, "b-sessions@example.com");
    await expect(b.as.mutation(api.users.revokeSession, { sessionId: a.sessionId })).rejects.toThrow(/not_found/);
    // "Sign out everywhere else" keeps only the current session.
    await authSession(t, a.userId);
    await authSession(t, a.userId);
    const res = await a.as.mutation(api.users.revokeOtherSessions, {});
    expect(res.ended).toBe(2);
    expect(await a.as.query(api.users.listSessions, {})).toHaveLength(1);
  });

  test("a token without a live session is rejected, and a profile from an earlier sign-in system is re-linked by verified email", async () => {
    const t = setup();
    const noSession = t.withIdentity(identity("ns@example.com", { sessionId: "missing" }));
    expect((await noSession.query(api.users.me, {})).state).toBe("session_revoked");
    // Legacy profile (e.g. created by the retired Auth0 integration) → same person, new identity.
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        tokenIdentifier: "https://old.example|auth0|1",
        authSubject: "auth0|1",
        authIssuer: "https://old.example",
        email: "legacy@example.com",
        emailVerified: true,
        mfaVerified: true,
        displayName: "Legacy",
        appearance: "system",
        locale: "en",
        timeZone: "UTC",
        onboardingStep: "done",
        status: "active",
        notificationPrefs: { mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false },
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
    });
    const now = await signedIn(t, "legacy@example.com");
    const r = await now.as.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" });
    expect(r.created).toBe(false);
    const me = await now.as.query(api.users.me, {});
    expect(me.state).toBe("ready");
    if (me.state === "ready") expect(me.profile.displayName).toBe("Legacy");
  });
});

describe("tenant isolation", () => {
  test("a person cannot read or write another workspace's documents", async () => {
    const t = setup();
    const a = await person(t, "a@example.com");
    const b = await person(t, "b@example.com");
    const docId = await newDoc(a, "Private plans");
    expect(await b.as.query(api.documents.get, { documentId: docId })).toBeNull();
    expect(await b.as.query(api.blocks.list, { documentId: docId })).toBeNull();
    await expect(b.as.query(api.documents.list, { workspaceId: a.workspaceId, view: "all", paginationOpts: { numItems: 5, cursor: null } })).rejects.toThrow(/not_found/);
    // Writing into A's document through B's own workspace is rejected per operation.
    const [r] = await b.as.mutation(api.sync.push, {
      workspaceId: b.workspaceId,
      deviceId: "device-b-1",
      ops: [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: para(ulid(), "intrusion"), baseRevision: null, fields: ["content", "position"] }],
    });
    expect(r!.status).toBe("rejected");
    expect(r!.error?.code).toBe("not_found");
    // Pull never returns another workspace's rows.
    await expect(b.as.query(api.sync.pull, { workspaceId: a.workspaceId, cursor: 0 })).rejects.toThrow(/not_found/);
    // Search is scoped too.
    const hits = await b.as.query(api.search.documents, { workspaceId: b.workspaceId, query: "Private plans" });
    expect(hits).toEqual([]);
  });

  test("restricted documents are hidden from workspace members without a grant", async () => {
    const t = setup();
    const owner = await person(t, "owner@example.com");
    const member = await person(t, "member@example.com");
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Garden Team" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "member@example.com", role: "editor" });
    const notes = await member.as.query(api.notifications.list, {});
    const invite = notes.find((n) => n.kind === "invite")!;
    await member.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
    const teamOwner = { ...owner, workspaceId: teamId };
    const docId = await newDoc(teamOwner, "Salary review");
    expect(await member.as.query(api.documents.get, { documentId: docId })).not.toBeNull();
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: docId, mode: "restricted" });
    expect(await member.as.query(api.documents.get, { documentId: docId })).toBeNull();
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "member@example.com", role: "viewer" });
    const got = await member.as.query(api.documents.get, { documentId: docId });
    expect(got?.access).toBe("read");
  });

  test("role changes take effect immediately (viewer cannot write)", async () => {
    const t = setup();
    const owner = await person(t, "o2@example.com");
    const other = await person(t, "v2@example.com");
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "v2@example.com", role: "editor" });
    const invite = (await other.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
    await other.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
    const docId = await newDoc({ ...owner, workspaceId: teamId }, "Shared");
    const ok = await upsert({ ...other, workspaceId: teamId }, docId, para(ulid(), "editor write"), null);
    expect(ok.status).toBe("applied");
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: teamId, profileId: other.profileId, role: "viewer" });
    const denied = await upsert({ ...other, workspaceId: teamId }, docId, para(ulid(), "viewer write"), null);
    expect(denied.status).toBe("rejected");
    expect(denied.error?.code).toBe("forbidden");
  });

  test("invitations are bound to the invited address", async () => {
    const t = setup();
    const owner = await person(t, "o3@example.com");
    const stranger = await person(t, "stranger@example.com");
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
    const { id: inviteId } = await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "someone-else@example.com", role: "editor" });
    await expect(stranger.as.mutation(api.workspaces.acceptInvite, { inviteId })).rejects.toThrow(/different email/);
  });
});

describe("sync protocol", () => {
  test("idempotent: a duplicate delivery of the same op is not re-applied", async () => {
    const t = setup();
    const a = await person(t, "sync1@example.com");
    const docId = await newDoc(a);
    const opId = ulid();
    const block = para(ulid(), "once");
    const first = await upsert(a, docId, block, null, ["content", "position"], opId);
    const second = await upsert(a, docId, block, null, ["content", "position"], opId);
    expect(first.status).toBe("applied");
    expect(second.status).toBe("duplicate");
    expect(second.revision).toBe(first.revision);
    const blocks = await a.as.query(api.blocks.list, { documentId: docId });
    expect(blocks!.blocks.filter((b) => b.id === block.id)).toHaveLength(1);
  });

  test("same-block concurrent edits produce a typed conflict with both versions; different blocks merge", async () => {
    const t = setup();
    const a = await person(t, "sync2@example.com");
    const docId = await newDoc(a);
    const b1 = para(ulid(), "Hello", "G");
    const b2 = para(ulid(), "Other", "l");
    await upsert(a, docId, b1, null);
    await upsert(a, docId, b2, null);
    // Device 1 edits block 1 (base 1) → revision 2.
    const web = await upsert(a, docId, { ...b1, text: [{ type: "text", text: "Hello from the web" }] }, 1, ["content"]);
    expect(web.status).toBe("applied");
    // Device 2 edits block 2 from the same base → merges fine.
    const other = await upsert(a, docId, { ...b2, text: [{ type: "text", text: "Other, edited" }] }, 1, ["content"]);
    expect(other.status).toBe("applied");
    // Device 2 also edited block 1 from base 1 → conflict; nothing is lost.
    const mac = await upsert(a, docId, { ...b1, text: [{ type: "text", text: "Hello from the Mac" }] }, 1, ["content"]);
    expect(mac.status).toBe("conflict");
    expect(mac.conflict?.reason).toBe("content");
    expect(mac.conflict?.server?.text).toEqual([{ type: "text", text: "Hello from the web" }]);
    expect(mac.conflict?.client?.text).toEqual([{ type: "text", text: "Hello from the Mac" }]);
    const blocks = (await a.as.query(api.blocks.list, { documentId: docId }))!.blocks;
    expect(blocks.find((b) => b.id === b1.id)!.text).toEqual([{ type: "text", text: "Hello from the web" }]);
  });

  test("position-only changes are last-writer-wins and never conflict with content edits", async () => {
    const t = setup();
    const a = await person(t, "sync3@example.com");
    const docId = await newDoc(a);
    const b = para(ulid(), "move me", "V");
    await upsert(a, docId, b, null);
    await upsert(a, docId, { ...b, text: [{ type: "text", text: "edited" }] }, 1, ["content"]);
    const moved = await upsert(a, docId, { ...b, rank: "a" }, 1, ["position"]);
    expect(moved.status).toBe("applied");
    const row = (await a.as.query(api.blocks.list, { documentId: docId }))!.blocks.find((x) => x.id === b.id)!;
    expect(row.rank).toBe("a");
    expect(row.text).toEqual([{ type: "text", text: "edited" }]);
  });

  test("deletes are tombstones (with descendants) and restore brings them back", async () => {
    const t = setup();
    const a = await person(t, "sync4@example.com");
    const docId = await newDoc(a);
    const parent = para(ulid(), "parent", "V");
    const child = para(ulid(), "child", "V", parent.id);
    await upsert(a, docId, parent, null);
    await upsert(a, docId, child, null);
    const [del] = await a.as.mutation(api.sync.push, { workspaceId: a.workspaceId, deviceId: "device-test-1", ops: [{ opId: ulid(), kind: "block.delete", documentId: docId, blockId: parent.id, baseRevision: 1 }] });
    expect(del!.status).toBe("applied");
    expect((await a.as.query(api.blocks.list, { documentId: docId }))!.blocks).toHaveLength(0);
    expect(await a.as.query(api.blocks.deleted, { documentId: docId })).toHaveLength(2);
    // Editing a tombstoned block reports a "deleted" conflict instead of silently resurrecting it.
    const edit = await upsert(a, docId, { ...child, text: [{ type: "text", text: "late edit" }] }, 1, ["content"]);
    expect(edit.status).toBe("conflict");
    expect(edit.conflict?.reason).toBe("deleted");
    await a.as.mutation(api.sync.push, { workspaceId: a.workspaceId, deviceId: "device-test-1", ops: [{ opId: ulid(), kind: "block.restore", documentId: docId, blockId: parent.id }] });
    expect((await a.as.query(api.blocks.list, { documentId: docId }))!.blocks).toHaveLength(2);
  });

  test("invalid blocks and cycles are rejected; missing parents are normalized to the root", async () => {
    const t = setup();
    const a = await person(t, "sync5@example.com");
    const docId = await newDoc(a);
    const bad = await upsert(a, docId, { ...para(ulid(), "x"), text: [{ type: "text", text: "x", marks: [{ type: "link", href: "javascript:alert(1)" }] }] }, null);
    expect(bad.status).toBe("rejected");
    expect(bad.error?.code).toBe("invalid_block");
    const selfId = ulid();
    const cyc = await upsert(a, docId, para(selfId, "loop", "V", selfId), null);
    expect(cyc.status).toBe("rejected");
    const orphan = await upsert(a, docId, para(ulid(), "orphan", "V", ulid()), null);
    expect(orphan.status).toBe("applied");
    expect(orphan.normalized).toBe(true);
    expect(orphan.block?.parentId).toBeNull();
  });

  test("pull returns changes since a cursor in commit order, including tombstones", async () => {
    const t = setup();
    const a = await person(t, "sync6@example.com");
    const head = (await a.as.query(api.sync.head, { workspaceId: a.workspaceId })).seq;
    const docId = await newDoc(a, "Pulled");
    const b = para(ulid(), "fresh");
    await upsert(a, docId, b, null);
    const page = await a.as.query(api.sync.pull, { workspaceId: a.workspaceId, cursor: head });
    expect(page.documents.map((d) => d.id)).toContain(docId);
    expect(page.blocks.map((x) => x.block.id)).toContain(b.id);
    expect(page.hasMore).toBe(false);
    const empty = await a.as.query(api.sync.pull, { workspaceId: a.workspaceId, cursor: page.nextCursor });
    expect(empty.blocks).toHaveLength(0);
    // JSON variant used by the native client returns the same data.
    const json = JSON.parse(await a.as.query(api.sync.pullJson, { workspaceId: a.workspaceId, cursor: head }));
    expect(json.blocks.length).toBe(page.blocks.length);
  });

  test("document titles conflict instead of being overwritten", async () => {
    const t = setup();
    const a = await person(t, "sync7@example.com");
    const docId = await newDoc(a, "Draft");
    const push = (title: string, base: number) =>
      a.as.mutation(api.sync.push, { workspaceId: a.workspaceId, deviceId: "device-test-2", ops: [{ opId: ulid(), kind: "document.update", documentId: docId, patch: { title }, baseRevision: base }] });
    expect((await push("Web title", 1))[0]!.status).toBe("applied");
    const r = (await push("Mac title", 1))[0]!;
    expect(r.status).toBe("conflict");
  });
});

describe("note style images", () => {
  test("a note's cover can only be an image uploaded into its own workspace", async () => {
    const t = setup();
    const a = await person(t, "cover-a@example.com");
    const b = await person(t, "cover-b@example.com");
    const docId = await newDoc(a, "Styled");
    // One image in each person's personal workspace (as if uploaded and verified).
    const addFile = (p: typeof a, publicId: string) =>
      t.run(async (ctx) => {
        const ws = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", p.workspaceId)).unique())!;
        const storageId = await ctx.storage.store(new Blob(["x"], { type: "image/png" }));
        await ctx.db.insert("files", {
          publicId, storageId, workspaceId: ws._id, uploadedBy: ws.ownerId, filename: "c.png", mimeType: "image/png",
          size: 1, sha256: "0".repeat(64), kind: "cover", status: "ready", createdAt: Date.now(),
        });
      });
    await addFile(a, "file_mine");
    await addFile(b, "file_theirs");
    const setCover = (value: string) =>
      a.as.mutation(api.sync.push, { workspaceId: a.workspaceId, deviceId: "device-cover", ops: [{ opId: ulid(), kind: "document.update", documentId: docId, patch: { cover: { kind: "image", value } }, baseRevision: null }] });
    expect((await setCover("file_theirs"))[0]!.status).not.toBe("applied");
    expect((await setCover("file_missing"))[0]!.status).not.toBe("applied");
    const ok = (await setCover("file_mine"))[0]!;
    expect(ok.status).toBe("applied");
    expect((ok as { document?: { cover: unknown } }).document?.cover).toEqual({ kind: "image", value: "file_mine" });
    // Colours picked from the image: only valid hex, only by someone who can edit, returned with the URL.
    const palette = { paper: "#F0F6FF", ink: "#1a2e4c", paperDark: "#121a26", inkDark: "#d1dff5", tone: "deep" as const };
    await expect(a.as.mutation(api.files.setPalette, { fileId: "file_mine", palette: { ...palette, ink: "red; background:url(x)" } })).rejects.toThrow();
    await expect(b.as.mutation(api.files.setPalette, { fileId: "file_mine", palette })).rejects.toThrow();
    await a.as.mutation(api.files.setPalette, { fileId: "file_mine", palette });
    const urls = await a.as.query(api.files.urls, { fileIds: ["file_mine"], now: Date.now() });
    expect(urls.file_mine?.palette).toEqual({ ...palette, paper: "#f0f6ff" });
  });
});

describe("tasks", () => {
  test("todo blocks project into task views and stay canonical", async () => {
    const t = setup();
    const a = await person(t, "tasks@example.com");
    const docId = await newDoc(a, "Chores");
    const todo = { ...para(ulid(), "Water plants"), type: "todo", props: { checked: false, dueDate: "2026-09-25" } };
    await upsert(a, docId, todo, null);
    let today = await a.as.query(api.tasks.list, { workspaceId: a.workspaceId, view: "today", today: "2026-09-25" });
    expect(today.map((x) => x.title)).toContain("Water plants");
    await a.as.mutation(api.tasks.update, { blockId: todo.id, checked: true });
    const block = (await a.as.query(api.blocks.list, { documentId: docId }))!.blocks.find((b) => b.id === todo.id)!;
    expect((block.props as { checked: boolean }).checked).toBe(true);
    today = await a.as.query(api.tasks.list, { workspaceId: a.workspaceId, view: "today", today: "2026-09-25" });
    expect(today.map((x) => x.title)).not.toContain("Water plants");
    const done = await a.as.query(api.tasks.list, { workspaceId: a.workspaceId, view: "completed", today: "2026-09-25" });
    expect(done.map((x) => x.title)).toContain("Water plants");
  });

  test("quick add puts tasks into the person's Inbox page (deterministic id, restored from Trash, listed on Home)", async () => {
    const t = setup();
    const a = await person(t, "qa@example.com");
    const r1 = await a.as.mutation(api.tasks.quickAdd, { workspaceId: a.workspaceId, title: "First", today: "2026-09-25" });
    const r2 = await a.as.mutation(api.tasks.quickAdd, { workspaceId: a.workspaceId, title: "Second", today: "2026-09-26" });
    expect(r1.documentId).toBe(r2.documentId);
    expect(r1.documentId).toMatch(/^inbox-[0-9a-f]{16}$/);
    const home = await a.as.query(api.documents.list, { workspaceId: a.workspaceId, view: "all", paginationOpts: { numItems: 50, cursor: null } });
    const inbox = home.page.find((d) => d.id === r1.documentId);
    expect(inbox?.title).toBe("Inbox");
    // Trashing the Inbox and adding another task brings it back.
    await a.as.mutation(api.documents.moveToTrash, { documentId: r1.documentId });
    const r3 = await a.as.mutation(api.tasks.quickAdd, { workspaceId: a.workspaceId, title: "Third", today: "2026-09-26" });
    expect(r3.documentId).toBe(r1.documentId);
    const tasks = await a.as.query(api.tasks.list, { workspaceId: a.workspaceId, view: "all", today: "2026-09-26" });
    expect(tasks.filter((x) => x.documentId === r1.documentId).map((x) => x.title).sort()).toEqual(["First", "Second", "Third"]);
  });
});

describe("public links", () => {
  const secret = "a".repeat(64);
  test("unguessable, revocable, expiring and optionally password protected", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "pub@example.com");
    const docId = await newDoc(a, "Public page");
    await upsert(a, docId, para(ulid(), "Visible to the world"), null);
    const { token, id } = await a.as.mutation(api.sharing.createPublicLink, { documentId: docId });
    expect(token.length).toBeGreaterThanOrEqual(40);
    const open = (pw?: string) => t.mutation(api.sharing.openPublicLink, { token, password: pw, serverSecret: secret, clientKey: "client-1" });
    const ok = await open();
    expect(ok.status).toBe("ok");
    await expect(t.mutation(api.sharing.openPublicLink, { token, serverSecret: "b".repeat(64), clientKey: "c" })).rejects.toThrow(/forbidden/);
    expect((await t.mutation(api.sharing.openPublicLink, { token: `${token}x`, serverSecret: secret, clientKey: "c" })).status).toBe("not_found");
    await a.as.mutation(api.sharing.revokePublicLink, { linkId: id });
    expect((await open()).status).toBe("not_found");

    const expiring = await a.as.mutation(api.sharing.createPublicLink, { documentId: docId, expiresAt: Date.now() + 60_000, password: "correct horse" });
    const openE = (pw?: string) => t.mutation(api.sharing.openPublicLink, { token: expiring.token, password: pw, serverSecret: secret, clientKey: "client-2" });
    expect((await openE()).status).toBe("password_required");
    expect((await openE("wrong password")).status).toBe("password_incorrect");
    expect((await openE("correct horse")).status).toBe("ok");
    vi.advanceTimersByTime(120_000);
    expect((await openE("correct horse")).status).toBe("expired");
    vi.useRealTimers();
  });
});

describe("deletion", () => {
  test("permanent deletion cascades through blocks, tasks, snapshots, comments and nested pages", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "del@example.com");
    const docId = await newDoc(a, "Doomed");
    await upsert(a, docId, { ...para(ulid(), "a task"), type: "todo", props: { checked: false } }, null);
    await a.as.mutation(api.documents.createSnapshot, { documentId: docId, reason: "manual" });
    await a.as.mutation(api.comments.create, { documentId: docId, body: [{ type: "text", text: "note" }] });
    const childId = ulid();
    await a.as.mutation(api.sync.push, {
      workspaceId: a.workspaceId,
      deviceId: "device-test-2",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: childId, parentDocumentId: docId, folderId: null, kind: "document", title: "Child", icon: null } }],
    });
    await expect(a.as.mutation(api.documents.deletePermanently, { documentId: docId, confirmTitle: "Doomed" })).rejects.toThrow(/Trash first/);
    await a.as.mutation(api.documents.moveToTrash, { documentId: docId });
    await expect(a.as.mutation(api.documents.deletePermanently, { documentId: docId, confirmTitle: "Wrong" })).rejects.toThrow(/title/);
    await a.as.mutation(api.documents.deletePermanently, { documentId: docId, confirmTitle: "Doomed" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (let i = 0; i < 5; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const counts = await t.run(async (ctx) => ({
      docs: (await ctx.db.query("documents").collect()).filter((d) => d.publicId === docId || d.publicId === childId).length,
      blocks: (await ctx.db.query("blocks").collect()).filter((b) => (b.props as { checked?: boolean }).checked === false && b.text[0]?.text === "a task").length,
      tasks: (await ctx.db.query("tasks").collect()).filter((x) => x.title === "a task").length,
      comments: (await ctx.db.query("comments").collect()).length,
      snapshots: (await ctx.db.query("documentSnapshots").collect()).filter((s) => s.title === "Doomed").length,
    }));
    expect(counts).toEqual({ docs: 0, blocks: 0, tasks: 0, comments: 0, snapshots: 0 });
    vi.useRealTimers();
  });
});

describe("files", () => {
  test("upload URLs require write access to the document", async () => {
    const t = setup();
    const a = await person(t, "files-a@example.com");
    const b = await person(t, "files-b@example.com");
    const docId = await newDoc(a);
    await expect(
      b.as.mutation(api.files.generateUploadUrl, { workspaceId: a.workspaceId, documentId: docId, filename: "x.png", size: 10, mimeType: "image/png", kind: "image" }),
    ).rejects.toThrow(/not_found/);
    await expect(
      a.as.mutation(api.files.generateUploadUrl, { workspaceId: a.workspaceId, documentId: docId, filename: "huge.png", size: 500 * 1024 * 1024, mimeType: "image/png", kind: "image" }),
    ).rejects.toThrow(/up to/);
    const ok = await a.as.mutation(api.files.generateUploadUrl, { workspaceId: a.workspaceId, documentId: docId, filename: "ok.png", size: 1024, mimeType: "image/png", kind: "image" });
    expect(ok.uploadUrl).toBeTruthy();
  });
});

describe("admin", () => {
  test("admin endpoints look nonexistent to non-admins; admin actions are audited and need reasons", async () => {
    const t = setup();
    const a = await person(t, "boss@example.com");
    const user = await person(t, "user@example.com");
    await expect(user.as.query(api.admin.dashboard, {})).rejects.toThrow(/not_found/);
    await expect(user.as.mutation(api.admin.searchUsers, { query: "boss" })).rejects.toThrow(/not_found/);
    await t.mutation(internal.admin.bootstrapSuperAdmin, { email: "boss@example.com" });
    await expect(t.mutation(internal.admin.bootstrapSuperAdmin, { email: "user@example.com" })).rejects.toThrow(/already exists/);
    const dash = await a.as.query(api.admin.dashboard, {});
    expect(dash.totals.users).toBeGreaterThanOrEqual(2);
    await a.as.mutation(api.admin.viewUser, { profileId: user.profileId });
    await expect(a.as.mutation(api.admin.suspendUser, { profileId: user.profileId, suspend: true, confirmEmail: "user@example.com", reason: "no" })).rejects.toThrow(/reason/);
    await a.as.mutation(api.admin.suspendUser, { profileId: user.profileId, suspend: true, confirmEmail: "user@example.com", reason: "Reported abuse, ticket 1234" });
    expect((await user.as.query(api.users.me, {})).state).toBe("suspended");
    const log = await a.as.query(api.admin.auditLog, {});
    expect(log.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["user.view", "user.suspend", "bootstrap.super_admin"]));
    // Support admins cannot grant roles.
    await t.run(async (ctx) => {
      const p = (await ctx.db.query("profiles").collect()).find((x) => x.email === "user@example.com")!;
      await ctx.db.patch(p._id, { status: "active", platformRole: "support_admin" });
    });
    await expect(user.as.mutation(api.admin.setPlatformRole, { profileId: a.profileId, role: null, confirmEmail: "boss@example.com", reason: "Trying to escalate" })).rejects.toThrow(/not_found/);
  });

  test("there is no admin path that returns document content", async () => {
    const t = setup();
    const a = await person(t, "boss2@example.com");
    await t.mutation(internal.admin.bootstrapSuperAdmin, { email: "boss2@example.com" });
    const detail = await a.as.mutation(api.admin.viewUser, { profileId: a.profileId });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("Welcome to Folevi");
    expect(serialized).not.toContain("quiet place for ideas");
    const ws = await a.as.mutation(api.admin.viewWorkspace, { workspaceId: a.workspaceId });
    expect(JSON.stringify(ws)).not.toContain("quiet place for ideas");
  });
});

describe("rate limits", () => {
  test("invites are rate limited and recorded", async () => {
    const t = setup();
    const a = await person(t, "rl@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Big team" });
    await t.run(async (ctx) => {
      const w = (await ctx.db.query("workspaces").collect()).find((x) => x.publicId === teamId)!;
      await ctx.db.patch(w._id, { memberLimit: 1000 });
    });
    let error: unknown = null;
    for (let i = 0; i < 40 && !error; i++) {
      try {
        await a.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: `p${i}@example.com`, role: "viewer" });
      } catch (e) {
        error = e;
      }
    }
    expect(String(error)).toMatch(/rate_limited/);
    const events = await t.run(async (ctx) => (await ctx.db.query("rateLimitEvents").collect()).length);
    expect(events).toBeGreaterThan(0);
  });
});
