import { RegMark, cx } from "./ui";

/**
 * Original abstract art for the hero: topographic contour rings (drawn procedurally at build time),
 * a set of ruled index lines and a few registration marks. Colours come from tokens via currentColor.
 */

type Peak = { cx: number; cy: number; rx: number; rings: number; step: number; seed: number };

function ringPath(p: Peak, r: number, i: number): string {
  const n = 72;
  const pts: Array<[number, number]> = [];
  const wobble = 0.05 + Math.min(i, 10) * 0.009;
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const w =
      1 +
      wobble * Math.sin(3 * t + p.seed + i * 0.35) +
      wobble * 0.62 * Math.sin(5 * t - p.seed * 1.7 + i * 0.22) +
      wobble * 0.35 * Math.sin(2 * t + p.seed * 0.4);
    pts.push([p.cx + r * p.rx * w * Math.cos(t), p.cy + r * w * Math.sin(t)]);
  }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const f = (v: number) => v.toFixed(1);
  const first = pts[0]!;
  const last = pts[n - 1]!;
  const start = mid(last, first);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let k = 0; k < n; k++) {
    const cur = pts[k]!;
    const next = pts[(k + 1) % n]!;
    const m = mid(cur, next);
    d += `Q${f(cur[0])} ${f(cur[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d}Z`;
}

const peaks: Peak[] = [
  { cx: 1060, cy: 250, rx: 1.45, rings: 13, step: 34, seed: 0.8 },
  { cx: 210, cy: 760, rx: 1.3, rings: 9, step: 38, seed: 2.3 },
];

const paths = peaks.flatMap((p) => Array.from({ length: p.rings }, (_, i) => ringPath(p, 26 + i * p.step, i)));

export function TopoArt({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="mk-rules absolute inset-0" />
      <svg className="mk-topo absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none">
        <g stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {paths.map((d, i) => (
            <path key={i} d={d} vectorEffect="non-scaling-stroke" strokeOpacity={i % 4 === 0 ? 1 : 0.62} />
          ))}
        </g>
        {/* A single index margin rule, like the ruled edge of a folio. */}
        <path d="M96 0V900" stroke="var(--color-accent)" strokeOpacity="0.22" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute left-[6%] top-[14%] hidden xl:block">
        <RegMark size={15} />
      </span>
      <span className="absolute right-[5%] top-[62%] hidden xl:block">
        <RegMark size={15} />
      </span>
      <span className="absolute bottom-[10%] left-[44%] hidden xl:block">
        <RegMark size={13} />
      </span>
    </div>
  );
}
