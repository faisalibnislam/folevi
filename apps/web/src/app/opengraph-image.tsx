import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Folevi — A quieter place for ideas that keep growing.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#F4F1E9";
const IVORY = "#FBFAF6";
const INK = "#18201C";
const MUTED = "#5F6962";
const LINE = "#D8D7CF";
const ACCENT = "#3159D8";
const MOSS = "#739779";

// If an Instrument Serif TTF is placed here, the headline uses it; otherwise the built-in sans is used.
const SERIF_PATH = join(process.cwd(), "public", "marketing", "fonts", "InstrumentSerif-Regular.ttf");

function contour(cx: number, cy: number, r: number, i: number): string {
  const n = 120;
  let d = "";
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI * 2;
    const w = 1 + 0.07 * Math.sin(3 * t + i * 0.4) + 0.04 * Math.sin(5 * t - i * 0.3);
    const x = cx + r * 1.4 * w * Math.cos(t);
    const y = cy + r * w * Math.sin(t);
    d += `${k === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export default async function OpengraphImage() {
  const serif = existsSync(SERIF_PATH) ? await readFile(SERIF_PATH) : null;
  const rings = Array.from({ length: 11 }, (_, i) => contour(930, 170, 30 + i * 34, i));

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: PAPER, ...(serif ? { fontFamily: "Instrument Serif" } : {}) }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", top: 0, left: 0 }}>
          {Array.from({ length: 19 }, (_, i) => (
            <path key={`r${i}`} d={`M0 ${32 * (i + 1)}H1200`} stroke={LINE} strokeOpacity="0.55" strokeWidth="1" />
          ))}
          <path d="M84 0V630" stroke={ACCENT} strokeOpacity="0.25" strokeWidth="1" />
          {rings.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#B9B8AE" strokeOpacity={i % 4 === 0 ? 0.9 : 0.55} strokeWidth="1.2" />
          ))}
        </svg>

        {/* Offset folio leaves */}
        <div style={{ position: "absolute", right: 72, top: 150, width: 330, height: 380, display: "flex", background: "#EDE9DF", border: `1px solid ${LINE}`, borderRadius: 14, transform: "rotate(3deg)" }} />
        <div style={{ position: "absolute", right: 90, top: 160, width: 330, height: 380, display: "flex", background: IVORY, border: `1px solid ${LINE}`, borderRadius: 14, transform: "rotate(1.4deg)" }} />
        <div
          style={{
            position: "absolute",
            right: 110,
            top: 172,
            width: 330,
            height: 380,
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 24px 48px -24px rgba(24,32,28,0.35)",
          }}
        >
          <div style={{ height: 70, background: "#E3EDE2", display: "flex" }} />
          <div style={{ display: "flex", flexDirection: "column", padding: "18px 24px", gap: 12 }}>
            <div style={{ fontSize: 32, color: INK, display: "flex" }}>Seed library</div>
            {["Draft the sign-up sheet", "Print seed labels", "Buy glassine envelopes", "Confirm shelves with Ines"].map((t, i) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, color: i === 0 ? "#7E857F" : INK }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${i === 0 ? ACCENT : "#B9B8AE"}`, background: i === 0 ? ACCENT : "#FFFFFF", display: "flex" }} />
                {t}
              </div>
            ))}
            <div style={{ display: "flex", marginTop: 6, height: 44, borderRadius: 9, border: `1px solid ${LINE}`, borderLeft: `3px solid ${MOSS}`, alignItems: "center", paddingLeft: 12, fontSize: 16, color: INK }}>
              Planting calendar
            </div>
          </div>
        </div>

        <div style={{ position: "absolute", left: 120, top: 92, display: "flex", flexDirection: "column", width: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="44" height="44" viewBox="0 0 32 32">
              <path d="M6 28V10.5C6 6.9 8.9 4 12.5 4H26.5C26.5 8 23.3 11.2 19.3 11.2H14V28H6Z" fill={INK} />
              <path d="M16.2 14.4H23.6C23.6 18 20.7 20.9 17.1 20.9H16.2V14.4Z" fill={ACCENT} />
            </svg>
            <div style={{ fontSize: 40, color: INK, display: "flex", letterSpacing: -0.5 }}>Folevi</div>
          </div>
          <div
            style={{
              marginTop: 64,
              fontSize: serif ? 86 : 68,
              lineHeight: serif ? 0.98 : 1.05,
              letterSpacing: serif ? -1.5 : -2.5,
              color: INK,
              display: "flex",
              fontWeight: serif ? 400 : 500,
            }}
          >
            A quieter place for ideas that keep growing.
          </div>
          <div style={{ marginTop: 30, fontSize: 24, color: MUTED, display: "flex" }}>Notes, pages and tasks · Web and Mac</div>
        </div>
      </div>
    ),
    {
      ...size,
      ...(serif ? { fonts: [{ name: "Instrument Serif", data: serif, style: "normal" as const, weight: 400 as const }] } : {}),
    },
  );
}
