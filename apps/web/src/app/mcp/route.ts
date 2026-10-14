import { convexSiteUrl } from "@/lib/server/mcp";

/**
 * Folevi's MCP server for connected apps (Claude, ChatGPT, Cursor, …): https://app.folevi.com/mcp,
 * forwarded as is to the Convex HTTP action that serves it (convex/mcpServer.ts). Only the headers MCP
 * uses travel; the request IP is never passed on.
 */
export const dynamic = "force-dynamic";

const FORWARD = ["authorization", "content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name", "origin", "last-event-id"];

async function forward(request: Request): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const [name, value] of request.headers) if (name.toLowerCase().startsWith("mcp-param-")) headers.set(name, value);
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (request.method === "POST") init.body = await request.arrayBuffer();
  const res = await fetch(`${convexSiteUrl()}/mcp`, init);
  const out = new Headers();
  for (const name of ["content-type", "www-authenticate", "mcp-protocol-version", "allow", "cache-control", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers", "access-control-max-age", "vary"]) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export const POST = forward;
export const GET = forward;
export const DELETE = forward;
export const OPTIONS = forward;
