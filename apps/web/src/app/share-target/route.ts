/**
 * The PWA's share target (manifest share_target) when the service worker hasn't taken the share yet (the
 * first share after installing, or a browser without one): the title, text and link go on to /share in
 * the address, where the person saves them to an Inbox. Files can't travel that way; how many were left
 * out is passed on so the page can say so. Nothing is stored here.
 *
 * A share comes from the system's share sheet, which the browser sends with Sec-Fetch-Site "none" (or, in an
 * older one, without the header). A form another site posts here says "cross-site" and is refused: it would
 * open Save to Folevi already filled in with that site's words.
 */
export const dynamic = "force-dynamic";

const field = (form: FormData, name: string, max: number) => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : "";
};

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const form = await request.formData().catch(() => null);
  const query = new URLSearchParams();
  if (form) {
    for (const [name, max] of [["title", 200], ["text", 4000], ["url", 2048]] as const) {
      const value = field(form, name, max);
      if (value) query.set(name, value);
    }
    const files = form.getAll("files").filter((f) => typeof f !== "string").length;
    if (files) query.set("skipped", String(Math.min(files, 99)));
  }
  // 303: the browser follows with a GET, so the share page loads (never a resubmitted form).
  return new Response(null, { status: 303, headers: { location: query.size ? `/share?${query}` : "/share", "cache-control": "no-store" } });
}
