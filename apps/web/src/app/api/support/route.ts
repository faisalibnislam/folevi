import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/lib/convex/api";
import { isSameOrigin } from "@/lib/auth/origin";
import { getToken } from "@/lib/auth/server";
import { hasSessionCookie } from "@/lib/auth/session";
import { logEvent, requestIdFrom, withRequestLog } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;

/** The visitor's IP as the platform reports it (Vercel sets these at the edge); only its hash leaves this server. */
function clientKey(request: Request): string {
  const ip = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

/**
 * Support requests from the support page (folevi.com/support) and the app's "Contact support" dialog.
 * The web server calls Convex with FOLEVI_SERVER_SECRET and a hashed client key (for rate limits), and
 * forwards the visitor's session when there is one: the account is attached on the server from that
 * session, never from anything the browser sends.
 */
export const POST = withRequestLog("api/support", async (request: Request) => {
  const requestId = requestIdFrom(request.headers);
  if (!isSameOrigin(request)) return NextResponse.json({ error: { code: "forbidden", message: "Not allowed." } }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) return NextResponse.json({ error: { code: "invalid_argument", message: "That request is too long." } }, { status: 413 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!url || !secret) {
    logEvent("error", "support.submit", { requestId, outcome: "not_configured" });
    return NextResponse.json({ error: { code: "unavailable", message: "Support requests aren't available right now. Email support@folevi.com instead." } }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) throw new Error("too large");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "invalid_argument", message: "That request couldn't be read." } }, { status: 400 });
  }

  const client = new ConvexHttpClient(url);
  if (await hasSessionCookie()) {
    try {
      const token = await getToken();
      if (token) client.setAuth(token);
    } catch {
      // An expired session files the request as signed out, under the address typed in the form.
    }
  }
  try {
    const result = await client.mutation(api.support.submit, {
      serverSecret: secret,
      clientKey: clientKey(request),
      name: field(body, "name"),
      email: field(body, "email") || undefined,
      topic: field(body, "topic"),
      message: field(body, "message"),
      website: field(body, "website") || undefined,
      source: body.source === "in_app" ? "in_app" : "web_form",
    });
    logEvent("info", "support.submit", { requestId, outcome: result.number === null ? "dropped" : "created" });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const data = error instanceof ConvexError ? (error.data as { code?: string; message?: string; field?: string }) : null;
    const code = data?.code ?? "unknown";
    logEvent(code === "rate_limited" || code === "invalid_argument" ? "warn" : "error", "support.submit", { requestId, outcome: "error", code });
    if (code === "invalid_argument") return NextResponse.json({ error: { code, message: data?.message ?? "Check the form.", field: data?.field ?? null } }, { status: 400 });
    if (code === "rate_limited") return NextResponse.json({ error: { code, message: "You've sent several requests in a short time. Wait a while, or email support@folevi.com." } }, { status: 429 });
    return NextResponse.json({ error: { code: "unavailable", message: "Your request couldn't be sent. Try again, or email support@folevi.com." } }, { status: 502 });
  }
});
