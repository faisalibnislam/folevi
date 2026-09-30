import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LETTER_PATHS, LOGO_HEIGHT, LOGO_WIDTH } from "@/components/brand/FoleviMark";
import { ImageResponse } from "next/og";

export const alt = "Folevi: a quiet notes app for ideas that keep growing.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// "Warm Folio" palette (light theme tokens).
const CREAM = "#FBFAF9";
const HEADING = "#4A2F2C";
const INK = "#1D1814";
const MUTED = "#6B5A56";
const ACCENT = "#78534E";
const EMBER = "#F46036";
const PEACH = "#FFD0AE";
const ROSE = "#F5DDD2";
const LILAC = "#E6DDF6";
const MOSS = "#3FAE6E";
const MOSS_SOFT = "#E2F4E8";
const MARIGOLD_SOFT = "#FEEBD3";
const LINE = "#EDE3DF";

// Inter ships with the repo (SIL OFL 1.1, see public/marketing/fonts/Inter-OFL.txt). Read once per module.
const FONT_DIR = join(process.cwd(), "public", "marketing", "fonts");
// The mark, pre-rendered by scripts/brand-icons.mjs (Satori can't draw the SVG's lighting filters).
const markPng = readFile(join(process.cwd(), "public", "brand", "folevi-mark-256.png"))
  .then((b) => `data:image/png;base64,${b.toString("base64")}`)
  .catch(() => null);
const fonts = Promise.all([readFile(join(FONT_DIR, "Inter-SemiBold.ttf")), readFile(join(FONT_DIR, "Inter-Medium.ttf"))]).catch(() => null);

function Bubble({ left, top, s, children }: { left: number; top: number; s: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: s,
        height: s,
        borderRadius: s,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 38%, rgba(255,222,200,0.55) 100%)",
        border: "2px solid rgba(255,255,255,0.95)",
        boxShadow: "0 22px 40px -16px rgba(74,47,44,0.35)",
      }}
    >
      {children}
    </div>
  );
}

export default async function OpengraphImage() {
  const mark = await markPng;
  const data = await fonts;
  const tasks = ["Draft the sign-up sheet", "Print seed labels", "Buy glassine envelopes"];

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
        {/* A lifted page sheet */}
        <div
          style={{
            position: "absolute",
            right: 92,
            top: 132,
            width: 360,
            height: 420,
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            borderRadius: 26,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(74,47,44,0.06), 0 36px 70px -30px rgba(74,47,44,0.40)",
            transform: "rotate(2deg)",
          }}
        >
          <div style={{ margin: 12, height: 78, borderRadius: 16, display: "flex", backgroundImage: `linear-gradient(135deg, ${MOSS_SOFT}, ${MARIGOLD_SOFT})` }} />
          <div style={{ display: "flex", flexDirection: "column", padding: "4px 28px", gap: 14 }}>
            <div style={{ fontSize: 34, fontWeight: 600, color: HEADING, letterSpacing: -1.2, display: "flex" }}>Seed library</div>
            {tasks.map((t, i) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18, fontWeight: 500, color: i === 0 ? "#9A8A86" : INK }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    display: "flex",
                    background: i === 0 ? MOSS : "#FFFFFF",
                    border: i === 0 ? `1.5px solid ${MOSS}` : `1.5px solid #D8C8C3`,
                  }}
                />
                {t}
              </div>
            ))}
            <div style={{ display: "flex", marginTop: 8, height: 4, width: 150, borderRadius: 4, background: EMBER }} />
            <div style={{ display: "flex", height: 10, width: 250, borderRadius: 6, background: LINE }} />
            <div style={{ display: "flex", height: 10, width: 200, borderRadius: 6, background: LINE }} />
          </div>
        </div>

        <Bubble left={690} top={96} s={104}>
          <svg width="46" height="46" viewBox="0 0 32 32">
            <path d="M16 28C16 18 10 13 4 12c0 7 4 13 12 16Z" fill={MOSS} />
            <path d="M16 28c0-9 5-15 12-17-1 8-5 14-12 17Z" fill="#5CCB8A" />
          </svg>
        </Bubble>
        <Bubble left={1060} top={470} s={88}>
          {mark ? <img src={mark} width={46} height={46} alt="" /> : <div style={{ display: "flex" }} />}
        </Bubble>

        <div style={{ position: "absolute", left: 88, top: 84, display: "flex", flexDirection: "column", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative", display: "flex", width: Math.round((48 * LOGO_WIDTH) / LOGO_HEIGHT), height: 48 }}>
              <svg width={Math.round((48 * LOGO_WIDTH) / LOGO_HEIGHT)} height="48" viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}>
                {LETTER_PATHS.map((d) => (
                  <path key={d.slice(0, 16)} fill={HEADING} d={d} />
                ))}
              </svg>
              {mark ? <img src={mark} width={48} height={48} alt="" style={{ position: "absolute", left: 0, top: 0 }} /> : null}
            </div>
          </div>
          <div
            style={{
              marginTop: 58,
              fontSize: 74,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: -3,
              color: HEADING,
              display: "flex",
            }}
          >
            A quiet notes app for ideas that keep growing.
          </div>
          <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 14, fontSize: 24, fontWeight: 500, color: MUTED }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 46,
                padding: "0 22px",
                borderRadius: 46,
                color: "#FFFFFF",
                fontWeight: 600,
                fontSize: 21,
                backgroundImage: `linear-gradient(to bottom, #86625D, ${ACCENT})`,
                boxShadow: "0 8px 18px -8px rgba(74,47,44,0.6)",
              }}
            >
              Free to start
            </div>
            On the web · Mac coming soon
          </div>
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
