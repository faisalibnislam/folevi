import { embedPlayer } from "@folevi/editor-schema";

export const dynamic = "force-dynamic";

// The page an embed block's player sits in inside the Mac, iPhone and iPad apps (components/editor/EmbedFrame.tsx).
// Their notes live on app://folevi or capacitor://localhost, which browsers never send as a referrer, and YouTube
// now refuses to play without one ("Error 153"). Framed from here, the player sees https://app.folevi.com instead.
//
// It is a frame's page and nothing else, and it frames only a player embeds.ts itself would build:
// - Opened as a page of its own (a link someone was sent) it is refused. Browsers say what a request is for in
//   Sec-Fetch-Dest; anything but "iframe" is not this page's use. A request with no such header is let through:
//   browsers leave it out over plain http, which is how a Folevi server on a home network is reached, and the
//   apps' embeds must keep working there. Every current browser sends it over https, so a link to this page on
//   the website never draws anything.
// - `src` is taken apart and made again (embedPlayer), so what is framed is a player's own address with only the
//   parts Folevi writes, never just any page of the players' sites.
// Its headers (next.config.ts) let only the apps frame it, and keep a frame's answer from being reused for a page.

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const refuse = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export function GET(request: Request) {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest !== null && dest !== "iframe") return refuse(403, "This page only works inside the Folevi app.");
  const src = embedPlayer(new URL(request.url).searchParams.get("src") ?? "");
  if (!src) return refuse(400, "Not an embed");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embed</title><style>html,body{margin:0;height:100%;background:#000}iframe{display:block;width:100%;height:100%;border:0}</style><iframe src="${escape(src)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
