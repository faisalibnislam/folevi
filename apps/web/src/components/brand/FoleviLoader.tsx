import { useId } from "react";

/**
 * Folevi's loading screen: the F written the way a hand writes it, down the stem, across the top, then the
 * middle bar, each in one brush stroke, with a nib in Foli AI's violet-to-coral riding the tip. The letter
 * settles with a small bounce, fades, and starts again for as long as loading takes.
 *
 * It's drawn with SVG's own animation (SMIL), not script, so it moves from the server's first paint, before
 * any JavaScript has loaded, and every part runs on one clock. (Browsers don't run CSS animations inside a
 * mask, where the brush strokes live.) With reduced motion it shows the finished F instead (globals.css).
 */

/** The F of the mark (packages/design-tokens/brand/source/favicon.svg), on the mark's 512-unit canvas. */
const F_PATH =
  "M340.693 101.605C346.183 99.1649 352.396 98.8284 357.106 102.557C366.189 109.747 378.216 123.222 385.593 132.218C388.899 136.25 390.65 141.298 390.914 146.506C392.366 175.071 392.886 181.05 359.65 192.879C353.568 195.048 345.3 198.687 339.153 201.164L248.08 237.879C236.601 242.521 165.863 266.139 180.172 287.728C203.823 289.572 278.655 227.755 278.329 281.246C278.182 303.448 278.264 327.191 278.036 349.471C277.237 352.437 275.573 356.698 273.176 358.343C258.647 368.295 180.526 414.431 170.075 413.849C166.667 401.504 167.49 379.362 167.526 366.172C167.723 312.918 166.944 259.51 167.952 206.284C168.123 197.253 171.886 179.825 179.917 175.079C198.928 163.841 220.504 155.067 240.694 146.061L340.693 101.605Z";

/** One loop, and the moments in it (fractions of the loop). */
const LOOP = "3.9s";
const SOLID = [0.559, 0.6231] as const; // the brushed F gives way to the solid letter
const SETTLE = [0.5718, 0.6295, 0.6872] as const; // the small bounce
const FADE = [0.8333, 0.9615] as const; // the letter lifts and fades before the next loop
const EASE = "0.65 0 0.35 1";

/**
 * The pen's three strokes, in writing order: wide brushes clipped to the F, so they paint the real letterform.
 * `from`/`to` are when each is drawn.
 */
const STROKES = [
  { d: "M 196 172 C 194 240, 192 320, 197 410", width: 64, from: 0.0641, to: 0.2231 },
  { d: "M 186 218 C 248 194, 310 168, 380 146", width: 104, from: 0.2538, to: 0.4282 },
  { d: "M 200 322 C 222 312, 244 300, 252 290 L 252 352", width: 76, from: 0.459, to: 0.5718 },
];

const times = (...t: number[]) => t.map((n) => +n.toFixed(4)).join(";");
const loop = { dur: LOOP, repeatCount: "indefinite" } as const;

export function FoleviLoader({ title, className }: { title: string; className?: string }) {
  const id = `folevi-loader-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const mask = `${id}-mask`;
  const nib = `${id}-nib`;
  const words = title.replace(/[….]+$/, "");
  return (
    <div className={`grid select-none justify-items-center gap-6 ${className ?? ""}`}>
      <svg className="folevi-loader" viewBox="150 90 260 340" width="104" height="136" aria-hidden>
        <defs>
          {/* Foli AI's gradient (components/ai/AiIcon.tsx), across the nib. */}
          <linearGradient id={nib} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#7C6FEF" />
            <stop offset="1" stopColor="#FF555E" />
          </linearGradient>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="600">
            <rect width="600" height="600" fill="#000" />
            {STROKES.map((s, i) => (
              <path key={i} d={s.d} pathLength={1} strokeDasharray="1" strokeDashoffset="1" fill="none" stroke="#fff" strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round">
                <animate attributeName="stroke-dashoffset" {...loop} values="1;1;0;0" keyTimes={times(0, s.from, s.to, 1)} calcMode="spline" keySplines={`0 0 1 1;${EASE};0 0 1 1`} />
              </path>
            ))}
          </mask>
        </defs>
        <g className="folevi-loader-motion" opacity="0">
          <animate attributeName="opacity" {...loop} values="0;1;1;0;0" keyTimes={times(0, 0.03, FADE[0], FADE[1], 1)} />
          <g>
            <animateTransform attributeName="transform" type="translate" {...loop} values="0 0;0 0;0 -10;0 -10" keyTimes={times(0, FADE[0], FADE[1], 1)} calcMode="spline" keySplines={`0 0 1 1;${EASE};0 0 1 1`} />
            <g transform="translate(280 260)">
              <g>
                <animateTransform attributeName="transform" type="scale" {...loop} values="1;1;1.045;1;1" keyTimes={times(0, ...SETTLE, 1)} calcMode="spline" keySplines={`0 0 1 1;0 0 0.58 1;0.42 0 0.58 1;0 0 1 1`} />
                <g transform="translate(-280 -260)">
                  <path className="folevi-loader-ghost" d={F_PATH} />
                  <path className="folevi-loader-ink" d={F_PATH} mask={`url(#${mask})`} />
                  <path className="folevi-loader-ink" d={F_PATH} opacity="0">
                    <animate attributeName="opacity" {...loop} values="0;0;1;1" keyTimes={times(0, ...SOLID, 1)} />
                  </path>
                </g>
              </g>
            </g>
          </g>
          {STROKES.map((s, i) => (
            // The nib, one per stroke: it rides that stroke's tip while it's drawn and lifts away between strokes.
            <circle key={i} r="13" fill={`url(#${nib})`} opacity="0">
              <animateMotion {...loop} path={s.d} keyPoints="0;0;1;1" keyTimes={times(0, s.from, s.to, 1)} calcMode="spline" keySplines={`0 0 1 1;${EASE};0 0 1 1`} />
              <animate attributeName="opacity" {...loop} values="0;0;1;1;0;0" keyTimes={times(0, s.from - 0.008, s.from, s.to - 0.008, s.to + 0.018, 1)} />
            </circle>
          ))}
        </g>
      </svg>
      <svg className="folevi-loader-still" viewBox="150 90 260 340" width="104" height="136" aria-hidden>
        <path className="folevi-loader-ink" d={F_PATH} />
      </svg>
      <p className="font-display text-title-3 leading-tight text-ink">
        {words}
        <span className="folevi-loader-dots" aria-hidden>
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
