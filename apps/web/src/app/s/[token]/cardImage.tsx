import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { tokens } from "@folevi/design-tokens";
import { LETTER_PATHS, LOGO_HEIGHT, LOGO_WIDTH } from "@/components/brand/FoleviMark";
import { coverArtOf } from "@/lib/cover";
import { noteLook, type CardLook } from "@/lib/cardLook";

// The drawing of a shared note's preview image (opengraph-image.tsx; /dev/share-card draws samples).
/*
 * A shared link's preview in messages and on social sites: the note's own card, as the app draws it (its theme's
 * paper, ink and accent, its look: spiral, index card, pocket and so on), its title and first lines, beside the
 * title in large type and the Folevi mark. Only for a link anyone can open as it is (convex/sharing.ts
 * publicLinkCard); any other link shows the site's own image, so nothing of the note shows before its password.
 */

const size = { width: 1200, height: 630 };

const R = tokens.radius;
const CREAM = "#FBFAF9";
const HEADING = "#4A2F2C";
const MUTED = "#6B5A56";

const FONT_DIR = join(process.cwd(), "public", "marketing", "fonts");
const fonts = Promise.all([readFile(join(FONT_DIR, "Inter-SemiBold.ttf")), readFile(join(FONT_DIR, "Inter-Medium.ttf"))]).catch(() => null);
const markPng = readFile(join(process.cwd(), "public", "brand", "folevi-mark-256.png"))
  .then((b) => `data:image/png;base64,${b.toString("base64")}`)
  .catch(() => null);

type Line = { t: string; x: string; l?: number; c?: boolean };

