// Connected apps (MCP): the protocol rules, sign-in through an OAuth access token, grants and places,
// and each tool through POST /mcp, as an app would call it.
import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { api, components, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { decodeHeaderValue, parseMessage } from "../../convex/lib/mcp/protocol";
import { checkArgs, TOOL_BY_NAME } from "../../convex/lib/mcp/tools";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const headersOf = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

describe("protocol", () => {
  const modern = (method: string, params: Record<string, unknown> = {}) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });

  test("modern requests need matching version, method and name headers", () => {
    const body = modern("tools/call", { name: "get_note", arguments: {} });
    const good = { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "get_note" };
    expect(parseMessage(body, headersOf(good))).toMatchObject({ ok: true, era: "modern", version: "2026-07-28" });
    expect(parseMessage(body, headersOf({ ...good, "mcp-protocol-version": "2025-11-25" }))).toMatchObject({ ok: false, status: 400, body: { error: { code: -32020 } } });
    expect(parseMessage(body, headersOf({ ...good, "mcp-method": "tools/list" }))).toMatchObject({ ok: false, body: { error: { code: -32020 } } });
    expect(parseMessage(body, headersOf({ ...good, "mcp-name": "search_notes" }))).toMatchObject({ ok: false, body: { error: { code: -32020 } } });
    // A name sent in the base64 form counts as the same name.
    expect(parseMessage(body, headersOf({ ...good, "mcp-name": `=?base64?${btoa("get_note")}?=` }))).toMatchObject({ ok: true });
  });

  test("an unknown modern version is refused with the supported ones", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } });
    const out = parseMessage(body, headersOf({ "mcp-protocol-version": "2099-01-01", "mcp-method": "tools/list" }));
    expect(out).toMatchObject({ ok: false, status: 400, body: { error: { code: -32022, data: { requested: "2099-01-01", supported: expect.arrayContaining(["2026-07-28", "2025-11-25"]) } } } });
  });

  test("legacy clients: initialize negotiates, later requests carry the header (or default to 2025-03-26)", () => {
    const init = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(parseMessage(init, headersOf({}))).toMatchObject({ ok: true, era: "legacy", version: "2025-06-18" });
    const old = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-01-01" } });
    expect(parseMessage(old, headersOf({}))).toMatchObject({ ok: true, version: "2025-11-25" });
    const list = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(parseMessage(list, headersOf({}))).toMatchObject({ ok: true, era: "legacy", version: "2025-03-26" });
    expect(parseMessage(list, headersOf({ "mcp-protocol-version": "1999-01-01" }))).toMatchObject({ ok: false, status: 400 });
  });

  test("malformed bodies and batches are refused", () => {
    expect(parseMessage("{", headersOf({}))).toMatchObject({ ok: false, body: { error: { code: -32700 } } });
    expect(parseMessage("[]", headersOf({}))).toMatchObject({ ok: false, body: { error: { code: -32600 } } });
    expect(parseMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), headersOf({}))).toMatchObject({ ok: false });
    // Base64 of bytes that aren't UTF-8 can't match any name.
    expect(decodeHeaderValue("=?base64?/w==?=")).toBeNull();
    expect(decodeHeaderValue("plain")).toBe("plain");
  });

  test("tool arguments are checked against the schema", () => {
    const create = TOOL_BY_NAME.get("create_note")!;
    expect(checkArgs(create, { title: "Plan", markdown: "- one" })).toBeNull();
    expect(checkArgs(create, { title: "Plan" })).toBe('"markdown" is required.');
    expect(checkArgs(create, { title: "Plan", markdown: "x", extra: 1 })).toBe('Unknown argument "extra".');
    const update = TOOL_BY_NAME.get("update_task")!;
    expect(checkArgs(update, { taskId: "t", dueDate: null })).toBeNull();
    expect(checkArgs(update, { taskId: "t", dueDate: "tomorrow" })).toMatch(/isn't valid/);
    expect(checkArgs(TOOL_BY_NAME.get("search_notes")!, { query: "x", limit: 99 })).toBe('"limit" must be at most 20.');
  });
});

