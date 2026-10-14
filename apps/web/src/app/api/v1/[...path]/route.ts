import { convexSiteUrl } from "@/lib/server/mcp";

/**
 * Folevi's REST API v1 (https://app.folevi.com/api/v1), forwarded as is to the Convex HTTP action that
 * serves it (convex/restApiServer.ts). Only the headers the API uses travel (the token in Authorization,
 * the body type, an Idempotency-Key); cookies and the request IP are never passed on.
 */
export const dynamic = "force-dynamic";

const FORWARD = ["authorization", "content-type", "accept", "idempotency-key"];
const RETURN = ["content-type", "cache-control", "retry-after", "allow", "www-authenticate", "idempotent-replayed", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers", "access-control-max-age"];

async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const init: RequestInit = { method: request.method, headers, cache: "no-store", redirect: "manual" };
  if (request.method === "POST" || request.method === "PATCH" || request.method === "PUT") init.body = await request.arrayBuffer();
  const res = await fetch(`${convexSiteUrl()}${url.pathname}${url.search}`, init);
  const out = new Headers();
  for (const name of RETURN) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
export const OPTIONS = forward;
