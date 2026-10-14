// Folevi Web Clipper (apps/clipper) on the server side: it registers itself with a chromiumapp.org
// redirect, asks only for notes:write (a grant that only adds), calls /mcp from its chrome-extension://
// origin, and files each clip under the person's Inbox page with create_note's inInbox.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, components } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { originAllowed } from "../../convex/mcpServer";
import { checkArgs, TOOL_BY_NAME } from "../../convex/lib/mcp/tools";
import { person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const REDIRECT = `https://${EXTENSION_ID}.chromiumapp.org/`;
const CLIENT_ID = "web-clipper-test";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

async function register(t: T, body: Record<string, unknown>) {
  const res = await t.fetch("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin: `chrome-extension://${EXTENSION_ID}` },
    body: JSON.stringify({ token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], ...body }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The clipper's grant (what the consent screen saves for it) and an access token with its scopes. */
async function connect(t: T, who: Person, grant: { scopes?: string[]; personal?: boolean; workspaceIds?: string[]; createOnly?: boolean; includeShared?: boolean } = {}) {
  const exists = await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "oauthClient", where: [{ field: "clientId", value: CLIENT_ID }] }));
  if (!exists) {
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "oauthClient", data: { clientId: CLIENT_ID, name: "Folevi Web Clipper", redirectUris: [REDIRECT], createdAt: Date.now(), updatedAt: Date.now() } } });
    });
  }
  const scopes = grant.scopes ?? ["notes:write"];
  await who.as.mutation(api.mcp.saveGrant, { clientId: CLIENT_ID, scopes, personal: grant.personal ?? true, workspaceIds: grant.workspaceIds ?? [], includeShared: grant.includeShared ?? false, createOnly: grant.createOnly ?? false });
  const authSubject = await t.run(async (ctx) => (await ctx.db.get(who.profileId as Id<"profiles">))!.authSubject);
  const raw = `tok${ulid()}`;
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "oauthAccessToken", data: { token: createHash("sha256").update(raw).digest("base64url"), clientId: CLIENT_ID, userId: authSubject, scopes: [...scopes, "offline_access"], expiresAt: Date.now() + 3_600_000, createdAt: Date.now() } },
    });
  });
  return `fvat_${raw}`;
}

let rpcId = 0;
async function rpc(t: T, bearer: string, method: string, params: Record<string, unknown> = {}) {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, origin: `chrome-extension://${EXTENSION_ID}`, "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `clip-${++rpcId}`, method, params }),
  });
  const body = (await res.json()) as { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text: string }[]; tools?: { name: string }[] } };
  return { status: res.status, headers: res.headers, result: body.result };
}

const call = async (t: T, bearer: string, name: string, args: Record<string, unknown>) => (await rpc(t, bearer, "tools/call", { name, arguments: args })).result!;

describe("registration", () => {
  test("an extension registers with its https://<id>.chromiumapp.org/ redirect and only notes:write", async () => {
    const t = setup();
    const ok = await register(t, { client_name: "Folevi Web Clipper", redirect_uris: [REDIRECT], scope: "notes:write offline_access" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ redirect_uris: [REDIRECT], scope: "notes:write offline_access", token_endpoint_auth_method: "none", public: true });
    // Plain http is for loopback only, and scopes Folevi doesn't have are refused.
    expect((await register(t, { client_name: "x", redirect_uris: [`http://${EXTENSION_ID}.chromiumapp.org/`], scope: "notes:write" })).status).toBe(400);
    expect((await register(t, { client_name: "x", redirect_uris: [REDIRECT], scope: "notes:delete" })).status).toBe(400);
  });

  test("/mcp accepts an extension's origin (Chrome and Edge ids), not other schemes", () => {
    expect(originAllowed(`chrome-extension://${EXTENSION_ID}`)).toBe(true);
    expect(originAllowed("chrome-extension://not-an-id")).toBe(false);
    expect(originAllowed("file://")).toBe(false);
    expect(originAllowed("http://evil.example")).toBe(false);
  });
});

