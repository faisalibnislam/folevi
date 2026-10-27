import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";
import { isSameOrigin } from "@/lib/auth/origin";
import { logEvent, requestIdFrom, withRequestLog } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const LINK_RE = /^[A-Za-z0-9_-]{22,40}$/;
const MAX_BYTES = 2048;

/** The visitor's IP as the platform reports it (Vercel sets these at the edge); only its hash leaves this server. */
function clientKey(request: Request): string {
  const ip = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

const b64 = (b: ArrayBuffer) => Buffer.from(b).toString("base64url");

/**
 * Opens a Vault one-time link (docs/VAULT_PLAN.md §6) for /vault-link/<id>, when the visitor presses Reveal (never on
 * page load, so link previews don't use up a view). Calls vaultShares.openLink with FOLEVI_SERVER_SECRET and a hashed
 * client key. What comes back is still sealed: only the link's fragment, which never reaches a server, opens it.
 */
export const POST = withRequestLog("api/vault-link", async (request: Request) => {
  const requestId = requestIdFrom(request.headers);
  const noStore = { "cache-control": "no-store" };
  if (!isSameOrigin(request)) return NextResponse.json({ status: "error", message: "Not allowed." }, { status: 403, headers: noStore });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!url || !secret) {
    logEvent("error", "vaultLink.open", { requestId, outcome: "not_configured" });
    return NextResponse.json({ status: "error", message: "Links can't be opened right now." }, { status: 503, headers: noStore });
  }
  let body: { linkId?: unknown; password?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) throw new Error("too large");
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ status: "error", message: "That request couldn't be read." }, { status: 400, headers: noStore });
  }
  const linkId = typeof body.linkId === "string" ? body.linkId : "";
  const password = typeof body.password === "string" && body.password ? body.password.slice(0, 200) : undefined;
  if (!LINK_RE.test(linkId)) return NextResponse.json({ status: "gone" }, { headers: noStore });
  try {
    const r = await new ConvexHttpClient(url).mutation(api.vaultShares.openLink, { linkId, password, serverSecret: secret, clientKey: clientKey(request) });
    logEvent("info", "vaultLink.open", { requestId, outcome: r.status });
    if (r.status !== "ok") return NextResponse.json(r, { headers: noStore });
    return NextResponse.json({ status: "ok", vaultId: r.vaultId, itemId: r.itemId, kind: r.kind, sealedSummary: b64(r.sealedSummary), sealed: b64(r.sealed), wrappedKey: b64(r.wrappedKey!), viewsLeft: r.viewsLeft }, { headers: noStore });
  } catch (e) {
    const code = (e as { data?: { code?: string } }).data?.code ?? "unknown";
    logEvent(code === "rate_limited" ? "warn" : "error", "vaultLink.open", { requestId, outcome: "error", code });
    return NextResponse.json({ status: "error", message: code === "rate_limited" ? "Too many tries. Wait a few minutes." : "The link couldn't be opened. Try again." }, { status: code === "rate_limited" ? 429 : 502, headers: noStore });
  }
});
