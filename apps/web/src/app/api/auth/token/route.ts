import { NextResponse } from "next/server";
import { getConvexToken } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const result = await getConvexToken(force);
  const headers = { "cache-control": "private, no-store", vary: "cookie" };
  if (!result) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  return NextResponse.json(result, { headers });
}
