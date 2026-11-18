import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LETTER_PATHS, LOGO_HEIGHT, LOGO_WIDTH } from "@/components/brand/FoleviMark";
import { ImageResponse } from "next/og";
import { tokens } from "@folevi/design-tokens";

/** The corner scale (packages/design-tokens): images render without CSS, so they read the numbers. */
const R = tokens.radius;

export const alt = "Folevi is a digital workspace for notes, docs and tasks. A note open in the Mac app and on an iPhone, over Van Gogh’s Irises.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * The site-wide share image, in the look of the home page's hero (components/marketing/home/HeroNote.tsx):
 * the Irises note theme (art-03, the hero's first theme) as a full-bleed cover, the hero's title in Spectral,
 * and the same note open in a Mac window and on an iPhone. The note's colors are the Irises theme's
 * (packages/design-tokens/covers/covers.json).
 */

// The Irises theme.
const PAPER = "#EAFAF4";
const INK = "#0B362B";
const ACCENT = "#006E58";
const LINE = "rgba(11,54,43,0.12)";
const FAINT = "rgba(11,54,43,0.45)";
// The app's neutral chrome around the note.
const CHROME = "#F7F7F6";
const CHROME_LINE = "#E6E6E3";
const CHROME_TEXT = "#55524F";
// The hero's deep shade: the theme's accent mixed with black, over the painting.
const SHADE = "0,34,27";

// Inter (UI text) and Spectral (the app's display face) ship with the repo, both SIL OFL 1.1: see
// public/marketing/fonts/*-OFL.txt. Spectral is copied from apps/native-kit's font folder.
const FONT_DIR = join(process.cwd(), "public", "marketing", "fonts");
const fonts = Promise.all([
  readFile(join(FONT_DIR, "Inter-SemiBold.ttf")),
  readFile(join(FONT_DIR, "Inter-Medium.ttf")),
  readFile(join(FONT_DIR, "Spectral-SemiBold.ttf")),
]).catch(() => null);
// Van Gogh's Irises (public domain), cropped to 1200 × 630 from public/covers/art-03.webp (Satori can't read WebP).
const dataUrl = (file: string, type: string) =>
  readFile(join(process.cwd(), "public", ...file.split("/")))
    .then((b) => `data:${type};base64,${b.toString("base64")}`)
    .catch(() => null);
const irisesJpg = dataUrl("marketing/og/irises.jpg", "image/jpeg");
// The mark, pre-rendered by scripts/brand-icons.mjs (Satori can't draw the SVG's lighting filters).
const markPng = dataUrl("brand/folevi-mark-256.png", "image/png");

const TITLE = "Studio launch";
const TASKS: Array<[string, boolean]> = [
  ["Book the photographer", true],
  ["Send the press kit", false],
  ["Confirm the venue for Friday", false],
];

function Check({ done, s }: { done: boolean; s: number }) {
  return (
    <div
      style={{
        width: s,
        height: s,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: R.chip,
        background: done ? ACCENT : "rgba(255,255,255,0.7)",
        border: `1.5px solid ${done ? ACCENT : "rgba(11,54,43,0.35)"}`,
      }}
    >
      {done ? (
        <svg width={s * 0.7} height={s * 0.7} viewBox="0 0 16 16">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
}

/** The note as the editor draws it: the cover, the title in Spectral, a line of text and the checklist. */
function Note({ cover, scale, coverHeight }: { cover: string | null; scale: number; coverHeight: number }) {
  const px = (n: number) => Math.round(n * scale);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, background: PAPER }}>
      {cover ? (
        <img src={cover} width={px(560)} height={coverHeight} alt="" style={{ width: "100%", height: coverHeight, objectFit: "cover" }} />
      ) : (
        <div style={{ display: "flex", height: coverHeight, background: "#3A5BA0" }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", padding: `${px(18)}px ${px(26)}px`, gap: px(11) }}>
        <div style={{ display: "flex", fontFamily: "Spectral", fontSize: px(30), fontWeight: 600, color: INK, letterSpacing: -0.4 }}>{TITLE}</div>
        <div style={{ display: "flex", fontSize: px(14), fontWeight: 500, color: FAINT }}>Friday, 10:00 at the studio</div>
        {TASKS.map(([text, done]) => (
          <div key={text} style={{ display: "flex", alignItems: "center", gap: px(10), fontSize: px(15), fontWeight: 500, color: done ? FAINT : INK }}>
            <Check done={done} s={px(16)} />
            <div style={{ display: "flex", textDecoration: done ? "line-through" : "none" }}>{text}</div>
          </div>
        ))}
        <div style={{ display: "flex", marginTop: px(4), height: px(8), width: px(230), borderRadius: R.chip, background: LINE }} />
        <div style={{ display: "flex", height: px(8), width: px(170), borderRadius: R.chip, background: LINE }} />
      </div>
    </div>
  );
}

function MacWindow({ cover }: { cover: string | null }) {
  const sidebar = ["Home", "Today", "Tasks", "Studio launch", "Seed library", "Weekly reset"];
  return (
    <div
      style={{
        position: "absolute",
        left: 610,
        top: 92,
        width: 500,
        height: 400,
        display: "flex",
        flexDirection: "column",
        borderRadius: R.container,
        overflow: "hidden",
        background: CHROME,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.18), 0 40px 80px -24px rgba(0,0,0,0.55)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", borderBottom: `1px solid ${CHROME_LINE}` }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <div key={c} style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: c }} />
        ))}
      </div>
      <div style={{ display: "flex", flexGrow: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 128, padding: "12px 8px", gap: 4, borderRight: `1px solid ${CHROME_LINE}` }}>
          {sidebar.map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                padding: "5px 8px",
                borderRadius: R.control,
                fontSize: 12,
                fontWeight: 500,
                color: item === TITLE ? "#1D1B19" : CHROME_TEXT,
                background: item === TITLE ? "#E9E8E5" : "transparent",
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <Note cover={cover} scale={0.86} coverHeight={92} />
      </div>
    </div>
  );
}

function IPhone({ cover }: { cover: string | null }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 1000,
        top: 236,
        width: 172,
        height: 352,
        display: "flex",
        padding: 7,
        borderRadius: 34,
        background: "#141414",
        boxShadow: "0 0 0 1.5px rgba(255,255,255,0.18), 0 36px 70px -18px rgba(0,0,0,0.65)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, borderRadius: 27, overflow: "hidden", background: PAPER, position: "relative" }}>
        <Note cover={cover} scale={0.62} coverHeight={96} />
        <div style={{ position: "absolute", left: 54, top: 8, width: 50, height: 15, borderRadius: 8, background: "#141414", display: "flex" }} />
      </div>
    </div>
  );
}

export default async function OpengraphImage() {
  const [data, irises, mark] = await Promise.all([fonts, irisesJpg, markPng]);
  const logoWidth = Math.round((40 * LOGO_WIDTH) / LOGO_HEIGHT);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#1E3A6B", fontFamily: data ? "Inter" : undefined }}>
        {irises ? <img src={irises} width={1200} height={630} alt="" style={{ position: "absolute", left: 0, top: 0 }} /> : null}
        {/* The hero's deep shade, heavier on the left where the title sits. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1200,
            height: 630,
            display: "flex",
            backgroundImage: `linear-gradient(90deg, rgba(${SHADE},0.9) 0%, rgba(${SHADE},0.78) 42%, rgba(${SHADE},0.35) 70%, rgba(${SHADE},0.2) 100%)`,
          }}
        />

        <MacWindow cover={irises} />
        <IPhone cover={irises} />

        <div style={{ position: "absolute", left: 72, top: 64, height: 502, width: 540, display: "flex", flexDirection: "column" }}>
          {/* The letterforms leave the mark's disc empty; the pre-rendered mark sits in it. */}
          <div style={{ position: "relative", display: "flex", width: logoWidth, height: 40 }}>
            <svg width={logoWidth} height="40" viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}>
              {LETTER_PATHS.map((d) => (
                <path key={d.slice(0, 16)} fill="#FFFFFF" d={d} />
              ))}
            </svg>
            {mark ? <img src={mark} width={40} height={40} alt="" style={{ position: "absolute", left: 0, top: 0 }} /> : null}
          </div>

          <div
            style={{
              marginTop: 54,
              display: "flex",
              flexWrap: "wrap",
              fontFamily: data ? "Spectral" : undefined,
              fontSize: 58,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: -0.9,
              color: "#FFFFFF",
            }}
          >
            Folevi is a digital workspace for notes, docs and tasks.
          </div>

          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 16, fontSize: 22, fontWeight: 500, color: "rgba(255,255,255,0.88)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 46,
                flexShrink: 0,
                whiteSpace: "nowrap",
                padding: "0 22px",
                borderRadius: R.control,
                background: "#FFFFFF",
                color: INK,
                fontWeight: 600,
                fontSize: 20,
              }}
            >
              Free to start
            </div>
            On the web, Mac, iPhone and iPad
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
              { name: "Spectral", data: data[2], style: "normal" as const, weight: 600 as const },
            ],
          }
        : {}),
    },
  );
}