// ---------------------------------------------------------------- through /mcp

const CLIENT_ID = "claude-test-client";

async function hashed(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

/** Registers the test client, saves `who`'s grant for it and issues an access token; returns the bearer value. */
async function connect(t: T, who: Person, grant: { scopes?: string[]; personal?: boolean; workspaceIds?: string[]; includeShared?: boolean; createOnly?: boolean } = {}) {
  const exists = await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "oauthClient", where: [{ field: "clientId", value: CLIENT_ID }] }));
  if (!exists) {
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "oauthClient", data: { clientId: CLIENT_ID, name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], createdAt: Date.now(), updatedAt: Date.now() } } });
    });
  }
  const scopes = grant.scopes ?? ["notes:read", "notes:write", "tasks:read", "tasks:write"];
  await who.as.mutation(api.mcp.saveGrant, { clientId: CLIENT_ID, scopes, personal: grant.personal ?? true, workspaceIds: grant.workspaceIds ?? [], includeShared: grant.includeShared ?? false, createOnly: grant.createOnly ?? false });
  const authSubject = await t.run(async (ctx) => (await ctx.db.get(who.profileId as Id<"profiles">))!.authSubject);
  const raw = `tok${ulid()}`;
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "oauthAccessToken", data: { token: await hashed(raw), clientId: CLIENT_ID, userId: authSubject, scopes, expiresAt: Date.now() + 3_600_000, createdAt: Date.now() } },
    });
  });
  return `fvat_${raw}`;
}

let rpcId = 0;
async function rpc(t: T, bearer: string | null, method: string, params: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...extraHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as { result?: Record<string, unknown>; error?: { code: number; message: string } }) : null };
}

async function call(t: T, bearer: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(t, bearer, "tools/call", { name, arguments: args });
  const result = r.body?.result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] } | undefined;
  return { status: r.status, isError: result?.isError === true, data: result?.structuredContent ?? null, text: result?.content?.[0]?.text ?? "", raw: r };
}

async function note(who: Person, title: string, lines: string[], scope = PERSONAL as Person["scope"]) {
  const id = ulid();
  await who.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-mcp",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      ...lines.map((text, i) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), text, String.fromCharCode(80 + i)), baseRevision: null, fields: ["content", "position"] })),
    ] as never,
  });
  return id;
}

