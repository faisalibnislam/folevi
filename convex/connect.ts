// Folevi Cloud's side of Folevi Connect (docs/self-hosting/CONTRACT.md §7, §9): the servers linked to the
// signed-in person's Folevi account (the apps list them under "Your servers"), and approving a server's link
// code. Calls the Connect service with CONNECT_SERVICE_KEY, passing who is asking in X-Folevi-User. Cloud only:
// on a Folevi Server, or when CONNECT_SERVICE_KEY isn't set, it answers plainly that Connect isn't available.
import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireIdentity, requireProfile } from "./lib/auth";
import { connectUrl, isServerEdition } from "./lib/edition";

const TIMEOUT_MS = 10_000;

/** The Connect service key, on Folevi Cloud only (null otherwise). */
function serviceKey(): string | null {
  if (isServerEdition()) return null;
  const key = (process.env.CONNECT_SERVICE_KEY ?? "").trim();
  return key && key !== "none" ? key : null;
}

export interface LinkedServer {
  serverId: string;
  name: string;
  hostname: string;
  lanHostnames: string[];
  version: string;
  online: boolean;
  role: "owner" | "member";
}

const str = (x: unknown, max = 300) => (typeof x === "string" ? x.slice(0, max) : "");

/** One server from Connect's answer, or null when it doesn't look like one. */
export function linkedServerOf(raw: unknown): LinkedServer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const serverId = str(r.serverId, 40);
  const hostname = str(r.hostname, 253);
  if (!/^[a-z2-7]{10}$/.test(serverId) || !hostname) return null;
  return {
    serverId,
    name: str(r.name, 80) || "Folevi Server",
    hostname,
    lanHostnames: Array.isArray(r.lanHostnames) ? r.lanHostnames.filter((h): h is string => typeof h === "string").slice(0, 20).map((h) => h.slice(0, 253)) : [],
    version: str(r.version, 40),
    online: r.online === true,
    role: r.role === "owner" ? "owner" : "member",
  };
}

/** The signed-in person's profile id: their identity at Connect (X-Folevi-User). */
export const me = internalQuery({
  args: {},
  handler: async (ctx) => (await requireProfile(ctx))._id as string,
});

async function call(path: string, init: RequestInit, key: string, userId: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${connectUrl()}${path}`, { ...init, signal: controller.signal, headers: { authorization: `Bearer ${key}`, "x-folevi-user": userId, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  } catch {
    console.warn(JSON.stringify({ event: "connect.unreachable", path: path.split("/")[2] ?? "" }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The servers linked to the signed-in person's Folevi account (as owner or member). An empty list when Connect
 * isn't available here or can't be reached: the apps then simply show no servers.
 */
export const myServers = action({
  args: {},
  handler: async (ctx): Promise<LinkedServer[]> => {
    await requireIdentity(ctx);
    const key = serviceKey();
    if (!key) return [];
    const userId: string = await ctx.runQuery(internal.connect.me, {});
    const res = await call(`/v1/accounts/${encodeURIComponent(userId)}/servers`, { method: "GET" }, key, userId);
    if (!res || !res.ok) return [];
    const body: unknown = await res.json().catch(() => null);
    const list = Array.isArray(body) ? body : Array.isArray((body as { servers?: unknown } | null)?.servers) ? (body as { servers: unknown[] }).servers : [];
    return list
      .map(linkedServerOf)
      .filter((s): s is LinkedServer => s !== null)
      .slice(0, 50);
  },
});

/**
 * Links the server waiting on `code` (shown on its setup page, 10 minutes) to the signed-in person's account.
 * `{ok: false, error}`: "not_available" (no Connect here), "invalid_code", "expired" or "failed".
 */
export const approveLink = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: "not_available" | "invalid_code" | "expired" | "failed" }> => {
    await requireIdentity(ctx);
    const key = serviceKey();
    if (!key) return { ok: false, error: "not_available" };
    const code = args.code.trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) return { ok: false, error: "invalid_code" };
    const userId: string = await ctx.runQuery(internal.connect.me, {});
    const res = await call(`/v1/link-codes/${encodeURIComponent(code)}/approve`, { method: "POST", body: "{}" }, key, userId);
    if (!res) return { ok: false, error: "failed" };
    if (res.ok) {
      console.log(JSON.stringify({ event: "connect.link_approved" }));
      return { ok: true };
    }
    if (res.status === 404) return { ok: false, error: "invalid_code" };
    if (res.status === 410) return { ok: false, error: "expired" };
    return { ok: false, error: "failed" };
  },
});
