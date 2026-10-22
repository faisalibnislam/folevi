// The REST API (/api/v1) and its personal access tokens: tokens kept only as hashes, revoked and expired
// ones refused, scopes and places enforced, every endpoint, idempotent retries, rate limits and errors.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { errorFor, matchRoute } from "../../convex/lib/restApi";
import { ConvexError } from "convex/values";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function token(who: Person, opts: { scopes?: string[]; personal?: boolean; workspaceIds?: string[]; expiresInDays?: number | null; name?: string } = {}) {
  const { token } = await who.as.mutation(api.apiTokens.create, {
    name: opts.name ?? "Script",
    scopes: opts.scopes ?? ["notes:read", "notes:write", "tasks:read", "tasks:write"],
    personal: opts.personal ?? true,
    workspaceIds: opts.workspaceIds ?? [],
    expiresInDays: opts.expiresInDays === undefined ? 90 : opts.expiresInDays,
  });
  return token;
}

async function call(t: T, bearer: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await t.fetch(`/api/v1${path}`, {
    method,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- responses are read field by field
  return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as Record<string, any> };
}

async function note(who: Person, title: string, lines: string[], scope = PERSONAL as Person["scope"], folderId: string | null = null) {
  const id = ulid();
  await who.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-rest",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId, kind: "document", title, icon: null } },
      ...lines.map((text, i) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), text, String.fromCharCode(80 + i)), baseRevision: null, fields: ["content", "position"] })),
    ] as never,
  });
  return id;
}

describe("routes", () => {
  test("paths and methods", () => {
    expect(matchRoute("GET", "/notes/01ABC")).toEqual({ route: { name: "notes.get", id: "01ABC" } });
    expect(matchRoute("POST", "/notes/01ABC/append")).toEqual({ route: { name: "notes.append", id: "01ABC" } });
    expect(matchRoute("DELETE", "/notes")).toEqual({ allowed: ["GET", "POST"] });
    expect(matchRoute("GET", "/notes/../secrets")).toBeNull();
    expect(matchRoute("GET", "/nope")).toBeNull();
  });
});

describe("errors for end-to-end encrypted places", () => {
  test("a switch that's off, a locked note or a device-only write get their own codes and messages, not a 500", () => {
    const off = errorFor(new ConvexError({ code: "e2ee_switch_off", message: "Turn on Apps and integrations in Settings > Privacy.", switch: "apps" }));
    expect(off).toEqual({ status: 403, code: "e2ee_switch_off", message: "Turn on Apps and integrations in Settings > Privacy." });
    expect(errorFor(new ConvexError({ code: "e2ee_locked", message: "Locked." })).status).toBe(403);
    expect(errorFor(new ConvexError({ code: "e2ee_required", message: "Update." })).status).toBe(409);
    expect(errorFor(new ConvexError({ code: "e2ee_device_only", message: "Device." })).status).toBe(409);
    expect(errorFor(new Error("boom")).status).toBe(500);
  });
});

