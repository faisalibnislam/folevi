import { NextResponse } from "next/server";
import { mintDevIdToken } from "@/lib/auth/dev";
import { isDevAuthEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Development-only token endpoint for the native Mac app's Debug "Developer sign-in". */
export async function POST(request: Request) {
  if (!isDevAuthEnabled()) return new NextResponse("Not found", { status: 404 });
  const body = (await request.json().catch(() => null)) as { email?: string; name?: string; deviceId?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  const deviceId = (body?.deviceId ?? "mac").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "mac";
  const result = await mintDevIdToken({ email, name: body?.name?.slice(0, 80) || email, sid: `dev-${deviceId}`, mfa: true, verified: true });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