/** `#rrggbb` mixed with another (p: the first's share), as the app's color-mix does. */
function mix(a: string, b: string, p: number): string {
  const n = (h: string) => {
    const v = h.replace("#", "");
    const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const [x, y] = [n(a), n(b)];
  return `#${x.map((c, i) => Math.round(c * p + y[i]! * (1 - p)).toString(16).padStart(2, "0")).join("")}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function titleSize(title: string): number {
  if (title.length <= 24) return 72;
  if (title.length <= 44) return 60;
  return 50;
}

/** What the card shows (convex/sharing.ts publicLinkCard's answer). */
export type ShareCard = { title: string; excerpt: string; preview: unknown[] | null; cover: { kind: string; value?: string }; shape: string | null; kind: string };

export async function renderShareCard(card: ShareCard) {
  const theme = coverArtOf(card.cover as Parameters<typeof coverArtOf>[0]);
  const colorCover = card.cover.kind === "color" ? (card.cover.value ?? "").split(",")[0]?.trim() : undefined;
  const paper = theme?.paper ?? "#FFFFFF";
  const ink = theme?.ink ?? HEADING;
  const accent = theme?.accent ?? colorCover ?? "#E8E2DF";
  const spine = theme?.accent ?? colorCover ?? "#EDE8E6";
  const faint = mix(ink, paper, 0.62);
  const tint = (p: number) => mix(ink, paper, p / 100);
  const look: CardLook = noteLook({ shape: card.shape, kind: card.kind });
  const title = card.title || "Untitled";
  const lines = ((card.preview ?? []) as Line[]).filter((l) => l.x?.trim()).slice(0, 7);
  const text = lines.length ? lines : card.excerpt ? [{ t: "paragraph", x: card.excerpt }] : [];
  const data = await fonts;
  const mark = await markPng;
  const logoWidth = Math.round((40 * LOGO_WIDTH) / LOGO_HEIGHT);

  const W = 400;
  const H = 432;
  const sheet = (rotate: number, bg: string, dx: number, dy: number) => (
    <div style={{ position: "absolute", left: dx, top: dy, width: W, height: H, display: "flex", borderRadius: `${R.tiny}px ${R.panel}px ${R.panel}px ${R.tiny}px`, background: bg, boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 6px 14px -8px rgba(20,20,30,0.3)", transform: `rotate(${rotate}deg)` }} />
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: CREAM,
          fontFamily: data ? "Inter" : undefined,
          backgroundImage: `radial-gradient(circle at 86% 14%, ${mix(accent, CREAM, 0.28)} 0%, rgba(251,250,249,0) 46%), radial-gradient(circle at 8% 90%, ${mix(accent, CREAM, 0.16)} 0%, rgba(251,250,249,0) 42%)`,
        }}
      >
        {/* The card, in the note's theme and look. */}
        <div style={{ position: "absolute", right: 96, top: 96, width: W, height: H, display: "flex", transform: "rotate(2deg)" }}>
          {look === "stack" ? sheet(5, tint(16), 12, 8) : null}
          {look === "stack" ? sheet(-3.5, tint(9), -4, 4) : null}
          {look === "tabs" ? (
            <div style={{ position: "absolute", right: -14, top: 52, width: 22, height: 268, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ flex: 1.2, display: "flex", background: ink, borderRadius: `0 ${R.tiny}px ${R.tiny}px 0` }} />
              <div style={{ flex: 1, display: "flex", background: tint(30), borderRadius: `0 ${R.tiny}px ${R.tiny}px 0` }} />
              <div style={{ flex: 1, display: "flex", background: tint(16), borderRadius: `0 ${R.tiny}px ${R.tiny}px 0` }} />
            </div>
          ) : null}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: W,
              height: H,
              display: "flex",
              overflow: "hidden",
              background: paper,
              borderRadius: `${R.tiny}px ${R.panel}px ${R.panel}px ${R.tiny}px`,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.06), -6px 30px 50px -24px rgba(20,20,30,0.35)",
            }}
          >
            <div style={{ width: 24, height: "100%", display: "flex", background: spine, boxShadow: "inset -1px 0 0 rgba(0,0,0,0.06)" }} />
            {look === "spiral" ? (
              <div style={{ position: "absolute", left: 13, top: 26, bottom: 26, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} style={{ width: 11, height: 11, display: "flex", borderRadius: R.chip, background: mix(ink, paper, 0.82), boxShadow: `0 0 0 3px ${paper}` }} />
                ))}
              </div>
            ) : null}
            {look === "graph" ? (
              <div style={{ position: "absolute", left: 24, top: 0, right: 0, bottom: 0, display: "flex" }}>
                {Array.from({ length: 16 }, (_, i) => (
                  <div key={`v${i}`} style={{ position: "absolute", left: i * 24, top: 0, bottom: 0, width: 1, display: "flex", background: tint(9) }} />
                ))}
                {Array.from({ length: 18 }, (_, i) => (
                  <div key={`h${i}`} style={{ position: "absolute", top: i * 24, left: 0, right: 0, height: 1, display: "flex", background: tint(9) }} />
                ))}
              </div>
            ) : null}
            <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", padding: "34px 26px 24px 30px" }}>
              {look === "memo" ? (
                <div style={{ display: "flex", alignSelf: "flex-start", padding: "6px 10px", borderRadius: R.tiny, background: ink, color: paper, fontSize: 17, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>{clip(title, 28)}</div>
              ) : (
                <div style={{ display: "flex", fontSize: 30, fontWeight: 600, lineHeight: 1.18, letterSpacing: -0.6, color: ink }}>{clip(title, 48)}</div>
              )}
              {look === "index" ? <div style={{ display: "flex", height: 2, marginTop: 12, background: "#E88E8E" }} /> : null}
              <div style={{ display: "flex", flexDirection: "column", marginTop: 20, gap: look === "index" ? 0 : 6 }}>
                {text.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      fontSize: l.t === "heading" ? 18 : 16,
                      fontWeight: l.t === "heading" ? 600 : 500,
                      lineHeight: 1.45,
                      color: l.t === "heading" ? ink : faint,
                      ...(look === "index" ? { borderBottom: "1px solid rgba(120,160,210,0.4)", paddingBottom: 3, paddingTop: 3 } : {}),
                    }}
                  >
                    {l.t === "todo" ? <div style={{ width: 13, height: 13, display: "flex", borderRadius: R.tiny, border: `1.5px solid ${faint}`, background: l.c ? faint : "transparent" }} /> : null}
                    {l.t === "bulleted" || l.t === "numbered" ? <div style={{ width: 5, height: 5, display: "flex", borderRadius: R.chip, background: faint }} /> : null}
                    {clip(l.x.replace(/\s+/g, " "), 40)}
                  </div>
                ))}
              </div>
            </div>
            {look === "pocket" ? (
              <div style={{ position: "absolute", left: 24, right: 0, bottom: 0, height: "44%", display: "flex", background: tint(7), borderTop: `1px solid ${mix(ink, paper, 0.14)}` }} />
            ) : null}
          </div>
        </div>

        {/* The title in large type and the Folevi mark. */}
        <div style={{ position: "absolute", left: 88, top: 80, bottom: 80, width: 560, display: "flex", flexDirection: "column" }}>
          <div style={{ position: "relative", display: "flex", width: logoWidth, height: 40 }}>
            <svg width={logoWidth} height="40" viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}>
              {LETTER_PATHS.map((d) => (
                <path key={d.slice(0, 16)} fill={HEADING} d={d} />
              ))}
            </svg>
            {/* Satori draws plain <img> elements; next/image doesn't apply inside ImageResponse. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mark ? <img src={mark} width={40} height={40} alt="" style={{ position: "absolute", left: 0, top: 0 }} /> : null}
          </div>
          <div style={{ marginTop: "auto", display: "flex", fontSize: 22, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: MUTED }}>Shared note</div>
          <div style={{ marginTop: 14, display: "flex", fontSize: titleSize(title), fontWeight: 600, lineHeight: 1.05, letterSpacing: -2, color: HEADING }}>{clip(title, 70)}</div>
          {card.excerpt ? <div style={{ marginTop: 22, display: "flex", fontSize: 24, fontWeight: 500, lineHeight: 1.4, color: MUTED }}>{clip(card.excerpt.replace(/\s+/g, " "), 110)}</div> : null}
        </div>
      </div>
    ),
    {
      ...size,
      ...(data
        ? {
            fonts: [
              { name: "Inter", data: data[0], style: "normal" as const, weight: 600 as const },
              { name: "Inter", data: data[1], style: "normal" as const, weight: 500 as const },
            ],
          }
        : {}),
    },
  );
}