describe("personal access tokens", () => {
  test("shown once, kept only as a SHA-256 hash, listed, limited to 20 and revoked at once", async () => {
    const t = setup();
    const a = await person(t, "pat@example.com");
    const raw = await token(a, { name: "Backup script" });
    expect(raw).toMatch(/^fvpat_[A-Za-z0-9_-]{43}$/);
    const rows = await t.run(async (ctx) => ctx.db.query("apiTokens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash("sha256").update(raw).digest("base64url"));
    expect(JSON.stringify(rows)).not.toContain(raw.slice(10));
    const [listed] = await a.as.query(api.apiTokens.list, {});
    expect(listed).toMatchObject({ name: "Backup script", hint: raw.slice(0, 10), places: ["Personal"], lastUsedAt: null });
    expect(listed!.expiresAt! - listed!.createdAt).toBe(90 * 86_400_000);

    expect((await call(t, raw, "GET", "/places")).status).toBe(200);
    expect((await a.as.query(api.apiTokens.list, {}))[0]!.lastUsedAt).not.toBeNull();

    for (let i = 1; i < 20; i++) await token(a, { name: `T${i}` });
    await expect(token(a, { name: "One too many" })).rejects.toThrow(/up to 20 tokens/);

    await a.as.mutation(api.apiTokens.revoke, { tokenId: listed!.id });
    const after = await call(t, raw, "GET", "/places");
    expect(after.status).toBe(401);
    expect(after.json.error.code).toBe("unauthorized");
    // Someone else can't revoke your token.
    const b = await person(t, "pat-other@example.com");
    const yours = (await a.as.query(api.apiTokens.list, {}))[0]!;
    await expect(b.as.mutation(api.apiTokens.revoke, { tokenId: yours.id })).rejects.toThrow();
  });

  test("an expired token, a malformed one and none at all are refused", async () => {
    const t = setup();
    const a = await person(t, "pat-expired@example.com");
    const raw = await token(a, { expiresInDays: 30 });
    const forever = await token(a, { expiresInDays: null, name: "Forever" });
    expect((await a.as.query(api.apiTokens.list, {})).find((x) => x.name === "Forever")!.expiresAt).toBeNull();
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("apiTokens").collect()).find((r) => r.name === "Script")!;
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    const expired = await call(t, raw, "GET", "/places");
    expect(expired.status).toBe(401);
    expect(expired.json.error.message).toMatch(/expired/);
    expect((await call(t, forever, "GET", "/places")).status).toBe(200);
    const none = await call(t, null, "GET", "/places");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain('Bearer realm="Folevi"');
    expect((await call(t, "fvpat_nope", "GET", "/places")).status).toBe(401);
    expect((await call(t, "fvat_an-mcp-token", "GET", "/places")).status).toBe(401);
    await expect(a.as.mutation(api.apiTokens.create, { name: "x", scopes: ["notes:read"], personal: true, workspaceIds: [], expiresInDays: 7 })).rejects.toThrow(/expires/);
    await expect(a.as.mutation(api.apiTokens.create, { name: "x", scopes: ["admin"], personal: true, workspaceIds: [], expiresInDays: 30 })).rejects.toThrow(/at least one/);
  });
});

describe("/api/v1", () => {
  test("scopes: a read-only token can't write, a notes token can't see tasks", async () => {
    const t = setup();
    const a = await person(t, "rest-scope@example.com");
    const reader = await token(a, { scopes: ["notes:read"] });
    const denied = await call(t, reader, "POST", "/notes", { title: "x", markdown: "y" });
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe("insufficient_scope");
    expect(denied.headers.get("www-authenticate")).toContain('scope="notes:write"');
    expect((await call(t, reader, "GET", "/tasks")).status).toBe(403);
    expect((await call(t, reader, "PATCH", "/tasks/abc", { completed: true })).status).toBe(403);
    // Places are listed with any scope.
    expect((await call(t, reader, "GET", "/places")).json).toEqual({ data: [{ id: "personal", name: "Personal" }] });
  });

  test("places: a workspace the token wasn't given is out of reach (403 by name, 404 by note)", async () => {
    const t = setup();
    const a = await person(t, "rest-place@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Studio");
    const team = await note(a, "Studio plan", ["Team only"], scope);
    const raw = await token(a, { personal: true, workspaceIds: [] });
    expect((await call(t, raw, "GET", `/notes?place=${workspaceId}`)).status).toBe(403);
    expect((await call(t, raw, "GET", `/notes/${team}`)).status).toBe(404);
    expect((await call(t, raw, "POST", "/notes", { title: "x", markdown: "y", place: workspaceId })).status).toBe(403);
    expect((await call(t, raw, "POST", `/notes/${team}/append`, { markdown: "more" })).status).toBe(404);
    expect((await call(t, raw, "GET", `/tasks?place=${workspaceId}`)).status).toBe(403);
    // With the workspace: both places, and the note opens.
    const both = await token(a, { personal: true, workspaceIds: [workspaceId], name: "Both" });
    expect((await call(t, both, "GET", "/places")).json.data).toEqual([
      { id: "personal", name: "Personal" },
      { id: workspaceId, name: "Studio" },
    ]);
    expect((await call(t, both, "GET", `/notes/${team}`)).json).toMatchObject({ id: team, title: "Studio plan", place: { id: workspaceId, name: "Studio" } });
  });

  test("a member's token can't read a page restricted away from them", async () => {
    const t = setup();
    const owner = await person(t, "rest-owner@example.com");
    const member = await person(t, "rest-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Board");
    await join(t, owner, member, "rest-member@example.com", workspaceId, "editor");
    const secret = await note(owner, "Board only", ["Salaries"], scope);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const raw = await token(member, { personal: false, workspaceIds: [workspaceId] });
    expect((await call(t, raw, "GET", `/notes/${secret}`)).status).toBe(404);
    expect((await call(t, raw, "GET", "/notes?q=Salaries")).json.data).toEqual([]);
    expect((await call(t, raw, "GET", "/notes")).json.data.map((n: { id: string }) => n.id)).not.toContain(secret);
  });

  test("notes: recent in pages, search, and one note with its folder path and tags", async () => {
    const t = setup();
    const a = await person(t, "rest-notes@example.com");
    const work = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Work" })).id;
    const clients = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Clients", parentFolderId: work })).id;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await note(a, `Note ${i}`, [`Body ${i}`]));
      await new Promise((r) => setTimeout(r, 3));
    }
    const filed = await note(a, "Acme brief", ["Kick-off on Monday."], PERSONAL, clients);
    const raw = await token(a, { scopes: ["notes:read"] });

    const first = await call(t, raw, "GET", "/notes?limit=3");
    expect(first.status).toBe(200);
    expect(first.json.data).toHaveLength(3);
    expect(first.json.data[0]).toMatchObject({ id: filed, title: "Acme brief", place: { id: "personal", name: "Personal" }, url: expect.stringMatching(new RegExp(`/d/${filed}$`)) });
    expect(first.json.nextCursor).toEqual(expect.any(String));
    const seen = new Set(first.json.data.map((n: { id: string }) => n.id));
    let cursor = first.json.nextCursor as string | null;
    while (cursor) {
      const page = await call(t, raw, "GET", `/notes?limit=3&cursor=${encodeURIComponent(cursor)}`);
      for (const n of page.json.data) {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
      }
      cursor = page.json.nextCursor;
    }
    for (const id of [...ids, filed]) expect(seen.has(id)).toBe(true);
    expect((await call(t, raw, "GET", "/notes?cursor=garbage")).status).toBe(422);
    expect((await call(t, raw, "GET", "/notes?limit=lots")).status).toBe(400);

    const found = await call(t, raw, "GET", "/notes?q=Kick-off");
    expect(found.json.data.map((n: { id: string }) => n.id)).toEqual([filed]);
    expect(found.json.nextCursor).toBeNull();

    const one = await call(t, raw, "GET", `/notes/${filed}`);
    expect(one.json).toMatchObject({ id: filed, title: "Acme brief", folder: { id: clients, name: "Clients", path: "Work / Clients" }, tags: [], markdown: "Kick-off on Monday.\n" });
    expect(one.json.markdown).not.toContain("untrusted");
    expect(Date.parse(one.json.updatedAt)).toBeGreaterThan(0);
    expect((await call(t, raw, "GET", "/notes/01NOPE0000000000000000000")).status).toBe(404);
  });

  test("notes: create (in the Inbox too) and append, versioned with reason api and shown as a connected app", async () => {
    const t = setup();
    const a = await person(t, "rest-write@example.com");
    const raw = await token(a);
    const made = await call(t, raw, "POST", "/notes", { title: "Trip", markdown: "## Packing\n- [ ] Passport" });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ title: "Trip", place: { id: "personal", name: "Personal" }, inInbox: false });
    const id = made.json.id as string;
    const inbox = await call(t, raw, "POST", "/notes", { title: "Clip", markdown: "Saved for later", inInbox: true });
    expect(inbox.json.inInbox).toBe(true);

    const appended = await call(t, raw, "POST", `/notes/${id}/append`, { markdown: "Remember the adapter." });
    expect(appended.status).toBe(200);
    expect(appended.json).toMatchObject({ id, added: 1 });
    const versions = await t.run(async (ctx) => ctx.db.query("documentSnapshots").collect());
    expect(versions.some((v) => v.reason === "api")).toBe(true);
    const blocks = await t.run(async (ctx) => ctx.db.query("blocks").collect());
    expect(blocks.find((b) => JSON.stringify(b.text).includes("adapter"))!.updatedVia).toBe("app");
    expect((await call(t, raw, "GET", `/notes/${id}`)).json.markdown).toContain("Remember the adapter.");

    // Bodies are checked: unknown fields, missing ones, bad JSON, the wrong type.
    expect((await call(t, raw, "POST", "/notes", { title: "x", markdown: "y", colour: "red" })).json.error).toEqual({ code: "validation_failed", message: 'Unknown argument "colour".' });
    expect((await call(t, raw, "POST", "/notes", { title: "x" })).status).toBe(422);
    expect((await call(t, raw, "POST", "/notes", "{not json")).status).toBe(400);
    expect((await call(t, raw, "POST", "/notes", "[]")).status).toBe(400);
    expect((await call(t, raw, "POST", "/notes", { title: "x", markdown: "y" }, { "content-type": "text/plain" })).status).toBe(400);
  });

  test("tasks: add (Inbox, priority, assignee), list by status and due date, complete and change", async () => {
    const t = setup();
    const a = await person(t, "rest-tasks@example.com");
    const raw = await token(a);
    const added = await call(t, raw, "POST", "/tasks", { text: "Book the hotel", dueDate: "2026-11-02", priority: "high", assigneeId: a.profileId });
    expect(added.status).toBe(201);
    expect(added.json.note).toMatchObject({ title: "Inbox" });
    const taskId = added.json.id as string;
    await call(t, raw, "POST", "/tasks", { text: "Someday", priority: "low" });
    await call(t, raw, "POST", "/tasks", { text: "Later", dueDate: "2026-12-24" });
    expect((await call(t, raw, "POST", "/tasks", { text: "x", assigneeId: "someone-else" })).status).toBe(422);
    expect((await call(t, raw, "POST", "/tasks", { text: "x", dueDate: "tomorrow" })).status).toBe(422);

    const open = await call(t, raw, "GET", "/tasks");
    // (Personal starts with a few example to-dos of its own.)
    expect(open.json.data.map((x: { text: string }) => x.text)).toEqual(expect.arrayContaining(["Book the hotel", "Later", "Someday"]));
    const hotel = open.json.data.find((x: { id: string }) => x.id === taskId);
    expect(hotel).toMatchObject({ status: "open", dueDate: "2026-11-02", priority: "high", assigneeId: a.profileId, place: { id: "personal" } });
    const soon = await call(t, raw, "GET", "/tasks?due_before=2026-11-30");
    const soonTexts = soon.json.data.map((x: { text: string }) => x.text);
    expect(soonTexts).toContain("Book the hotel");
    expect(soonTexts).not.toContain("Later");
    expect(soonTexts).not.toContain("Someday");
    expect(soon.json.data.every((x: { dueDate: string | null }) => x.dueDate !== null && x.dueDate <= "2026-11-30")).toBe(true);
    expect((await call(t, raw, "GET", "/tasks?status=sideways")).status).toBe(422);

    const done = await call(t, raw, "PATCH", `/tasks/${taskId}`, { completed: true });
    expect(done.json).toMatchObject({ id: taskId, completed: true, dueDate: "2026-11-02", priority: "high" });
    expect((await call(t, raw, "GET", "/tasks?status=done")).json.data.map((x: { id: string }) => x.id)).toContain(taskId);
    expect((await call(t, raw, "GET", "/tasks")).json.data.map((x: { id: string }) => x.id)).not.toContain(taskId);
    const changed = await call(t, raw, "PATCH", `/tasks/${taskId}`, { completed: false, dueDate: "2026-11-05", dueTime: "09:30", priority: "none" });
    expect(changed.json).toMatchObject({ completed: false, dueDate: "2026-11-05", dueTime: "09:30", priority: "none" });
    expect((await call(t, raw, "PATCH", `/tasks/${taskId}`, {})).status).toBe(422);
    expect((await call(t, raw, "PATCH", "/tasks/01NOPE0000000000000000000", { completed: true })).status).toBe(404);
  });

  test("a task can be assigned to a workspace member, not to someone outside it", async () => {
    const t = setup();
    const owner = await person(t, "rest-assign@example.com");
    const member = await person(t, "rest-assignee@example.com");
    const outsider = await person(t, "rest-outsider@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Ops");
    await join(t, owner, member, "rest-assignee@example.com", workspaceId, "editor");
    const raw = await token(owner, { personal: false, workspaceIds: [workspaceId] });
    expect((await call(t, raw, "POST", "/tasks", { text: "Ship it", place: workspaceId, assigneeId: member.profileId })).status).toBe(201);
    expect((await call(t, raw, "POST", "/tasks", { text: "Ship it", place: workspaceId, assigneeId: outsider.profileId })).status).toBe(422);
  });

  test("Idempotency-Key: a retry gets the first answer, a reused key with another body is refused", async () => {
    const t = setup();
    const a = await person(t, "rest-idem@example.com");
    const raw = await token(a);
    const key = { "idempotency-key": "c2c4a4a6-retry-1" };
    const first = await call(t, raw, "POST", "/notes", { title: "Once", markdown: "x" }, key);
    const second = await call(t, raw, "POST", "/notes", { title: "Once", markdown: "x" }, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json.id).toBe(first.json.id);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    const onces = await t.run(async (ctx) => (await ctx.db.query("documents").collect()).filter((d) => d.title === "Once"));
    expect(onces).toHaveLength(1);
    const reused = await call(t, raw, "POST", "/notes", { title: "Other", markdown: "y" }, key);
    expect(reused.status).toBe(422);
    expect(reused.json.error.code).toBe("idempotency_key_reused");
    // Another token's same key is its own.
    const other = await token(a, { name: "Other" });
    expect((await call(t, other, "POST", "/notes", { title: "Once", markdown: "x" }, key)).json.id).not.toBe(first.json.id);
    expect((await call(t, raw, "POST", "/notes", { title: "x", markdown: "y" }, { "idempotency-key": "has spaces in it" })).status).toBe(400);
    // Answers are kept a day, then swept.
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("apiRequests").collect()) await ctx.db.patch(r._id, { createdAt: Date.now() - 2 * 86_400_000 });
    });
    await t.mutation(internal.restApi.sweep, {});
    expect(await t.run(async (ctx) => (await ctx.db.query("apiRequests").collect()).length)).toBe(0);
  });

  test("rate limits answer 429 with Retry-After", async () => {
    const t = setup();
    const a = await person(t, "rest-rate@example.com");
    const raw = await token(a);
    await t.run(async (ctx) => {
      await ctx.db.insert("systemSettings", { key: "rate_limits", value: { apiWrite: { limit: 2, windowMs: 60_000 }, apiRead: { limit: 3, windowMs: 60_000 } }, updatedAt: Date.now() } as never);
    });
    expect((await call(t, raw, "POST", "/notes", { title: "1", markdown: "x" })).status).toBe(201);
    expect((await call(t, raw, "POST", "/notes", { title: "2", markdown: "x" })).status).toBe(201);
    const limited = await call(t, raw, "POST", "/notes", { title: "3", markdown: "x" });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) expect((await call(t, raw, "GET", "/places")).status).toBe(200);
    expect((await call(t, raw, "GET", "/places")).status).toBe(429);
  });

  test("unknown paths, wrong methods and CORS", async () => {
    const t = setup();
    const a = await person(t, "rest-misc@example.com");
    const raw = await token(a);
    expect((await call(t, raw, "GET", "/secrets")).status).toBe(404);
    const wrong = await call(t, raw, "DELETE", "/notes");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, POST, OPTIONS");
    const ok = await call(t, raw, "GET", "/places");
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const pre = await t.fetch("/api/v1/notes", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("idempotency-key");
    expect(pre.headers.get("access-control-allow-methods")).toContain("PATCH");
  });
});

