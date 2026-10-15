// Folevi's REST API v1 over HTTP: /api/v1/* on this deployment, served to scripts as
// https://app.folevi.com/api/v1 (apps/web/src/app/api/v1/[...path]/route.ts forwards it here).
//
// Every request needs `Authorization: Bearer fvpat_…`, a personal access token from Settings → Connected
// apps. Answers are JSON; errors are always { "error": { "code", "message" } } with a matching status:
// 400 a malformed request, 401 no or a dead token, 403 a scope or place the token doesn't have, 404, 405,
// 409 a note changed meanwhile, 413, 422 a field that isn't valid, 429 with Retry-After. Any origin may
// call it from a browser: the token is the only credential (no cookies), so CORS allows any origin
// without credentials. The work itself happens in convex/restApi.ts.
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { TokenAuth } from "./apiTokens";
import { TOKEN_PREFIX } from "./apiTokens";
import { sha256Base64url } from "./lib/crypto";
import { checkArgs } from "./lib/mcp/tools";
import { BODIES, errorFor, idempotencyKeyProblem, isWrite, matchRoute, ROUTE_SCOPE } from "./lib/restApi";

const MAX_BODY_BYTES = 256 * 1024;
const PREFIX = "/api/v1";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "retry-after, idempotent-replayed",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra } });
}

export function apiError(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json(status, { error: { code, message } }, extra);
}

/** JSON with sorted keys, so the same request always hashes the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

function failure(e: unknown, log: (fields: Record<string, unknown>) => void): Response {
  const err = errorFor(e);
  log({ status: err.status, code: err.code });
  if (err.status === 500 && !(e instanceof ConvexError)) console.error(JSON.stringify({ event: "api.error", name: e instanceof Error ? e.name : "unknown" }));
  return apiError(err.status, err.code, err.message, err.retryAfterMs !== undefined ? { "retry-after": String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))) } : {});
}

export const restApiHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS, "access-control-allow-methods": "GET, POST, PATCH, OPTIONS", "access-control-allow-headers": "authorization, content-type, idempotency-key", "access-control-max-age": "600" },
    });
  }
  const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
  const matched = matchRoute(method, path);
  if (!matched) return apiError(404, "not_found", "There's no such endpoint. See https://app.folevi.com/api/v1/openapi.json.");
  if ("allowed" in matched) return apiError(405, "method_not_allowed", `Use ${matched.allowed.join(" or ")} here.`, { allow: [...matched.allowed, "OPTIONS"].join(", ") });
  const route = matched.route;
  const log = (fields: Record<string, unknown>) => console.log(JSON.stringify({ event: "api.request", route: route.name, ...fields }));

  // The token: by its hash, never logged.
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
  const challenge = { "www-authenticate": 'Bearer realm="Folevi"' };
  if (!bearer) return apiError(401, "unauthorized", "Send a personal access token: Authorization: Bearer fvpat_…", challenge);
  const auth: TokenAuth = bearer.startsWith(TOKEN_PREFIX) && bearer.length < 200 ? await ctx.runQuery(internal.apiTokens.authorize, { tokenHash: await sha256Base64url(bearer) }) : { ok: false, reason: "invalid_token" };
  if (!auth.ok) {
    log({ status: 401, code: auth.reason });
    const message = auth.reason === "expired" ? "This token has expired. Make a new one in Settings." : auth.reason === "account" ? "This Folevi account can't be used right now." : "This token isn't valid. It may have been revoked.";
    return apiError(401, "unauthorized", message, { "www-authenticate": `Bearer realm="Folevi", error="invalid_token"` });
  }
  const needed = ROUTE_SCOPE[route.name];
  if (needed && !auth.scopes.includes(needed)) {
    log({ status: 403, code: "insufficient_scope" });
    return apiError(403, "insufficient_scope", `This token can't do that: it needs the ${needed} scope.`, { "www-authenticate": `Bearer realm="Folevi", error="insufficient_scope", scope="${needed}"` });
  }

  if (!isWrite(route.name)) {
    const query: Record<string, string> = {};
    for (const key of ["place", "q", "limit", "cursor", "status", "due_before", "starred"]) {
      const value = url.searchParams.get(key);
      if (value !== null) query[key] = value.slice(0, 500);
    }
    if (query.limit !== undefined && !/^\d{1,3}$/.test(query.limit)) return apiError(400, "bad_request", "limit must be a whole number.");
    try {
      await ctx.runMutation(internal.restApi.limit, { tokenId: auth.tokenId, kind: route.name === "notes.list" && query.q ? "search" : "read" });
      const body = await ctx.runQuery(internal.restApi.read, { tokenId: auth.tokenId, route: route.name, id: route.id, query });
      log({ status: 200 });
      return json(200, body);
    } catch (e) {
      return failure(e, log);
    }
  }

  // Writes: a JSON object body, checked against the route's schema before anything runs.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return apiError(400, "bad_request", "Send the body as JSON (Content-Type: application/json).");
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return apiError(413, "payload_too_large", "The body is too large (at most 256 KB).");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return apiError(413, "payload_too_large", "The body is too large (at most 256 KB).");
  let body: unknown;
  try {
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return apiError(400, "bad_request", "The body isn't valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return apiError(400, "bad_request", "The body must be a JSON object.");
  const problem = checkArgs(BODIES[route.name]!, body);
  if (problem) return apiError(422, "validation_failed", problem);
  if (route.name === "tasks.update" && !Object.keys(body).length) return apiError(422, "validation_failed", "Say what to change: completed, dueDate, dueTime, priority or repeat.");
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  if (idempotencyKey !== undefined) {
    const bad = idempotencyKeyProblem(idempotencyKey);
    if (bad) return apiError(400, "bad_request", bad);
  }
  try {
    const requestHash = await sha256Base64url(`${method} ${path}\n${canonical(body)}`);
    const answer = await ctx.runMutation(internal.restApi.write, { tokenId: auth.tokenId, route: route.name, id: route.id, body, idempotencyKey, requestHash });
    log({ status: answer.status, replayed: answer.replayed === true });
    return json(answer.status, answer.body, answer.replayed ? { "idempotent-replayed": "true" } : {});
  } catch (e) {
    return failure(e, log);
  }
});
