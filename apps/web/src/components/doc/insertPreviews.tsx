// Small schematic pictures for the Insert tool's tiles. Everything is drawn in the current text colour
// at low opacity (so it reads in light and dark), with the surface colour for paper and the app's
// accent for the one detail worth noticing.

export type PreviewKind =
  | "text"
  | "page"
  | "card"
  | "todo"
  | "table"
  | "image"
  | "unsplash"
  | "file"
  | "audio"
  | "h1"
  | "h2"
  | "h3"
  | "bulleted"
  | "numbered"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "formula"
  | "mermaid"
  | "flowchart"
  | "whiteboard"
  | "bookmark"
  | "date"
  | "gallery"
  | "kanban"
  | "pageBreak";

const PAPER = "var(--color-surface-raised)";
const ACCENT = "var(--color-accent)";
const C = "currentColor";

/** A rounded text line. */
const Bar = ({ x, y, w, h = 3, o = 0.22 }: { x: number; y: number; w: number; h?: number; o?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={C} fillOpacity={o} />
);

/** A sheet with a hairline edge. */
const Sheet = ({ x, y, w, h, r = 3 }: { x: number; y: number; w: number; h: number; r?: number }) => (
  <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={r} fill={PAPER} stroke={C} strokeOpacity={0.3} />
);

const line = { stroke: C, strokeOpacity: 0.35, strokeWidth: 1.2, strokeLinecap: "round" as const, fill: "none" };

function Picture({ kind }: { kind: PreviewKind }) {
  switch (kind) {
    case "text":
      return (
        <>
          <Bar x={4} y={7} w={40} />
          <Bar x={4} y={14} w={36} />
          <Bar x={4} y={21} w={40} />
          <Bar x={4} y={28} w={24} />
        </>
      );
    case "page":
      return (
        <>
          <path d="M14.5 3.5h14l7.5 7.5v20a2 2 0 0 1-2 2H14.5a2 2 0 0 1-2-2v-25.5a2 2 0 0 1 2-2z" fill={PAPER} stroke={C} strokeOpacity={0.3} />
          <path d="M28.5 3.5v5.5a2 2 0 0 0 2 2H36" fill="none" stroke={C} strokeOpacity={0.3} />
          <Bar x={16.5} y={12} w={9} o={0.55} />
          <Bar x={16.5} y={18} w={15} h={2.5} />
          <Bar x={16.5} y={23} w={15} h={2.5} />
          <Bar x={16.5} y={28} w={10} h={2.5} />
        </>
      );
    case "card":
      return (
        <>
          <Sheet x={4} y={6} w={40} h={24} r={4} />
          <rect x={9} y={11} width={9} height={9} rx={2.5} fill={ACCENT} fillOpacity={0.35} />
          <Bar x={22} y={12} w={16} o={0.55} />
          <Bar x={22} y={18} w={11} h={2.5} />
          <Bar x={9} y={24} w={26} h={2.5} o={0.14} />
        </>
      );
    case "todo":
      return (
        <>
          <rect x={5} y={7} width={9} height={9} rx={2.5} fill={ACCENT} />
          <path d="M7.5 11.6l2 2 3.2-4" fill="none" stroke={PAPER} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <Bar x={18} y={10} w={24} o={0.16} />
          <rect x={5.6} y={20.6} width={7.8} height={7.8} rx={2.2} fill="none" stroke={C} strokeOpacity={0.45} strokeWidth={1.2} />
          <Bar x={18} y={23} w={18} />
        </>
      );
    case "table":
      return (
        <>
          <rect x={4} y={5} width={40} height={26} rx={3} fill={PAPER} />
          <rect x={4} y={5} width={40} height={7} rx={3} fill={C} fillOpacity={0.1} />
          <rect x={4} y={9} width={40} height={3} fill={C} fillOpacity={0.1} />
          <path d="M4.5 12h39M4.5 18.5h39M4.5 25h39M17 5.5v25M30.5 5.5v25" stroke={C} strokeOpacity={0.2} fill="none" />
          <rect x={4.5} y={5.5} width={39} height={25} rx={3} fill="none" stroke={C} strokeOpacity={0.3} />
        </>
      );
    case "image":
      return (
        <>
          <rect x={4.5} y={4.5} width={39} height={27} rx={3} fill={C} fillOpacity={0.06} stroke={C} strokeOpacity={0.3} />
          <circle cx={34} cy={12} r={3.5} fill={ACCENT} fillOpacity={0.5} />
          <path d="M5 30.5 16 17l8 9 5-5 14.5 9.5z" fill={C} fillOpacity={0.28} />
        </>
      );
    case "unsplash":
      return (
        <>
          <rect x={4.5} y={4.5} width={33} height={23} rx={3} fill={C} fillOpacity={0.06} stroke={C} strokeOpacity={0.3} />
          <circle cx={29} cy={11} r={3} fill={ACCENT} fillOpacity={0.5} />
          <path d="M5 27 14 16l7 7 4-4 12.5 8z" fill={C} fillOpacity={0.28} />
          <circle cx={35} cy={25} r={5.5} fill={PAPER} stroke={C} strokeOpacity={0.7} strokeWidth={1.6} />
          <path d="M39 29l3.5 3.5" stroke={C} strokeOpacity={0.7} strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case "file":
      return (
        <>
          <Sheet x={4} y={8} w={40} h={20} r={4} />
          <path d="M10.5 12.5h5l3 3v7.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z" fill={ACCENT} fillOpacity={0.3} />
          <Bar x={23} y={13} w={15} o={0.5} />
          <Bar x={23} y={19} w={10} h={2.5} />
        </>
      );
    case "audio": {
      const heights = [6, 12, 18, 10, 14, 22, 12, 8, 16, 6];
      return (
        <>
          <circle cx={11} cy={18} r={6.5} fill={ACCENT} />
          <path d="M9.4 14.8v6.4l5-3.2z" fill={PAPER} />
          {heights.map((h, i) => (
            <rect key={i} x={21 + i * 2.4} y={18 - h / 2} width={1.4} height={h} rx={0.7} fill={C} fillOpacity={0.35} />
          ))}
        </>
      );
    }
    case "h1":
    case "h2":
    case "h3": {
      const n = Number(kind[1]);
      return (
        <>
          <text x={4} y={16} fontSize={11} fontWeight={700} fill={C} fillOpacity={0.75} fontFamily="var(--font-sans)">
            H{n}
          </text>
          <Bar x={21} y={13 - (6 - n)} w={23 - n * 2} h={7 - n} o={0.55} />
          <Bar x={4} y={23} w={40} h={2.5} />
          <Bar x={4} y={29} w={28} h={2.5} />
        </>
      );
    }
    case "bulleted":
      return (
        <>
          {[9, 18, 27].map((y, i) => (
            <g key={y}>
              <circle cx={7} cy={y} r={1.9} fill={C} fillOpacity={0.6} />
              <Bar x={12} y={y - 1.5} w={[30, 24, 28][i]!} />
            </g>
          ))}
        </>
      );
    case "numbered":
      return (
        <>
          {[9, 18, 27].map((y, i) => (
            <g key={y}>
              <text x={4} y={y + 2.6} fontSize={7.5} fontWeight={650} fill={C} fillOpacity={0.6} fontFamily="var(--font-sans)">
                {i + 1}
              </text>
              <Bar x={12} y={y - 1.5} w={[30, 24, 28][i]!} />
            </g>
          ))}
        </>
      );
    case "toggle":
      return (
        <>
          <path d="M5 8h7l-3.5 4.5z" fill={C} fillOpacity={0.6} />
          <Bar x={15} y={8.5} w={27} o={0.5} />
          <path d="M8.5 16v13" {...line} strokeOpacity={0.2} />
          <Bar x={15} y={17} w={24} h={2.5} />
          <Bar x={15} y={23} w={20} h={2.5} />
          <Bar x={15} y={29} w={14} h={2.5} o={0.14} />
        </>
      );
    case "quote":
      return (
        <>
          <rect x={6} y={7} width={2.5} height={22} rx={1.25} fill={ACCENT} fillOpacity={0.7} />
          <Bar x={13} y={9} w={30} />
          <Bar x={13} y={16} w={26} />
          <Bar x={13} y={23} w={28} />
        </>
      );
    case "callout":
      return (
        <>
          <rect x={4} y={6} width={40} height={24} rx={4} fill={C} fillOpacity={0.07} />
          <circle cx={11} cy={13} r={3.2} fill={ACCENT} fillOpacity={0.6} />
          <Bar x={17} y={11.5} w={22} o={0.35} />
          <Bar x={17} y={18} w={20} h={2.5} />
          <Bar x={17} y={23.5} w={13} h={2.5} />
        </>
      );
    case "code":
      return (
        <>
          <rect x={4} y={5} width={40} height={26} rx={4} fill={C} fillOpacity={0.08} />
          <Bar x={9} y={10} w={7} h={2.5} o={0.5} />
          <Bar x={18} y={10} w={14} h={2.5} />
          <Bar x={13} y={16} w={10} h={2.5} />
          <rect x={25} y={16} width={9} height={2.5} rx={1.25} fill={ACCENT} fillOpacity={0.45} />
          <Bar x={13} y={22} w={16} h={2.5} />
          <Bar x={9} y={26.5} w={4} h={2.5} o={0.5} />
        </>
      );
    case "formula":
      return (
        <>
          <text x={24} y={20} textAnchor="middle" fontSize={13} fontStyle="italic" fill={C} fillOpacity={0.75} fontFamily="var(--font-serif)">
            a²+b²
          </text>
          <path d="M10 26.5h28" {...line} strokeOpacity={0.25} />
        </>
      );
    case "mermaid":
      return (
        <>
          <Bar x={4} y={7} w={14} h={2.5} o={0.45} />
          <Bar x={7} y={13} w={12} h={2.5} />
          <Bar x={7} y={19} w={10} h={2.5} />
          <Bar x={7} y={25} w={12} h={2.5} />
          <rect x={28.5} y={3.5} width={13} height={6} rx={1.5} fill={PAPER} stroke={C} strokeOpacity={0.4} />
          <rect x={28.5} y={15} width={13} height={6} rx={1.5} fill={ACCENT} fillOpacity={0.2} stroke={ACCENT} strokeOpacity={0.6} />
          <rect x={28.5} y={26.5} width={13} height={6} rx={1.5} fill={PAPER} stroke={C} strokeOpacity={0.4} />
          <path d="M35 9.5V15M35 21v5.5" {...line} />
        </>
      );
    case "flowchart":
      return (
        <>
          <rect x={2.5} y={8.5} width={12} height={7} rx={3.5} fill={PAPER} stroke={C} strokeOpacity={0.45} />
          <path d="M24 6.5l5.5 5.5-5.5 5.5-5.5-5.5z" fill={ACCENT} fillOpacity={0.18} stroke={ACCENT} strokeOpacity={0.6} />
          <rect x={33.5} y={8.5} width={12} height={7} rx={1.5} fill={PAPER} stroke={C} strokeOpacity={0.45} />
          <rect x={18} y={25.5} width={12} height={7} rx={1.5} fill={PAPER} stroke={C} strokeOpacity={0.45} />
          <path d="M14.5 12h3.5M29.5 12h3.5M24 17.5v7.5" {...line} />
        </>
      );
    case "whiteboard":
      return (
        <>
          {[8, 16, 24, 32, 40].flatMap((x) =>
            [6, 14, 22, 30].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={0.7} fill={C} fillOpacity={0.28} />),
          )}
          <path d="M6 26c4-12 9-14 12-7s9 8 12-3 8-8 12-4" fill="none" stroke={ACCENT} strokeOpacity={0.8} strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case "bookmark":
      return (
        <>
          <Sheet x={3} y={7} w={42} h={22} />
          <rect x={31} y={10} width={11} height={16} rx={2} fill={C} fillOpacity={0.12} />
          <Bar x={7} y={11} w={20} o={0.5} />
          <Bar x={7} y={17} w={17} h={2.5} />
          <circle cx={8.5} cy={23.5} r={1.5} fill={ACCENT} fillOpacity={0.5} />
          <Bar x={12} y={22.5} w={10} h={2} o={0.18} />
        </>
      );
    case "date":
      return (
        <>
          <Sheet x={10} y={5} w={28} h={28} />
          <rect x={10} y={5} width={28} height={8} rx={3} fill={ACCENT} fillOpacity={0.55} />
          <rect x={10} y={10} width={28} height={3} fill={ACCENT} fillOpacity={0.55} />
          <path d="M16.5 3v4.5M31.5 3v4.5" {...line} strokeOpacity={0.55} strokeWidth={1.6} />
          <text x={24} y={28} textAnchor="middle" fontSize={11} fontWeight={700} fill={C} fillOpacity={0.7} fontFamily="var(--font-sans)">
            12
          </text>
        </>
      );
    case "gallery":
      return (
        <>
          {[
            [5, 4],
            [25, 4],
            [5, 19],
            [25, 19],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <Sheet x={x!} y={y!} w={18} h={13} r={2} />
              <rect x={x! + 2} y={y! + 2} width={14} height={5.5} rx={1} fill={C} fillOpacity={0.13} />
              <Bar x={x! + 2} y={y! + 9} w={9} h={2} o={0.25} />
            </g>
          ))}
        </>
      );
    case "kanban":
      return (
        <>
          {[
            [3, 2],
            [17, 3],
            [31, 1],
          ].map(([x, cards]) => (
            <g key={x}>
              <rect x={x!} y={4} width={14} height={28} rx={2.5} fill={C} fillOpacity={0.07} />
              {Array.from({ length: cards! }, (_, i) => (
                <rect key={i} x={x! + 2} y={7 + i * 7.5} width={10} height={5.5} rx={1.2} fill={PAPER} stroke={C} strokeOpacity={0.25} strokeWidth={0.8} />
              ))}
            </g>
          ))}
        </>
      );
    case "pageBreak":
      return (
        <>
          <path d="M8.5 3.5h31v8a3 3 0 0 1-3 3h-25a3 3 0 0 1-3-3z" fill={PAPER} stroke={C} strokeOpacity={0.35} />
          <path d="M11.5 21.5h25a3 3 0 0 1 3 3v8h-31v-8a3 3 0 0 1 3-3z" fill={PAPER} stroke={C} strokeOpacity={0.35} />
          <path d="M3 18h42" {...line} strokeOpacity={0.3} strokeDasharray="2 2.5" />
        </>
      );
  }
}

/** The picture for one Insert tile (decorative: the tile's label names it). */
export function InsertPreview({ kind }: { kind: PreviewKind }) {
  return (
    <svg viewBox="0 0 48 36" width={48} height={36} aria-hidden focusable="false" className="block text-ink">
      <Picture kind={kind} />
    </svg>
  );
}
