import { convexSiteUrl } from "@/lib/server/mcp";

/**
 * Your tasks as a calendar feed: https://app.folevi.com/api/calendar/<token>.ics, forwarded to the Convex
 * route that builds it (convex/calendarFeeds.ts). Calendar apps poll it; nothing about the request is kept.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,80}(\.ics)?$/.test(token)) return new Response("Not found", { status: 404 });
  const res = await fetch(`${convexSiteUrl()}/ical/${token.endsWith(".ics") ? token : `${token}.ics`}`, { cache: "no-store" });
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "content-disposition", "x-robots-tag"]) {
    const value = res.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}
