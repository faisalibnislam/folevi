import { EMBED_FRAME_ORIGINS } from "@folevi/editor-schema";

export const dynamic = "force-dynamic";

// The page an embed block's player sits in inside the Mac, iPhone and iPad apps (components/editor/EmbedFrame.tsx).
// Their notes live on app://folevi or capacitor://localhost, which browsers never send as a referrer, and YouTube
// now refuses to play without one ("Error 153"). Framed from here, the player sees https://app.folevi.com instead.
// It only frames the players embeds.ts builds addresses for; its headers (next.config.ts) let only the apps frame it.

function player(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (EMBED_FRAME_ORIGINS as readonly string[]).includes(url.origin) ? url.href : null;
  } catch {
    return null;
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function GET(request: Request) {
  const src = player(new URL(request.url).searchParams.get("src"));
  if (!src) return new Response("Not an embed", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embed</title><style>html,body{margin:0;height:100%;background:#000}iframe{display:block;width:100%;height:100%;border:0}</style><iframe src="${escape(src)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
