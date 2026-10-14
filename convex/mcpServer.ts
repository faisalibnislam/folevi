// Folevi's MCP server over Streamable HTTP: POST /mcp on this deployment, served to apps as
// https://app.folevi.com/mcp (apps/web/src/app/mcp/route.ts forwards it here). Dual-era and stateless
// (lib/mcp/protocol.ts): modern clients send their version with every request, legacy ones start with
// `initialize`; no sessions are kept, GET and DELETE are refused.
//
// Every request needs `Authorization: Bearer <access token>` from Folevi's OAuth server. Without one (or
// with one that's expired or revoked) the answer is 401 with a WWW-Authenticate header pointing at the
// protected resource metadata, which is how clients find out where to sign in. A tool needing a scope
// the connection wasn't given answers 403 insufficient_scope. The work itself happens in convex/mcp.ts.
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACCESS_TOKEN_PREFIX, MCP_SCOPES, mcpResourceUrl } from "./lib/mcp/config";
import {
  cacheable,
  CAPABILITIES,
  ERR,
  INSTRUCTIONS,
  parseMessage,
  rpcError,
  rpcResult,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  type Era,
  type RpcId,
} from "./lib/mcp/protocol";
import { checkArgs, describeTool, PROMPTS, TOOL_BY_NAME, toolAllowed, TOOLS, weeklyReviewMessages } from "./lib/mcp/tools";
import type { Authorized } from "./mcp";
import { sha256Base64url } from "./lib/crypto";

const MAX_BODY_BYTES = 1024 * 1024;
const NOTE_URI = /^folevi:\/\/note\/([0-9A-Za-z]{10,64})$/;

const ALLOW_HEADERS = "authorization, content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id";

/** The protected resource metadata URL (RFC 9728), served by the web app next to the endpoint. */
export function resourceMetadataUrl(): string {
  const url = new URL(mcpResourceUrl());
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

/**
 * An Origin the server accepts (DNS-rebinding protection). Folevi is remote and bearer-only (no cookies),
 * so browser-based clients on https sites may call it, and so may browser extensions (Folevi Web Clipper
 * sends its chrome-extension:// origin); anything else sending an Origin is refused.
 */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "chrome-extension:") return /^[a-p]{32}$/.test(u.hostname);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function json(status: number, body: Record<string, unknown> | null, origin: string | null, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      "cache-control": "no-store",
      ...cors(origin),
      ...extra,
    },
  });
}

function cors(origin: string | null): Record<string, string> {
  if (!origin || !originAllowed(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "origin", "access-control-expose-headers": "www-authenticate, mcp-protocol-version" };
}

/** base64url SHA-256 without padding: how the OAuth provider stores tokens. */
const hashToken = sha256Base64url;

function challenge(error?: "invalid_token" | "insufficient_scope", scope?: string): string {
  const parts = [`resource_metadata="${resourceMetadataUrl()}"`];
  if (error) parts.push(`error="${error}"`);
  parts.push(`scope="${scope ?? MCP_SCOPES.join(" ")}"`);
  return `Bearer ${parts.join(", ")}`;
}

/** A tool's answer: the result as JSON text (for every client) and as structured content. */
function toolResult(result: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
}

const toolError = (message: string) => ({ content: [{ type: "text", text: message }], isError: true });

function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as { message?: unknown } | string;
    if (typeof data === "string") return data;
    if (typeof data?.message === "string") return data.message;
  }
  return "Something went wrong in Folevi. Try again in a moment.";
}

function errorCode(e: unknown): string | null {
  return e instanceof ConvexError && typeof (e.data as { code?: unknown })?.code === "string" ? ((e.data as { code: string }).code) : null;
}

