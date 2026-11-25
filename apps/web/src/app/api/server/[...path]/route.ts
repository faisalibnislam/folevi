// The admin panel's way to folevid (docs/self-hosting/CONTRACT.md §5), server edition only: health, logs,
// backups, remote access, updates and diagnostics. The caller must be signed in as the server's owner or an
// admin (asked of Convex, users.me); the web server then calls folevid's loopback API with the server
// secret, which never reaches the browser.
import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/lib/convex/api";
import { isSameOrigin } from "@/lib/auth/origin";
import { getToken } from "@/lib/auth/server";
import { isServerEdition } from "@/lib/edition";
import { internalConvexUrl } from "@/lib/runtime/internal";
import { callControl, controlRoute } from "@/lib/server-edition/control";
import { logEvent, requestIdFrom, withRequestLog } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;
const noStore = { "cache-control": "private, no-store" };

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: noStore });

/** "owner", "admin", or null for anyone else (who gets the same plain 404 as a missing page). */
async function callerRole(): Promise<"owner" | "admin" | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    // users.me, not admin.whoami: a server's owner and admins need no two-step verification (CONTRACT §7.1).
    const me = await fetchQuery(api.users.me, {}, { token, url: internalConvexUrl() });
    const role = me.state === "ready" ? me.profile.platformRole : null;
    return role === "super_admin" ? "owner" : role === "ops_admin" ? "admin" : null;
  } catch {
    return null;
  }
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (!isServerEdition()) return new NextResponse("Not found", { status: 404 });
  const requestId = requestIdFrom(request.headers);
  if (request.method !== "GET" && !isSameOrigin(request)) return fail(403, "forbidden", "Not allowed.");
  const path = (await params).path.join("/");
  const route = controlRoute(request.method, path);
  const role = await callerRole();
  if (!role || !route) return fail(404, "not_found", "Not found.");
  if (route.access === "owner" && role !== "owner") return fail(403, "owner_only", "Only the server's owner can do this.");
  let body: string | null = null;
  if (request.method !== "GET") {
    body = await request.text();
    if (body.length > MAX_BYTES) return fail(413, "too_large", "That request is too long.");
    if (body) {
      try {
        JSON.parse(body);
      } catch {
        return fail(400, "invalid_argument", "That request couldn't be read.");
      }
    } else body = "{}";
  }
  try {
    const upstream = await callControl(route, path, new URL(request.url).searchParams, body);
    const text = await upstream.text();
    logEvent(upstream.ok ? "info" : "warn", "server.control", { requestId, path: path.split("/")[0], status: upstream.status });
    return new NextResponse(text || "{}", { status: upstream.status, headers: { ...noStore, "content-type": "application/json" } });
  } catch (e) {
    const notConfigured = e instanceof Error && e.message === "control_not_configured";
    logEvent("error", "server.control", { requestId, path: path.split("/")[0], outcome: notConfigured ? "not_configured" : "unreachable" });
    return fail(503, "unavailable", notConfigured ? "The server's supervisor isn't configured." : "The server's supervisor isn't answering. It may be restarting.");
  }
}

export const GET = withRequestLog("api/server", handle);
export const POST = withRequestLog("api/server", handle);
export const PUT = withRequestLog("api/server", handle);
