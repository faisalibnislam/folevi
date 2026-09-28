import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MARK_BAR, MARK_STEM } from "@/components/brand/FoleviMark";
import { ImageResponse } from "next/og";

export const alt = "Folevi — A quieter place for ideas that keep growing.";
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
          <svg width="46" height="46" viewBox="0 0 109 109">
            <rect x="0.5" y="0.5" width="108" height="108" rx="23.5" fill="#fff" stroke="#DFDFE2" />
            <path d={MARK_STEM} fill="#000" />
            <path d={MARK_BAR} fill="#000" />
          </svg>
        </Bubble>

        <div style={{ position: "absolute", left: 88, top: 84, display: "flex", flexDirection: "column", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="165" height="48" viewBox="0 0 375 109">
            <rect x="0.5" y="0.5" width="108" height="108" rx="23.5" fill="#fff" stroke="#DFDFE2" />
            <path d={MARK_STEM} fill="#000" />
            <path d={MARK_BAR} fill="#000" />
        <path fill={HEADING} d="M358.782 94.6401V36.1761H373.902V94.6401H358.782ZM357.976 23.3409C357.976 21.4145 358.513 19.6897 359.588 18.1665C360.036 17.4497 360.619 16.8225 361.336 16.2849C362.097 15.7473 362.881 15.3665 363.688 15.1425C364.539 14.8737 365.435 14.7393 366.376 14.7393C367.272 14.7393 368.145 14.8737 368.996 15.1425C369.848 15.3665 370.654 15.7473 371.416 16.2849C372.849 17.3601 373.835 18.7713 374.372 20.5185C374.641 21.4145 374.776 22.3553 374.776 23.3409C374.776 25.8049 373.992 27.8881 372.424 29.5905C370.856 31.2929 368.84 32.1441 366.376 32.1441C364.449 32.1441 362.792 31.5841 361.403 30.4641C360.686 29.9265 360.081 29.3217 359.588 28.6497C359.096 27.9329 358.692 27.0817 358.379 26.0961C358.11 25.2449 357.976 24.3265 357.976 23.3409Z" />
        <path fill={HEADING} d="M326.195 36.1758L330.966 66.2814C331.146 67.3118 331.302 68.4766 331.437 69.7758C331.616 71.0302 331.75 72.2622 331.84 73.4718C331.93 74.6366 332.019 75.8686 332.109 77.1678C332.198 78.4222 332.288 79.7214 332.378 81.0654C332.378 81.6926 332.378 82.2974 332.378 82.8798V84.5598H333.453C333.453 83.4846 333.475 82.275 333.52 80.931C333.61 79.587 333.722 78.3774 333.856 77.3022C333.946 76.3166 334.08 75.0622 334.259 73.539C334.438 72.0158 334.595 70.739 334.73 69.7086C334.819 69.1262 334.909 68.5438 334.998 67.9614C335.088 67.379 335.178 66.819 335.267 66.2814L339.971 36.1758H354.755L343.466 94.6398H322.365L311.075 36.1758H326.195Z" />
        <path fill={HEADING} d="M310.437 65.2063V70.1119H269.58C269.848 71.4559 270.274 72.7103 270.856 73.8751C271.484 74.9951 272.178 75.9583 272.94 76.7647C273.791 77.6607 274.687 78.3999 275.628 78.9823C276.568 79.5647 277.711 80.0127 279.055 80.3263C279.637 80.5055 280.242 80.6399 280.869 80.7295C281.541 80.8191 282.236 80.8639 282.952 80.8639C285.103 80.8639 287.074 80.5055 288.866 79.7887C290.658 79.0719 292.114 78.0639 293.234 76.7647C293.503 76.4511 293.749 76.1151 293.973 75.7567C294.197 75.3983 294.399 75.0399 294.578 74.6815H309.967C309.34 77.4591 308.421 79.8783 307.212 81.9391C306.002 83.9999 304.658 85.7247 303.18 87.1135C301.477 88.8159 299.551 90.2719 297.4 91.4815C295.295 92.6911 292.988 93.6319 290.479 94.3039C289.269 94.6175 288.015 94.8639 286.716 95.0431C285.416 95.2223 284.095 95.3119 282.751 95.3119C279.301 95.3119 276.165 94.8191 273.343 93.8335C270.565 92.8031 268.079 91.4367 265.884 89.7343C261.09 86.0607 257.797 81.1551 256.005 75.0175C255.109 71.9711 254.661 68.7007 254.661 65.2063C254.661 61.8463 255.132 58.6207 256.072 55.5295C257.013 52.4383 258.335 49.6831 260.037 47.2639C261.784 44.7999 263.823 42.6943 266.152 40.9471C268.527 39.1999 271.125 37.8559 273.948 36.9151C276.815 35.9743 279.794 35.5039 282.885 35.5039C285.887 35.5039 288.821 36.0191 291.688 37.0495C294.556 38.0351 297.087 39.4239 299.282 41.2159C301.567 43.0975 303.538 45.2479 305.196 47.6671C306.898 50.0863 308.197 52.8191 309.093 55.8655C309.989 58.8223 310.437 61.9359 310.437 65.2063ZM269.848 60.0319H295.586C294.869 57.6575 293.66 55.6191 291.957 53.9167C290.3 52.2591 288.351 51.0943 286.111 50.4223C285.528 50.2879 284.946 50.1759 284.364 50.0863C283.781 49.9967 283.176 49.9519 282.549 49.9519C280.264 49.9519 278.069 50.5567 275.964 51.7663C275.202 52.2143 274.396 52.8415 273.544 53.6479C272.738 54.4543 271.999 55.4623 271.327 56.6719C270.7 57.7919 270.207 58.9119 269.848 60.0319Z" />
        <path fill={HEADING} d="M249.608 94.64H234.488V14H249.608V94.64Z" />
        <path fill={HEADING} d="M199.901 95.3119C196.496 95.3119 193.315 94.7967 190.359 93.7663C187.402 92.6911 184.759 91.2575 182.429 89.4655C180.01 87.6735 177.882 85.5679 176.045 83.1487C174.253 80.7295 172.842 77.9071 171.811 74.6815C170.826 71.7247 170.333 68.5663 170.333 65.2063C170.333 61.9807 170.826 58.8671 171.811 55.8655C172.797 52.8639 174.186 50.1311 175.978 47.6671C177.859 45.1135 180.032 42.9407 182.496 41.1487C185.005 39.3567 187.671 37.9903 190.493 37.0495C191.971 36.5567 193.495 36.1759 195.063 35.9071C196.631 35.6383 198.243 35.5039 199.901 35.5039C203.082 35.5039 206.173 36.0191 209.175 37.0495C212.221 38.0799 214.954 39.4687 217.373 41.2159C219.747 43.0079 221.853 45.1583 223.69 47.6671C225.571 50.1311 227.005 52.8639 227.991 55.8655C228.439 57.3439 228.797 58.8671 229.066 60.4351C229.335 62.0031 229.469 63.5935 229.469 65.2063C229.469 67.8943 229.043 70.7839 228.192 73.8751C227.386 76.9663 225.907 80.0127 223.757 83.0143C221.965 85.5231 219.815 87.6959 217.306 89.5327C214.797 91.3695 212.109 92.7807 209.242 93.7663C207.763 94.2591 206.24 94.6399 204.672 94.9087C203.104 95.1775 201.514 95.3119 199.901 95.3119ZM199.968 80.8639C201.447 80.8639 202.925 80.6175 204.403 80.1247C205.927 79.6319 207.271 78.8927 208.435 77.9071C209.914 76.7423 211.056 75.4879 211.863 74.1439C212.714 72.7551 213.296 71.4783 213.61 70.3135C213.834 69.5519 214.013 68.7679 214.147 67.9615C214.282 67.1103 214.349 66.2591 214.349 65.4079C214.349 63.6607 214.103 62.0255 213.61 60.5023C213.117 58.9343 212.445 57.5007 211.594 56.2015C210.832 55.1263 209.869 54.0959 208.704 53.1103C207.539 52.0799 206.128 51.2735 204.471 50.6911C202.992 50.1983 201.491 49.9519 199.968 49.9519C196.743 49.9519 193.898 50.9151 191.434 52.8415C190.269 53.7375 189.216 54.8575 188.275 56.2015C187.335 57.5007 186.64 58.9119 186.192 60.4351C185.968 61.1967 185.789 62.0031 185.655 62.8543C185.52 63.7055 185.453 64.5567 185.453 65.4079C185.453 66.7967 185.655 68.2751 186.058 69.8431C186.461 71.4111 187.2 72.9791 188.275 74.5471C189.127 75.8015 190.135 76.8991 191.299 77.8399C192.464 78.7807 193.831 79.5199 195.399 80.0575C196.877 80.5951 198.4 80.8639 199.968 80.8639Z" />
        <path fill={HEADING} d="M134.032 14.6719H167.296V29.4559H149.824V46.7263H165.952V61.5103H149.824V94.6399H134.032V14.6719Z" />
      
            </svg>
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
            A quieter place for ideas that keep growing.
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
            Web, Mac and iOS
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
