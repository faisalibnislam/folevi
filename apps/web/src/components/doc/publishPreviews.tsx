// Small pictures of the publishing themes (lib/publishThemes.ts) for the Share dialog's picker. Drawn like
// the Insert tool's tiles (insertPreviews.tsx): the current text colour at low opacity for lines, the
// surface colour for paper, so they read in light and dark. Only Note shows colour: it keeps the note's own.
import type { PublishTheme } from "@/lib/publishThemes";

const PAPER = "var(--color-surface-raised)";
const ACCENT = "var(--doc-accent, var(--color-accent))";
const C = "currentColor";

const Bar = ({ x, y, w, h = 2.5, o = 0.24 }: { x: number; y: number; w: number; h?: number; o?: number }) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={C} fillOpacity={o} />;

function Picture({ theme }: { theme: PublishTheme }) {
  switch (theme) {
    case "article":
      // A narrow column of serif text under a cover.
      return (
        <>
          <rect x={14.5} y={3.5} width={35} height={37} rx={2.5} fill={PAPER} stroke={C} strokeOpacity={0.3} />
          <rect x={15} y={4} width={34} height={7} rx={2} fill={C} fillOpacity={0.1} />
          <text x={19} y={20} fontSize={7} fontFamily="var(--font-serif), serif" fill={C} fillOpacity={0.7}>
            Aa
          </text>
          <Bar x={19} y={24} w={26} h={2} />
          <Bar x={19} y={28} w={24} h={2} />
          <Bar x={19} y={32} w={26} h={2} />
          <Bar x={19} y={36} w={16} h={2} />
        </>
      );
    case "docs":
      // Contents on the left, a wide page beside them.
      return (
        <>
          <Bar x={3} y={8} w={11} h={2} o={0.4} />
          <Bar x={3} y={13} w={9} h={2} />
          <Bar x={5} y={17} w={8} h={2} />
          <Bar x={3} y={21} w={10} h={2} />
          <rect x={17.5} y={3.5} width={43} height={37} rx={2.5} fill={PAPER} stroke={C} strokeOpacity={0.3} />
          <Bar x={22} y={9} w={20} h={3.5} o={0.5} />
          <Bar x={22} y={16} w={34} />
          <Bar x={22} y={21} w={32} />
          <Bar x={22} y={27} w={14} h={3} o={0.4} />
          <Bar x={22} y={33} w={34} />
        </>
      );
    case "minimal":
      // Plain paper: no cover, no frame.
      return (
        <>
          <Bar x={14} y={9} w={22} h={3.5} o={0.5} />
          <Bar x={14} y={17} w={36} />
          <Bar x={14} y={22} w={34} />
          <Bar x={14} y={27} w={36} />
          <Bar x={14} y={32} w={20} />
        </>
      );
    default:
      // The note's own look: its cover and colours.
      return (
        <>
          <rect x={8.5} y={3.5} width={47} height={37} rx={2.5} fill={PAPER} stroke={C} strokeOpacity={0.3} />
          <rect x={9} y={4} width={46} height={10} rx={2} fill={ACCENT} fillOpacity={0.35} />
          <Bar x={13} y={18} w={22} h={3.5} o={0.5} />
          <Bar x={13} y={25} w={36} />
          <Bar x={13} y={30} w={33} />
          <Bar x={13} y={35} w={24} />
        </>
      );
  }
}

/** A theme's picture, 64 by 44. Decorative: the theme's name is beside it. */
export function PublishThemePreview({ theme, className = "" }: { theme: PublishTheme; className?: string }) {
  return (
    <svg viewBox="0 0 64 44" width={64} height={44} aria-hidden className={className}>
      <Picture theme={theme} />
    </svg>
  );
}
