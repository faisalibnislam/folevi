// Proposed changes: with "Ask me before changes are made to existing notes" on, a connected app's append to an
// existing note waits in Changes instead of being made; the person accepts it (made as the app, with a version
// saved first) or rejects it, and it expires after 14 days. Off (the default), apps write as before.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, components, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function note(who: Person, title: string, lines: string[], scope = PERSONAL as Person["scope"]) {
  const id = ulid();
  await who.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-proposals",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      ...lines.map((text, i) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), text, String.fromCharCode(80 + i)), baseRevision: null, fields: ["content", "position"] })),
    ] as never,
  });
  return id;
}

async function token(who: Person) {
  const { token } = await who.as.mutation(api.apiTokens.create, { name: "Journal script", scopes: ["notes:read", "notes:write"], personal: true, workspaceIds: [], expiresInDays: 90 });
  return token;
}

async function rest(t: T, bearer: string, method: string, path: string, body?: unknown) {
  const res = await t.fetch(`/api/v1${path}`, { method, headers: { authorization: `Bearer ${bearer}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- responses are read field by field
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const CLIENT_ID = "claude-proposals-client";

/** An MCP connection for `who` (the test client, a grant, an access token); returns the bearer value. */
async function connect(t: T, who: Person) {
  const exists = await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "oauthClient", where: [{ field: "clientId", value: CLIENT_ID }] }));
  if (!exists) {
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "oauthClient", data: { clientId: CLIENT_ID, name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], createdAt: Date.now(), updatedAt: Date.now() } } });
    });
  }
  const scopes = ["notes:read", "notes:write", "tasks:read", "tasks:write"];
  await who.as.mutation(api.mcp.saveGrant, { clientId: CLIENT_ID, scopes, personal: true, workspaceIds: [], includeShared: false, createOnly: false });
  const authSubject = await t.run(async (ctx) => (await ctx.db.get(who.profileId as Id<"profiles">))!.authSubject);
  const raw = `tok${ulid()}`;
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "oauthAccessToken", data: { token: createHash("sha256").update(raw).digest("base64url"), clientId: CLIENT_ID, userId: authSubject, scopes, expiresAt: Date.now() + 3_600_000, createdAt: Date.now() } },
    });
  });
  return `fvat_${raw}`;
}

let rpcId = 0;
async function mcpCall(t: T, bearer: string, name: string, args: Record<string, unknown>) {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { isError?: boolean; structuredContent?: Record<string, unknown> } };
  return { status: res.status, isError: body.result?.isError === true, data: body.result?.structuredContent ?? null };
}

const textOf = async (who: Person, documentId: string) => {
  const page = await who.as.query(api.blocks.list, { documentId });
  return [...(page?.blocks ?? [])].sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((b) => (b.text as { text?: string }[]).map((n) => n.text ?? "").join(""));
};

const review = (who: Person, on: boolean) => who.as.mutation(api.users.updateProfile, { reviewAppEdits: on });

describe("asking before apps change existing notes", () => {
  test("off (the default): an append is made at once, as before", async () => {
    const t = setup();
    const a = await person(t, "proposals-off@example.com");
    const me = await a.as.query(api.users.me, {});
    expect(me.state === "ready" && me.profile.reviewAppEdits).toBe(false);
    const id = await note(a, "Journal", ["Monday."]);
    const r = await rest(t, await token(a), "POST", `/notes/${id}/append`, { markdown: "Tuesday." });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id, added: 1 });
    expect(await textOf(a, id)).toEqual(["Monday.", "Tuesday."]);
    expect(await a.as.query(api.proposals.count, {})).toBe(0);
  });

  test("on: the REST API's append waits as a proposal (202), the note is unchanged, and the person is told", async () => {
    const t = setup();
    const a = await person(t, "proposals-rest@example.com");
    await review(a, true);
    const id = await note(a, "Journal", ["Monday."]);
    const r = await rest(t, await token(a), "POST", `/notes/${id}/append`, { markdown: "Tuesday: **ship it**." });
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ id, title: "Journal", proposed: true, status: "pending", proposalId: expect.any(String), message: expect.stringMatching(/^Proposed for review; the person will see it in Folevi's Changes page/) });
    expect(new Date(r.json.expiresAt).getTime() - Date.now()).toBeGreaterThan(13 * 86_400_000);
    expect(await textOf(a, id)).toEqual(["Monday."]);

    const [p] = await a.as.query(api.proposals.list, {});
    expect(p).toMatchObject({ id: r.json.proposalId, documentId: id, title: "Journal", source: "app", sourceName: "Journal script", summary: "Add 1 line at the end: “Tuesday: ship it.”", problem: null });
    expect(p!.blocks).toHaveLength(1);
    expect(await a.as.query(api.proposals.count, {})).toBe(1);
    const bell = await a.as.query(api.notifications.list, {});
    expect(bell.find((n) => n.toChanges)).toMatchObject({ title: "Journal script proposed a change to “Journal”. Review it in Changes.", documentId: id, read: false });
  });

  test("on: MCP's append_to_note answers that it's proposed, so the app can say so; a retry proposes once", async () => {
    const t = setup();
    const a = await person(t, "proposals-mcp@example.com");
    await review(a, true);
    const id = await note(a, "Packing", ["Socks."]);
    const bearer = await connect(t, a);
    const out = await mcpCall(t, bearer, "append_to_note", { noteId: id, markdown: "- Charger" });
    expect(out.isError).toBe(false);
    expect(out.data).toMatchObject({ noteId: id, proposed: true, status: "pending", message: expect.stringContaining("Changes page") });
    expect(out.data).not.toHaveProperty("added");
    expect(await textOf(a, id)).toEqual(["Socks."]);
    expect((await a.as.query(api.proposals.list, {}))[0]).toMatchObject({ sourceName: "Claude", source: "app" });
    // Creating notes and tasks stays direct.
    const made = await mcpCall(t, bearer, "create_note", { title: "New", markdown: "Fresh." });
    expect(made.data).toMatchObject({ noteId: expect.any(String) });
    const task = await mcpCall(t, bearer, "add_task", { text: "Buy tape", noteId: id });
    expect(task.data).toMatchObject({ taskId: expect.any(String) });
    expect(await a.as.query(api.proposals.count, {})).toBe(1);
  });

  test("accept: added at the end of the note as it is now, as the app, with a version saved first; twice is once", async () => {
    const t = setup();
    const a = await person(t, "proposals-accept@example.com");
    await review(a, true);
    const id = await note(a, "Journal", ["Monday."]);
    const r = await rest(t, await token(a), "POST", `/notes/${id}/append`, { markdown: "Tuesday." });
    // The note moved on meanwhile: the proposal still lands at the end.
    await a.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-proposals", ops: [{ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), "Monday, later.", "Z"), baseRevision: null, fields: ["content", "position"] }] as never });
    const versionsBefore = await t.run(async (ctx) => (await ctx.db.query("documentSnapshots").collect()).length);

    expect(await a.as.mutation(api.proposals.accept, { proposalId: r.json.proposalId })).toEqual({ status: "accepted", documentId: id });
    expect(await textOf(a, id)).toEqual(["Monday.", "Monday, later.", "Tuesday."]);
    const versions = await t.run(async (ctx) => await ctx.db.query("documentSnapshots").collect());
    expect(versions.length).toBeGreaterThan(versionsBefore);
    expect(versions.some((v) => v.reason === "api")).toBe(true);
    const added = await t.run(async (ctx) => (await ctx.db.query("blocks").collect()).find((b) => (b.text as { text?: string }[])[0]?.text === "Tuesday."));
    expect(added?.updatedVia).toBe("app");

    expect(await a.as.mutation(api.proposals.accept, { proposalId: r.json.proposalId })).toEqual({ status: "accepted", documentId: id });
    expect(await textOf(a, id)).toEqual(["Monday.", "Monday, later.", "Tuesday."]);
    expect(await a.as.query(api.proposals.list, {})).toEqual([]);
    await expect(a.as.mutation(api.proposals.reject, { proposalId: r.json.proposalId })).rejects.toThrow(/already accepted/);
  });

  test("reject leaves the note as it is; a rejected proposal can't be accepted", async () => {
    const t = setup();
    const a = await person(t, "proposals-reject@example.com");
    await review(a, true);
    const id = await note(a, "Journal", ["Monday."]);
    const r = await rest(t, await token(a), "POST", `/notes/${id}/append`, { markdown: "Tuesday." });
    await a.as.mutation(api.proposals.reject, { proposalId: r.json.proposalId });
    await a.as.mutation(api.proposals.reject, { proposalId: r.json.proposalId });
    expect(await textOf(a, id)).toEqual(["Monday."]);
    expect(await a.as.query(api.proposals.count, {})).toBe(0);
    await expect(a.as.mutation(api.proposals.accept, { proposalId: r.json.proposalId })).rejects.toThrow(/rejected/);
  });

  test("a note that's gone can't take it: accept says so and the proposal stays, to reject", async () => {
    const t = setup();
    const a = await person(t, "proposals-gone@example.com");
    await review(a, true);
    const id = await note(a, "Journal", ["Monday."]);
    const r = await rest(t, await token(a), "POST", `/notes/${id}/append`, { markdown: "Tuesday." });
    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [id], action: { kind: "trash" } });
    await expect(a.as.mutation(api.proposals.accept, { proposalId: r.json.proposalId })).rejects.toThrow("This note changed; the proposal can't be applied.");
    expect((await a.as.query(api.proposals.list, {}))[0]?.problem).toMatch(/gone/);
    await a.as.mutation(api.proposals.reject, { proposalId: r.json.proposalId });
    expect(await a.as.query(api.proposals.count, {})).toBe(0);
  });

  test("after 14 days a proposal expires: no longer listed, and it can't be accepted", async () => {
    const t = setup();
    const a = await person(t, "proposals-expire@example.com");
    await review(a, true);
    const id = await note(a, "Journal", ["Monday."]);
    const r = await rest(t, await token(a), "POST", `/notes/${id}/append`, { markdown: "Tuesday." });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("proposals").collect())[0]!;
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    // Past its time, it's already left out before the sweep marks it.
    expect(await a.as.query(api.proposals.list, { now: Date.now() })).toEqual([]);
    await expect(a.as.mutation(api.proposals.accept, { proposalId: r.json.proposalId })).rejects.toThrow(/expired/);
    expect(await t.mutation(internal.proposals.sweep, {})).toMatchObject({ expired: 1 });
    expect(await t.run(async (ctx) => (await ctx.db.query("proposals").collect())[0]!.status)).toBe("expired");
    expect(await textOf(a, id)).toEqual(["Monday."]);
  });

  test("only the person whose app proposed it may accept it, and only while they can edit the note", async () => {
    const t = setup();
    const owner = await person(t, "proposals-owner@example.com");
    const editor = await person(t, "proposals-editor@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, editor, "proposals-editor@example.com", workspaceId, "editor");
    const id = await note(owner, "Shared plan", ["Step one."], scope);
    await review(editor, true);
    const { token: raw } = await editor.as.mutation(api.apiTokens.create, { name: "Editor's script", scopes: ["notes:write"], personal: false, workspaceIds: [workspaceId], expiresInDays: 90 });
    const r = await rest(t, raw, "POST", `/notes/${id}/append`, { markdown: "Step two." });
    expect(r.status).toBe(202);
    const proposalId = r.json.proposalId as string;
    // The note's owner didn't ask for it, and it isn't theirs to decide: it's the editor's app.
    await expect(owner.as.mutation(api.proposals.accept, { proposalId })).rejects.toThrow(/isn't there anymore/);
    await expect(owner.as.mutation(api.proposals.reject, { proposalId })).rejects.toThrow(/isn't there anymore/);
    expect(await owner.as.query(api.proposals.count, {})).toBe(0);
    // The editor can now only view the workspace's notes: they can't make the change.
    await t.run(async (ctx) => {
      const m = (await ctx.db.query("workspaceMembers").collect()).find((x) => x.profileId === editor.profileId)!;
      await ctx.db.patch(m._id, { memberAccess: "view" });
    });
    expect((await editor.as.query(api.proposals.list, {}))[0]?.problem).toBe("You can't edit this note anymore.");
    await expect(editor.as.mutation(api.proposals.accept, { proposalId })).rejects.toThrow(/can't edit this note/);
    expect(await textOf(owner, id)).toEqual(["Step one."]);
  });
});
