// The clipper's MCP calls: hello once, then tools/call with fresh ids; create_note always asks for the
// Inbox; tool errors and refusals become readable messages.
import { expect, test } from "vitest";
import { FoleviMcp, McpError } from "../src/lib/mcp";
import { Session } from "../src/lib/session";
import { json, memoryStore, scriptedFetch, type Sent } from "./fakes";

const ORIGIN = "https://app.folevi.com";

function client(fetch: typeof globalThis.fetch) {
  const session = new Session({
    origin: ORIGIN,
    local: memoryStore({ client: { clientId: "c1", redirectUri: "https://x.chromiumapp.org/" }, refreshToken: "fvrt" }),
    memory: memoryStore({ accessToken: { token: "fvat_t", expiresAt: Date.now() + 3_600_000 } }),
    fetch,
  });
  let n = 0;
  return new FoleviMcp(session, ORIGIN, () => `id-${++n}`);
}

const rpc = (req: Sent) => JSON.parse(req.body) as { id: string; method: string; params: Record<string, unknown> };
const result = (structuredContent: Record<string, unknown>) => json(200, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }], structuredContent } });

test("initialize once, then create_note into the Inbox with the place", async () => {
  const fetch = scriptedFetch(
    (req) => {
      expect(rpc(req)).toMatchObject({ method: "initialize", params: { protocolVersion: "2025-06-18" } });
      expect(req.headers.get("mcp-protocol-version")).toBeNull();
      return json(200, { jsonrpc: "2.0", id: "id-1", result: { protocolVersion: "2025-06-18" } });
    },
    (req) => {
      expect(req.url).toBe(`${ORIGIN}/mcp`);
      expect(req.headers.get("authorization")).toBe("Bearer fvat_t");
      expect(req.headers.get("mcp-protocol-version")).toBe("2025-06-18");
      expect(rpc(req)).toEqual({ jsonrpc: "2.0", id: "id-2", method: "tools/call", params: { name: "create_note", arguments: { title: "Read", markdown: "Body", inInbox: true, place: "ws1" } } });
      return result({ noteId: "n1", title: "Read", place: "Studio", inInbox: true, url: `${ORIGIN}/d/n1` });
    },
    (req) => {
      expect(rpc(req)).toMatchObject({ id: "id-3", method: "tools/call", params: { name: "list_places" } });
      return result({ places: [{ id: "personal", name: "Personal" }, { id: "ws1", name: "Studio" }], includesSharedPages: false });
    },
  );
  const mcp = client(fetch);
  expect(await mcp.createNote({ title: "Read", markdown: "Body", place: "ws1" })).toEqual({ noteId: "n1", title: "Read", place: "Studio", url: `${ORIGIN}/d/n1` });
  expect(await mcp.listPlaces()).toEqual([{ id: "personal", name: "Personal" }, { id: "ws1", name: "Studio" }]);
});

test("a tool error or a refusal becomes a message", async () => {
  const fetch = scriptedFetch(
    () => json(200, { result: {} }),
    () => json(200, { jsonrpc: "2.0", id: 2, result: { isError: true, content: [{ type: "text", text: "Too many requests from this app. Wait a minute and try again." }] } }),
    () => json(403, { jsonrpc: "2.0", id: 3, error: { code: -32600, message: "This connection isn't allowed to use create_note. Connect again and allow it." } }),
  );
  const mcp = client(fetch);
  await expect(mcp.createNote({ title: "x", markdown: "y" })).rejects.toThrow(new McpError("Too many requests from this app. Wait a minute and try again."));
  await expect(mcp.createNote({ title: "x", markdown: "y" })).rejects.toThrow(/isn't allowed to use create_note/);
});