describe("the iPhone and iPad app's device token", () => {
  const DEVICE = "6F1C2B9A-0D7E-4A55-9C3B-1E2F3A4B5C6D";

  test("made for the signed-in person, labelled for the device, with every place and never expiring", async () => {
    const t = setup();
    const a = await person(t, "device-a@example.com");
    const { workspaceId } = await teamWorkspace(a, "Studio");
    const made = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPhone", model: "iPhone 18 Pro" });
    expect(made.token).toMatch(/^fvpat_[A-Za-z0-9_-]{43}$/);
    const [listed] = await a.as.query(api.apiTokens.list, {});
    expect(listed).toMatchObject({ id: made.tokenId, name: "Folevi for iPhone (iPhone 18 Pro)", deviceId: DEVICE, places: ["Personal", "Studio"], expiresAt: null });
    expect(listed!.scopes).toEqual(["notes:read", "notes:write", "tasks:read", "tasks:write"]);
    expect((await call(t, made.token!, "GET", "/places")).json.data).toEqual([
      { id: "personal", name: "Personal" },
      { id: workspaceId, name: "Studio" },
    ]);
    // Places follow the person: a workspace made later is in reach at once, with no new token.
    const later = await teamWorkspace(a, "Later");
    expect((await call(t, made.token!, "GET", "/places")).json.data.map((p: { id: string }) => p.id)).toEqual(["personal", workspaceId, later.workspaceId]);
    const created = await call(t, made.token!, "POST", "/notes", { title: "From the share sheet", markdown: "A link", inInbox: true, place: later.workspaceId });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ inInbox: true, place: { id: later.workspaceId, name: "Later" } });
    // Device tokens don't count towards the 20 personal access tokens.
    for (let i = 0; i < 20; i++) await token(a, { name: `T${i}` });
    await expect(a.as.mutation(api.apiTokens.ensureDevice, { deviceId: "ANOTHER-DEVICE-1", family: "iPad", model: "iPad Pro 13-inch (M5)" })).resolves.toMatchObject({ token: expect.any(String) });
    // Without a session nothing is made.
    await expect(t.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPhone", model: "x" })).rejects.toThrow();
    await expect(a.as.mutation(api.apiTokens.ensureDevice, { deviceId: "../nope", family: "iPhone", model: "x" })).rejects.toThrow(/device id/);
  });

  test("kept while the app holds it, replaced when it doesn't, revoked on sign-out or in Settings", async () => {
    const t = setup();
    const a = await person(t, "device-keep@example.com");
    const first = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPad", model: "iPad Pro 13-inch (M5)" });
    expect((await a.as.query(api.apiTokens.list, {}))[0]!.name).toBe("Folevi for iPad (iPad Pro 13-inch (M5))");
    // The next launch: the app says which token it holds, and nothing new is made.
    const again = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPad", model: "iPad Pro 13-inch (M5)", tokenId: first.tokenId });
    expect(again).toEqual({ tokenId: first.tokenId, token: null });
    // The app lost its copy (or holds someone else's): a new token replaces the old one.
    const fresh = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPad", model: "iPad Pro 13-inch (M5)" });
    expect(fresh.tokenId).not.toBe(first.tokenId);
    expect((await call(t, first.token!, "GET", "/places")).status).toBe(401);
    expect(await a.as.query(api.apiTokens.list, {})).toHaveLength(1);
    // Someone else's token id doesn't count as held.
    const b = await person(t, "device-other@example.com");
    const theirs = await b.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPhone", model: "iPhone 18 Pro", tokenId: fresh.tokenId });
    expect(theirs.token).toEqual(expect.any(String));
    expect((await call(t, fresh.token!, "GET", "/places")).status).toBe(200);
    // Signing out of the app revokes the device's token, only the person's own.
    await b.as.mutation(api.apiTokens.revokeDevice, { deviceId: DEVICE });
    expect((await call(t, theirs.token!, "GET", "/places")).status).toBe(401);
    expect((await call(t, fresh.token!, "GET", "/places")).status).toBe(200);
    // Revoked in Settings > Connected apps like any token; the next launch makes a new one.
    await a.as.mutation(api.apiTokens.revoke, { tokenId: fresh.tokenId });
    expect((await call(t, fresh.token!, "GET", "/places")).status).toBe(401);
    const back = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPad", model: "iPad Pro 13-inch (M5)", tokenId: fresh.tokenId });
    expect(back.token).toEqual(expect.any(String));
  });

  test("a person who leaves a workspace loses it from the device token; ten devices at most", async () => {
    const t = setup();
    const owner = await person(t, "device-owner@example.com");
    const member = await person(t, "device-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Board");
    await join(t, owner, member, "device-member@example.com", workspaceId, "editor");
    const made = await member.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPhone", model: "" });
    expect((await member.as.query(api.apiTokens.list, {}))[0]!.name).toBe("Folevi for iPhone");
    expect((await call(t, made.token!, "GET", "/places")).json.data.map((p: { id: string }) => p.id)).toEqual(["personal", workspaceId]);
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect((await call(t, made.token!, "GET", "/places")).json.data.map((p: { id: string }) => p.id)).toEqual(["personal"]);
    expect((await call(t, made.token!, "GET", `/notes?place=${workspaceId}`)).status).toBe(403);

    for (let i = 0; i < 10; i++) await member.as.mutation(api.apiTokens.ensureDevice, { deviceId: `DEVICE-NUMBER-${i}`, family: "iPhone", model: "iPhone 17" });
    const devices = (await member.as.query(api.apiTokens.list, {})).filter((x) => x.deviceId);
    expect(devices).toHaveLength(10);
    // The one used longest ago (the first) made room.
    expect(devices.map((d) => d.deviceId)).not.toContain(DEVICE);
  });

  test("starred notes, most recently starred first", async () => {
    const t = setup();
    const a = await person(t, "device-stars@example.com");
    const one = await note(a, "One", ["1"]);
    const two = await note(a, "Two", ["2"]);
    await note(a, "Three", ["3"]);
    await a.as.mutation(api.documents.setStarred, { documentId: two, starred: true });
    await new Promise((r) => setTimeout(r, 3));
    await a.as.mutation(api.documents.setStarred, { documentId: one, starred: true });
    const { token: raw } = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: DEVICE, family: "iPhone", model: "iPhone 18 Pro" });
    const starred = await call(t, raw!, "GET", "/notes?starred=true");
    expect(starred.status).toBe(200);
    expect(starred.json).toEqual({ data: [expect.objectContaining({ id: one, title: "One" }), expect.objectContaining({ id: two, title: "Two" })], nextCursor: null });
  });
});