describe("a write-only grant", () => {
  test("only adds: create-only whatever the consent sent, no shared pages, and labelled that way", async () => {
    const t = setup();
    const a = await person(t, "clipper-grant@example.com");
    await connect(t, a, { createOnly: false, includeShared: true });
    const [grant] = await a.as.query(api.mcp.listGrants, {});
    expect(grant).toMatchObject({ name: "Folevi Web Clipper", createOnly: true, includeShared: false, canRead: false, canWrite: true });
    await expect(a.as.mutation(api.mcp.saveGrant, { clientId: CLIENT_ID, scopes: [], personal: true, workspaceIds: [], includeShared: false, createOnly: false })).rejects.toThrow(/at least one thing/);
  });

  test("lists its places and creates notes, but can't read, search or change tasks", async () => {
    const t = setup();
    const a = await person(t, "clipper-scope@example.com");
    const bearer = await connect(t, a);
    const listed = await rpc(t, bearer, "tools/list");
    expect(listed.headers.get("access-control-allow-origin")).toBe(`chrome-extension://${EXTENSION_ID}`);
    expect(listed.result!.tools!.map((x) => x.name)).toEqual(["list_places", "create_note", "append_to_note"]);
    expect((await call(t, bearer, "list_places", {})).structuredContent).toEqual({ places: [{ id: "personal", name: "Personal" }], includesSharedPages: false });
    const search = await rpc(t, bearer, "tools/call", { name: "search_notes", arguments: { query: "x" } });
    expect(search.status).toBe(403);
  });
});

describe("create_note with inInbox", () => {
  test("files the note under the person's Inbox page, with a card for it there", async () => {
    const t = setup();
    const a = await person(t, "clipper-inbox@example.com");
    const bearer = await connect(t, a);
    const markdown = "Clipped from [A long read](https://example.com/read) on 14 October 2026\n\n---\n\n## Part one\n\nText.";
    const made = await call(t, bearer, "create_note", { title: "A long read", markdown, inInbox: true });
    expect(made.isError).toBeFalsy();
    expect(made.structuredContent).toMatchObject({ title: "A long read", place: "Personal", inInbox: true, url: expect.stringMatching(/\/d\/[0-9A-Za-z]+$/) });
    const noteId = made.structuredContent!.noteId as string;
    const { doc, inbox, card } = await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", noteId)).unique())!;
      const inbox = (await ctx.db.get(doc.parentDocumentId!))!;
      const blocks = await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", inbox._id)).collect();
      return { doc, inbox, card: blocks.find((b) => b.type === "page") };
    });
    expect(inbox.title).toBe("Inbox");
    expect(inbox.publicId.startsWith("inbox-")).toBe(true);
    expect((card?.props as { documentId?: string } | undefined)?.documentId).toBe(noteId);
    expect(doc.searchText).toContain("A long read");

    // Without inInbox nothing changes: a note at the top of the place.
    const plain = await call(t, bearer, "create_note", { title: "Loose", markdown: "x" });
    const loose = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", plain.structuredContent!.noteId as string)).unique())!);
    expect(loose.parentDocumentId).toBeUndefined();
    expect(plain.structuredContent!.inInbox).toBeUndefined();
  });

  test("in a workspace it goes to the person's Inbox there; folderId and inInbox together are refused", async () => {
    const t = setup();
    const a = await person(t, "clipper-ws@example.com");
    const { workspaceId } = await teamWorkspace(a, "Studio");
    const bearer = await connect(t, a, { personal: true, workspaceIds: [workspaceId] });
    expect(((await call(t, bearer, "list_places", {})).structuredContent!.places as unknown[]).length).toBe(2);
    const made = await call(t, bearer, "create_note", { title: "Team read", markdown: "Body", place: workspaceId, inInbox: true });
    expect(made.structuredContent).toMatchObject({ place: "Studio", inInbox: true });
    const both = await call(t, bearer, "create_note", { title: "x", markdown: "y", folderId: "f1", inInbox: true });
    expect(both.isError).toBe(true);
  });

  test("a new note takes up to 100,000 characters of Markdown; additions stay at 20,000", () => {
    const create = TOOL_BY_NAME.get("create_note")!;
    expect(checkArgs(create, { title: "Long", markdown: "a".repeat(90_000), inInbox: true })).toBeNull();
    expect(checkArgs(create, { title: "Long", markdown: "a".repeat(100_001) })).toMatch(/too long/);
    expect(checkArgs(create, { title: "x", markdown: "y", inInbox: "yes" })).toMatch(/true or false/);
    expect(checkArgs(TOOL_BY_NAME.get("append_to_note")!, { noteId: "n", markdown: "a".repeat(20_001) })).toMatch(/too long/);
  });
});
