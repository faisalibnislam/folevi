// Folevi's REST API v1 (/api/v1, convex/restApiServer.ts): its routes, what each needs (scope) and takes
// (a schema in the same subset connected-app tools use, checked by lib/mcp/tools.ts checkArgs), and how
// errors look: always { "error": { "code", "message" } } with a matching HTTP status.
import { ConvexError } from "convex/values";
import { TOOL_BY_NAME, type ToolDef } from "./mcp/tools";
import type { McpScope } from "./mcp/config";

export type RouteName = "places" | "notes.list" | "notes.get" | "notes.create" | "notes.append" | "tasks.list" | "tasks.create" | "tasks.update";

export interface Matched {
  name: RouteName;
  /** The id in the path (a note or a task). */
  id?: string;
}

const ID = /^[0-9A-Za-z_-]{1,64}$/;

/**
 * The route for a method and path (after /api/v1). `allowed` lists the methods a known path takes, for a
 * 405 with Allow when the method is wrong; null when the path isn't one at all.
 */
export function matchRoute(method: string, path: string): { route: Matched } | { allowed: string[] } | null {
  const parts = path.split("/").filter(Boolean);
  const m = method.toUpperCase();
  const pick = (table: Record<string, RouteName>, id?: string) => (table[m] ? { route: { name: table[m]!, ...(id ? { id } : {}) } } : { allowed: Object.keys(table) });
  if (parts.length === 1 && parts[0] === "places") return pick({ GET: "places" });
  if (parts.length === 1 && parts[0] === "notes") return pick({ GET: "notes.list", POST: "notes.create" });
  if (parts.length === 2 && parts[0] === "notes" && ID.test(parts[1]!)) return pick({ GET: "notes.get" }, parts[1]);
  if (parts.length === 3 && parts[0] === "notes" && parts[2] === "append" && ID.test(parts[1]!)) return pick({ POST: "notes.append" }, parts[1]);
  if (parts.length === 1 && parts[0] === "tasks") return pick({ GET: "tasks.list", POST: "tasks.create" });
  if (parts.length === 2 && parts[0] === "tasks" && ID.test(parts[1]!)) return pick({ PATCH: "tasks.update" }, parts[1]);
  return null;
}

/** The scope each route needs (listing places works with any). */
export const ROUTE_SCOPE: Record<RouteName, McpScope | null> = {
  places: null,
  "notes.list": "notes:read",
  "notes.get": "notes:read",
  "notes.create": "notes:write",
  "notes.append": "notes:write",
  "tasks.list": "tasks:read",
  "tasks.create": "tasks:write",
  "tasks.update": "tasks:write",
};

export const isWrite = (name: RouteName) => name === "notes.create" || name === "notes.append" || name === "tasks.create" || name === "tasks.update";

type Schema = Record<string, unknown>;
const props = (tool: string) => (TOOL_BY_NAME.get(tool)!.inputSchema as { properties: Record<string, Schema> }).properties;
const body = (name: string, properties: Record<string, Schema>, required: string[], scope: McpScope): ToolDef => ({
  name,
  title: name,
  description: name,
  scope,
  kind: "write",
  inputSchema: { type: "object", properties, required, additionalProperties: false },
});

const PRIORITY = { type: "string", enum: ["none", "low", "medium", "high"] };

/** Request bodies, checked before anything runs (a problem is a 422 naming the field). */
export const BODIES: Partial<Record<RouteName, ToolDef>> = {
  "notes.create": body("notes.create", props("create_note"), ["title", "markdown"], "notes:write"),
  "notes.append": body("notes.append", { markdown: props("append_to_note").markdown! }, ["markdown"], "notes:write"),
  "tasks.create": body("tasks.create", { ...props("add_task"), priority: PRIORITY, assigneeId: { type: "string", description: "A member of the workspace (or you).", maxLength: 64 } }, ["text"], "tasks:write"),
  "tasks.update": body(
    "tasks.update",
    {
      completed: { type: "boolean" },
      dueDate: props("update_task").dueDate!,
      dueTime: props("update_task").dueTime!,
      priority: PRIORITY,
      repeat: props("update_task").repeat!,
    },
    [],
    "tasks:write",
  ),
};

/** An Idempotency-Key a client may send: 1 to 255 visible ASCII characters. */
export function idempotencyKeyProblem(key: string): string | null {
  return /^[\x21-\x7e]{1,255}$/.test(key) ? null : "Idempotency-Key must be 1 to 255 visible ASCII characters.";
}

/** How a failure inside Folevi answers: the HTTP status and error code for the client. */
export function errorFor(e: unknown): { status: number; code: string; message: string; retryAfterMs?: number } {
  if (e instanceof ConvexError) {
    const data = (typeof e.data === "object" && e.data ? e.data : { message: String(e.data) }) as { code?: string; message?: string; retryAfterMs?: number };
    const message = typeof data.message === "string" ? data.message : "That couldn't be done.";
    switch (data.code) {
      case "unauthenticated":
      case "suspended":
      case "account_deleted":
        return { status: 401, code: "unauthorized", message };
      case "forbidden":
        return { status: 403, code: "forbidden", message };
      case "not_found":
        return { status: 404, code: "not_found", message };
      case "conflict":
        return { status: 409, code: "conflict", message };
      case "invalid_argument":
      case "invalid_block":
      case "limit_exceeded":
      case "quota_exceeded":
        return { status: 422, code: "validation_failed", message };
      case "rate_limited":
        return { status: 429, code: "rate_limited", message: "Too many requests for this token. Wait a moment and try again.", retryAfterMs: typeof data.retryAfterMs === "number" ? data.retryAfterMs : 60_000 };
      case "maintenance":
        return { status: 503, code: "unavailable", message };
    }
  }
  return { status: 500, code: "internal_error", message: "Something went wrong in Folevi. Try again in a moment." };
}
