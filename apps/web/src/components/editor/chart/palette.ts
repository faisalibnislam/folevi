// The chart's colours. Series take them in this order (never cycled: a ninth series is grey), each with a
// light and a dark shade chosen for the chart's own surface in that theme and checked as a set (lightness
// band, chroma floor, colour-blind separation of neighbours, contrast; the dataviz validator). Every shade
// reaches 3:1 against the surfaces it's drawn on in its theme (the page, raised panels and the card's own
// tint; test/chart-contrast.test.ts), so the light yellow is a gold and the light orange a burnt orange that
// stays apart from it. Every chart also has its data as a table. Text never wears a series colour; labels
// inside a filled shape use `on`, ink or white by the fill.
//
// chart.css holds the same values as CSS variables (--chart-blue…, --chart-on-blue…) so the drawing follows
// the app's theme; exports (svg.ts) use the light shades.
import { CHART_COLORS, type ChartColor } from "@folevi/editor-schema";

export const PALETTE: Record<ChartColor, { light: string; dark: string; onLight: string; onDark: string }> = {
  blue: { light: "#2a78d6", dark: "#3987e5", onLight: "#ffffff", onDark: "#18181b" },
  orange: { light: "#c54500", dark: "#d95926", onLight: "#ffffff", onDark: "#18181b" },
  teal: { light: "#1a9e84", dark: "#199e70", onLight: "#18181b", onDark: "#18181b" },
  yellow: { light: "#c18308", dark: "#c98500", onLight: "#18181b", onDark: "#18181b" },
  pink: { light: "#d07295", dark: "#d55181", onLight: "#18181b", onDark: "#18181b" },
  green: { light: "#008300", dark: "#0a8a0a", onLight: "#ffffff", onDark: "#ffffff" },
  violet: { light: "#6250d6", dark: "#9085e9", onLight: "#ffffff", onDark: "#18181b" },
  red: { light: "#e34948", dark: "#e66767", onLight: "#18181b", onDark: "#18181b" },
  gray: { light: "#8b8b93", dark: "#77777f", onLight: "#18181b", onDark: "#ffffff" },
};

/** The colours series take, in order (grey is kept for "Other" and anything past the eighth). */
export const SERIES_ORDER = CHART_COLORS.filter((c) => c !== "gray");

export const COLOR_NAME: Record<ChartColor, string> = {
  blue: "Blue",
  orange: "Orange",
  teal: "Teal",
  yellow: "Yellow",
  pink: "Pink",
  green: "Green",
  violet: "Violet",
  red: "Red",
  gray: "Gray",
};

/** A series' colour: the one chosen for its name, else the next in order (grey after the eighth). */
export function seriesColor(name: string, index: number, chosen: Record<string, ChartColor>): ChartColor {
  return chosen[name] ?? SERIES_ORDER[index] ?? "gray";
}

/** The chart's ink in light mode, for exports: text, secondary text, gridlines, the axis and the surface. */
export const LIGHT_INK = {
  ink: "#18181b",
  heading: "#0b0b0c",
  muted: "#56565e",
  faint: "#67676f",
  grid: "#ececef",
  axis: "#c9c9cf",
  surface: "#ffffff",
  raised: "#ffffff",
  line: "#dedee3",
} as const;

export type InkName = keyof typeof LIGHT_INK;

/**
 * A paint in a drawing: a series colour ("c:blue"), text on it ("on:blue"), or one of the chart's inks
 * ("ink", "muted", "grid"…). Resolved to CSS variables on screen and to light colours in exports.
 */
export type Paint = `c:${ChartColor}` | `on:${ChartColor}` | InkName | "none";

const INK_VAR: Record<InkName, string> = {
  ink: "var(--color-ink)",
  heading: "var(--color-heading)",
  muted: "var(--color-ink-muted)",
  faint: "var(--color-ink-faint)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  surface: "var(--chart-surface)",
  raised: "var(--chart-raised)",
  line: "var(--chart-line)",
};

/** A paint as CSS (screen). */
export function paintCss(p: Paint): string {
  if (p === "none") return "none";
  if (p.startsWith("c:")) return `var(--chart-${p.slice(2)})`;
  if (p.startsWith("on:")) return `var(--chart-on-${p.slice(3)})`;
  return INK_VAR[p as InkName];
}

/** A paint as a light colour (exports). */
export function paintHex(p: Paint): string {
  if (p === "none") return "none";
  if (p.startsWith("c:")) return PALETTE[p.slice(2) as ChartColor].light;
  if (p.startsWith("on:")) return PALETTE[p.slice(3) as ChartColor].onLight;
  return LIGHT_INK[p as InkName];
}