export const mcpHttp = httpAction(async (ctx, request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...cors(origin), "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": ALLOW_HEADERS, "access-control-max-age": "600" },
    });
  }
  if (!originAllowed(origin)) return json(403, rpcError(null, ERR.invalidRequest, "Requests from this origin aren't allowed."), origin);
  if (request.method !== "POST") return json(405, null, origin, { allow: "POST, OPTIONS" });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, rpcError(null, ERR.invalidRequest, "Request too large."), origin);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, rpcError(null, ERR.invalidRequest, "Request too large."), origin);

  const parsed = parseMessage(raw, (name) => request.headers.get(name));
  if (!parsed.ok) return json(parsed.status, parsed.body, origin);
  const { request: rpc, era, version } = parsed;

  // Sign-in: every request, so a client without a token learns where to get one.
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
  if (!bearer) return json(401, rpcError(rpc.id ?? null, ERR.invalidRequest, "Sign in to Folevi to connect this app."), origin, { "www-authenticate": challenge() });
  const auth: Authorized = bearer.startsWith(ACCESS_TOKEN_PREFIX)
    ? await ctx.runQuery(internal.mcp.authorize, { tokenHash: await hashToken(bearer.slice(ACCESS_TOKEN_PREFIX.length)) })
    : { ok: false, reason: "invalid_token" };
  if (!auth.ok) {
    const message = auth.reason === "account" ? "This Folevi account can't be used right now." : "This connection to Folevi has expired or was removed. Connect again.";
    return json(401, rpcError(rpc.id ?? null, ERR.invalidRequest, message), origin, { "www-authenticate": challenge("invalid_token") });
  }

  // Notifications (notifications/initialized and the like) need no answer.
  if (rpc.id === undefined) return json(202, null, origin);
  const id = rpc.id;
  const ok = (result: Record<string, unknown>) => json(200, rpcResult(id, result, era), origin, era === "legacy" ? { "mcp-protocol-version": version } : {});
  const err = (code: number, message: string, status = 200, data?: unknown) => json(status, rpcError(id, code, message, data), origin);
  const log = (fields: Record<string, unknown>) => console.log(JSON.stringify({ event: "mcp.request", era, method: rpc.method, ...fields }));

  switch (rpc.method) {
    case "initialize":
      if (era === "modern") return err(ERR.methodNotFound, "initialize is for older protocol versions; this request already says its version.", 404);
      log({});
      return ok({ protocolVersion: version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });

    case "server/discover":
      return ok({ supportedVersions: SUPPORTED_VERSIONS, capabilities: CAPABILITIES, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO }, instructions: INSTRUCTIONS, ...cacheable(era, 60 * 60 * 1000) });

    case "ping":
      return ok({});

    case "tools/list":
      return ok({ tools: TOOLS.filter((t) => toolAllowed(t, auth.scopes)).map(describeTool), ...cacheable(era, 5 * 60 * 1000) });

    case "tools/call":
      return await callTool(ctx, { id, era, auth, params: rpc.params, ok, err, log, origin });

    case "resources/list":
      return ok({ resources: [], ...cacheable(era, 5 * 60 * 1000) });

    case "resources/templates/list":
      return ok({
        resourceTemplates: [{ uriTemplate: "folevi://note/{noteId}", name: "note", title: "Folevi note", description: "A note as Markdown.", mimeType: "text/markdown" }],
        ...cacheable(era, 60 * 60 * 1000),
      });

    case "resources/read": {
      const uri = typeof rpc.params.uri === "string" ? rpc.params.uri : "";
      const noteId = NOTE_URI.exec(uri)?.[1];
      if (!noteId || !auth.scopes.includes("notes:read")) return err(-32002, "Resource not found.", 200, { uri });
      try {
        const note = await ctx.runQuery(internal.mcp.readResource, { grantId: auth.grantId, noteId });
        await ctx.runMutation(internal.mcp.record, { grantId: auth.grantId, tool: "resources/read", outcome: "ok", targets: [noteId] });
        return ok({ contents: [{ uri, mimeType: "text/markdown", text: note.markdown }], ...cacheable(era, 60 * 1000) });
      } catch {
        return err(-32002, "Resource not found.", 200, { uri });
      }
    }

    case "prompts/list":
      return ok({ prompts: PROMPTS, ...cacheable(era, 60 * 60 * 1000) });

    case "prompts/get":
      if (rpc.params.name !== "weekly_review") return err(ERR.invalidParams, "Unknown prompt.");
      return ok({ description: PROMPTS[0]!.description, messages: weeklyReviewMessages() });

    default:
      return err(ERR.methodNotFound, `Method not found: ${rpc.method.slice(0, 80)}`, era === "modern" ? 404 : 200);
  }
});

interface CallInput {
  id: RpcId;
  era: Era;
  auth: Extract<Authorized, { ok: true }>;
  params: Record<string, unknown>;
  ok: (result: Record<string, unknown>) => Response;
  err: (code: number, message: string, status?: number, data?: unknown) => Response;
  log: (fields: Record<string, unknown>) => void;
  origin: string | null;
}

async function callTool(ctx: Parameters<Parameters<typeof httpAction>[0]>[0], input: CallInput): Promise<Response> {
  const { auth, params, ok, err, log, origin, id } = input;
  const name = typeof params.name === "string" ? params.name : "";
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return err(ERR.invalidParams, `Unknown tool: ${name.slice(0, 80)}`);
  const grantId = auth.grantId as Id<"mcpGrants">;
  if (!toolAllowed(tool, auth.scopes)) {
    log({ tool: name, outcome: "insufficient_scope" });
    await ctx.runMutation(internal.mcp.record, { grantId, tool: name, outcome: "denied" });
    return json(403, rpcError(id, ERR.invalidRequest, `This connection isn't allowed to use ${name}. Connect again and allow it.`), origin, { "www-authenticate": challenge("insufficient_scope", tool.scope) });
  }
  const args = params.arguments ?? {};
  const problem = checkArgs(tool, args);
  if (problem) return ok(toolError(problem));
  try {
    await ctx.runMutation(internal.mcp.limit, { grantId, kind: name === "search_notes" ? "search" : "read" });
    let result: Record<string, unknown>;
    if (tool.kind === "read") {
      result = await ctx.runQuery(internal.mcp.read, { grantId, tool: name, args });
    } else {
      const requestKey = await hashToken(`${grantId}|${JSON.stringify(id)}|${name}|${canonical(args)}`);
      result = await ctx.runMutation(internal.mcp.write, { grantId, tool: name, args, requestKey });
    }
    await ctx.runMutation(internal.mcp.record, { grantId, tool: name, outcome: "ok", targets: targetsOf(result) });
    log({ tool: name, outcome: "ok" });
    return ok(toolResult(result));
  } catch (e) {
    const code = errorCode(e);
    log({ tool: name, outcome: "error", code });
    await ctx.runMutation(internal.mcp.record, { grantId, tool: name, outcome: code === "forbidden" ? "denied" : "error" });
    return ok(toolError(code === "rate_limited" ? "Too many requests from this app. Wait a minute and try again." : errorMessage(e)));
  }
}

/** JSON with sorted keys, so the same arguments always hash the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

function targetsOf(result: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["noteId", "taskId", "id"]) if (typeof result[key] === "string") out.push(result[key] as string);
  return out;
}