describe("POST /mcp", () => {
  test("no token: 401 pointing at the resource metadata; a bad or revoked token: invalid_token", async () => {
    const t = setup();
    const a = await person(t, "mcp-auth@example.com");
    const none = await rpc(t, null, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    expect((await rpc(t, "fvat_nope", "tools/list")).headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect((await rpc(t, "not-ours", "tools/list")).status).toBe(401);

    const bearer = await connect(t, a);
    expect((await rpc(t, bearer, "tools/list")).status).toBe(200);
    // Disconnecting in Settings ends it at once.
    const [grant] = await a.as.query(api.mcp.listGrants, {});
    await a.as.mutation(api.mcp.revokeGrant, { grantId: grant!.id });
    expect((await rpc(t, bearer, "tools/list")).status).toBe(401);
  });

  test("legacy initialize, discover, and tools listed by scope", async () => {
    const t = setup();
    const a = await person(t, "mcp-init@example.com");
    const bearer = await connect(t, a, { scopes: ["notes:read", "tasks:read"] });
    const init = await rpc(t, bearer, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    expect(init.body?.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "folevi" }, capabilities: { tools: {} } });
    expect((await rpc(t, bearer, "notifications/initialized")).status).toBe(200);
    const tools = (await rpc(t, bearer, "tools/list")).body?.result?.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((x) => x.name)).toEqual(["list_places", "search_notes", "get_note", "list_recent_notes", "list_folders", "list_tags", "list_tasks"]);
    expect(tools.every((x) => x.annotations.readOnlyHint)).toBe(true);

    const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } };
    const discover = await rpc(t, bearer, "server/discover", meta, { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" });
    expect(discover.body?.result).toMatchObject({ resultType: "complete", supportedVersions: expect.arrayContaining(["2026-07-28", "2025-06-18"]), cacheScope: "private" });
    // A write the connection wasn't given: 403 asking for that scope.
    const denied = await rpc(t, bearer, "tools/call", { name: "create_note", arguments: { title: "x", markdown: "y" } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain('error="insufficient_scope", scope="notes:write"');
  });

  test("search, read and recent notes stay inside the granted places", async () => {
    const t = setup();
    const a = await person(t, "mcp-read@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Studio");
    const mine = await note(a, "Garden plan", ["Plant tomatoes in May.", "Water the basil."]);
    const team = await note(a, "Studio garden", ["Team tomatoes."], scope);
    const bearer = await connect(t, a, { personal: true, workspaceIds: [] });

    const places = await call(t, bearer, "list_places");
    expect(places.data).toEqual({ places: [{ id: "personal", name: "Personal" }], includesSharedPages: false });
    const found = await call(t, bearer, "search_notes", { query: "tomatoes" });
    expect((found.data!.results as { id: string }[]).map((r) => r.id)).toEqual([mine]);
    const got = await call(t, bearer, "get_note", { noteId: mine });
    expect(got.data).toMatchObject({ id: mine, title: "Garden plan", place: "Personal" });
    expect(got.data!.markdown).toMatch(/^<untrusted_note id="[^"]+" title="Garden plan">\nPlant tomatoes in May\./);
    // The workspace wasn't granted: its notes don't exist for this connection.
    expect((await call(t, bearer, "get_note", { noteId: team })).isError).toBe(true);
    expect((await call(t, bearer, "search_notes", { query: "tomatoes", place: workspaceId })).text).toMatch(/can't use the place/);
    const recent = await call(t, bearer, "list_recent_notes");
    expect((recent.data!.notes as { id: string }[]).map((n) => n.id)).toContain(mine);
    // As a resource too.
    const res = await rpc(t, bearer, "resources/read", { uri: `folevi://note/${mine}` });
    expect((res.body?.result?.contents as { text: string }[])[0]!.text).toContain("# Garden plan");
  });

  test("list_folders gives nested folders their path", async () => {
    const t = setup();
    const a = await person(t, "mcp-folders@example.com");
    const work = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Work" })).id;
    const clients = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Clients", parentFolderId: work })).id;
    await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Acme", parentFolderId: clients });
    const bearer = await connect(t, a, { personal: true, workspaceIds: [] });
    const folders = (await call(t, bearer, "list_folders")).data!.folders as { name: string; path: string; place: string }[];
    expect(folders.map((f) => [f.name, f.path])).toEqual(expect.arrayContaining([["Work", "Work"], ["Clients", "Work / Clients"], ["Acme", "Work / Clients / Acme"]]));
    expect(folders.every((f) => f.place === "Personal")).toBe(true);
  });

  test("a workspace member's grant can't reach a page restricted away from them", async () => {
    const t = setup();
    const owner = await person(t, "mcp-owner@example.com");
    const member = await person(t, "mcp-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Board");
    await join(t, owner, member, "mcp-member@example.com", workspaceId, "editor");
    const secret = await note(owner, "Board only", ["Salaries"], scope);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const bearer = await connect(t, member, { personal: false, workspaceIds: [workspaceId] });
    expect((await call(t, bearer, "get_note", { noteId: secret })).isError).toBe(true);
    expect(((await call(t, bearer, "search_notes", { query: "Salaries" })).data!.results as unknown[]).length).toBe(0);
  });

  test("writes: create, append (versioned), tasks; a retried request changes nothing twice", async () => {
    const t = setup();
    const a = await person(t, "mcp-write@example.com");
    const bearer = await connect(t, a);
    const made = await call(t, bearer, "create_note", { title: "Trip", markdown: "## Packing\n- [ ] Passport\n- [ ] Charger" });
    expect(made.data).toMatchObject({ title: "Trip", place: "Personal" });
    const noteId = made.data!.noteId as string;
    const tasks = await call(t, bearer, "list_tasks", { view: "inbox" });
    expect((tasks.data!.tasks as { text: string }[]).map((x) => x.text)).toEqual(expect.arrayContaining([expect.stringContaining("Passport")]));

    const appended = await call(t, bearer, "append_to_note", { noteId, markdown: "Remember the adapter." });
    expect(appended.data).toMatchObject({ noteId, added: 1 });
    const versions = await t.run(async (ctx) => ctx.db.query("documentSnapshots").collect());
    expect(versions.some((v) => v.reason === "mcp")).toBe(true);
    expect((await call(t, bearer, "get_note", { noteId })).data!.markdown).toContain("Remember the adapter.");

    const added = await call(t, bearer, "add_task", { text: "Book the hotel", dueDate: "2026-11-02" });
    const taskId = added.data!.taskId as string;
    expect(added.data!.note).toMatchObject({ title: "Inbox" });
    const done = await call(t, bearer, "complete_task", { taskId });
    expect(done.data).toMatchObject({ taskId, done: true });
    const moved = await call(t, bearer, "update_task", { taskId, dueDate: "2026-11-05", priority: "high" });
    expect(moved.data).toMatchObject({ dueDate: "2026-11-05", priority: "high" });

    // The same JSON-RPC request sent again (a retry): the first answer, no second note.
    const body = JSON.stringify({ jsonrpc: "2.0", id: "retry-1", method: "tools/call", params: { name: "create_note", arguments: { title: "Once", markdown: "x" } } });
    const send = () => t.fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body });
    const first = (await (await send()).json()) as { result: { structuredContent: { noteId: string } } };
    const second = (await (await send()).json()) as { result: { structuredContent: { noteId: string; repeated?: boolean } } };
    expect(second.result.structuredContent).toMatchObject({ noteId: first.result.structuredContent.noteId, repeated: true });
    const onces = await t.run(async (ctx) => (await ctx.db.query("documents").collect()).filter((d) => d.title === "Once"));
    expect(onces).toHaveLength(1);

    // Activity shows in Settings, without arguments.
    const [grant] = await a.as.query(api.mcp.listGrants, {});
    expect(grant!.recent.map((e) => e.tool)).toEqual(expect.arrayContaining(["create_note", "update_task"]));
    const events = await t.run(async (ctx) => ctx.db.query("mcpEvents").collect());
    expect(JSON.stringify(events.map(({ result: _r, ...e }) => e))).not.toContain("Passport");
  });

  test("“Only add new things” blocks changes to existing tasks; read-only places can't be written", async () => {
    const t = setup();
    const a = await person(t, "mcp-addonly@example.com");
    const bearer = await connect(t, a, { createOnly: true });
    const added = await call(t, bearer, "add_task", { text: "Call Sam" });
    expect(added.isError).toBe(false);
    const done = await call(t, bearer, "complete_task", { taskId: added.data!.taskId as string });
    expect(done.isError).toBe(true);
    expect(done.text).toMatch(/only add new notes and tasks/);
  });
});

describe("account deletion", () => {
  test("a deleted account's connected apps and their log go with it", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const a = await person(t, "mcp-leaving@example.com");
      await connect(t, a);
      const profileId = a.profileId as Id<"profiles">;
      const now = Date.now();
      await t.run(async (ctx) => {
        const grant = (await ctx.db.query("mcpGrants").withIndex("by_profile", (q) => q.eq("profileId", profileId)).first())!;
        await ctx.db.insert("mcpEvents", { grantId: grant._id, profileId, tool: "search_notes", targets: [], outcome: "ok", at: now });
        await ctx.db.patch(profileId, { status: "pending_deletion" });
        await ctx.db.insert("deletionJobs", { kind: "account", targetId: a.profileId, requestedBy: profileId, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
      });
      for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
      const left = await t.run(async (ctx) => ({ grants: await ctx.db.query("mcpGrants").collect(), events: await ctx.db.query("mcpEvents").collect() }));
      expect(left).toEqual({ grants: [], events: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});
