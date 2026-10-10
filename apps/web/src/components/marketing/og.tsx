import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LETTER_PATHS, LOGO_HEIGHT, LOGO_WIDTH } from "@/components/brand/FoleviMark";
import { tokens } from "@folevi/design-tokens";

/** The corner scale (packages/design-tokens): images render without CSS, so they read the numbers. */
const R = tokens.radius;

/*
 * Open Graph images for feature, template and docs pages, in the style of the site-wide image
 * (src/app/opengraph-image.tsx): the same cream page, soft colour washes, Inter, the logo, and a lifted
 * page sheet. The sheet shows the page's own outline (its sections, or a template's headings).
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const CREAM = "#FBFAF9";
const HEADING = "#4A2F2C";
const INK = "#1D1814";
const MUTED = "#6B5A56";
const ACCENT = "#78534E";
const EMBER = "#F46036";
const PEACH = "#FFD0AE";
const ROSE = "#F5DDD2";
const LILAC = "#E6DDF6";
const MOSS_SOFT = "#E2F4E8";
const MARIGOLD_SOFT = "#FEEBD3";
const LINE = "#EDE3DF";

const FONT_DIR = join(process.cwd(), "public", "marketing", "fonts");
const markPng = readFile(join(process.cwd(), "public", "brand", "folevi-mark-256.png"))
  .then((b) => `data:image/png;base64,${b.toString("base64")}`)
  .catch(() => null);
const fonts = Promise.all([readFile(join(FONT_DIR, "Inter-SemiBold.ttf")), readFile(join(FONT_DIR, "Inter-Medium.ttf"))]).catch(() => null);

function titleSize(title: string): number {
  if (title.length <= 32) return 68;
  if (title.length <= 52) return 58;
  return 50;
}

export async function renderOgImage({ eyebrow, title, sheetTitle, lines }: { eyebrow: string; title: string; sheetTitle: string; lines: string[] }) {
  const mark = await markPng;
  const data = await fonts;
  const size = titleSize(title);
  const logoWidth = Math.round((44 * LOGO_WIDTH) / LOGO_HEIGHT);
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
          backgroundImage: `radial-gradient(circle at 88% 12%, ${PEACH} 0%, rgba(255,208,174,0) 42%), radial-gradient(circle at 6% 88%, ${ROSE} 0%, rgba(245,221,210,0) 40%), radial-gradient(circle at 62% 96%, ${LILAC} 0%, rgba(230,221,246,0) 34%)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 80,
            top: 120,
            width: 340,
            height: 420,
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            borderRadius: R.container,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(74,47,44,0.06), 0 36px 70px -30px rgba(74,47,44,0.40)",
            transform: "rotate(2deg)",
          }}
        >
          <div style={{ margin: 12, height: 70, borderRadius: R.container - 12, display: "flex", backgroundImage: `linear-gradient(135deg, ${MOSS_SOFT}, ${MARIGOLD_SOFT})` }} />
          <div style={{ display: "flex", flexDirection: "column", padding: "4px 28px", gap: 13 }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: HEADING, letterSpacing: -1, display: "flex" }}>{sheetTitle}</div>
            {lines.slice(0, 5).map((line) => (
              <div key={line} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18, fontWeight: 500, color: INK }}>
                <div style={{ width: 7, height: 7, borderRadius: R.tiny, display: "flex", background: EMBER }} />
                {line.length > 26 ? `${line.slice(0, 25)}…` : line}
              </div>
            ))}
            <div style={{ display: "flex", height: 10, width: 230, marginTop: 6, borderRadius: R.chip, background: LINE }} />
            <div style={{ display: "flex", height: 10, width: 180, borderRadius: R.chip, background: LINE }} />
          </div>
        </div>

        <div style={{ position: "absolute", left: 88, top: 80, bottom: 80, display: "flex", flexDirection: "column", width: 640 }}>
          <div style={{ position: "relative", display: "flex", width: logoWidth, height: 44 }}>
            <svg width={logoWidth} height="44" viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}>
              {LETTER_PATHS.map((d) => (
                <path key={d.slice(0, 16)} fill={HEADING} d={d} />
              ))}
            </svg>
            {/* Satori draws plain <img> elements; next/image doesn't apply inside ImageResponse. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mark ? <img src={mark} width={44} height={44} alt="" style={{ position: "absolute", left: 0, top: 0 }} /> : null}
          </div>
          <div style={{ marginTop: 52, display: "flex", fontSize: 22, fontWeight: 600, letterSpacing: 2.5, textTransform: "uppercase", color: ACCENT }}>{eyebrow}</div>
          <div style={{ marginTop: 18, display: "flex", fontSize: size, fontWeight: 600, lineHeight: 1.04, letterSpacing: -2.4, color: HEADING }}>{title}</div>
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 22, fontWeight: 500, color: MUTED }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 44,
                padding: "0 20px",
                borderRadius: R.control,
                color: "#FFFFFF",
                fontWeight: 600,
                fontSize: 20,
                backgroundImage: `linear-gradient(to bottom, #86625D, ${ACCENT})`,
                boxShadow: "0 8px 18px -8px rgba(74,47,44,0.6)",
              }}
            >
              Free to start
            </div>
            folevi.com
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
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
