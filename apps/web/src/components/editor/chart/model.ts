// What a chart's table means for each kind of chart: categories and series (bar, line, area), points
// (scatter, bubble), slices (pie, donut), people (org chart) and sets (Venn). Pure: the drawing (draw.ts),
// the editor and the tests read the same model.
import { chartCellText, chartNumber, type ChartCell, type ChartColor, type ChartData } from "@folevi/editor-schema";
import { columnUnit, type Unit } from "./format";
import { seriesColor } from "./palette";

export interface Series {
  name: string;
  color: ChartColor;
  values: (number | null)[];
  unit: Unit;
  /** The series' column in the chart's table. */
  col: number;
}

export interface CategoryModel {
  labels: string[];
  series: Series[];
  /** Each category's row in the table (after sorting). */
  rows: number[];
}

const label = (c: ChartCell | undefined, i: number) => chartCellText(c ?? null).trim() || `Row ${i + 1}`;
const isNumericColumn = (chart: ChartData, col: number) => chart.rows.some((r) => chartNumber(r[col]) !== null);

/** The columns after the first that hold numbers: the chart's series. */
export function numericColumns(chart: ChartData): number[] {
  return chart.columns.map((_, i) => i).filter((i) => i > 0 && isNumericColumn(chart, i));
}

/** Row order after the chart's sort: by the first series (high to low, or low to high) or by label. */
export function sortedRows(chart: ChartData, firstSeries: number | undefined): number[] {
  const order = chart.rows.map((_, i) => i);
  if (chart.sort === "label") {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return order.sort((a, b) => collator.compare(label(chart.rows[a]![0], a), label(chart.rows[b]![0], b)));
  }
  if ((chart.sort === "asc" || chart.sort === "desc") && firstSeries !== undefined) {
    const v = (i: number) => chartNumber(chart.rows[i]![firstSeries]);
    const dir = chart.sort === "asc" ? 1 : -1;
    return order.sort((a, b) => {
      const x = v(a);
      const y = v(b);
      if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
      return (x - y) * dir;
    });
  }
  return order;
}

/** Bar, stacked bar, line and area charts: a category per row, a series per number column. */
export function categoryModel(chart: ChartData): CategoryModel {
  const cols = numericColumns(chart);
  const rows = sortedRows(chart, cols[0]);
  const series = cols.map((col, i) => ({
    name: chart.columns[col]!.trim() || `Series ${i + 1}`,
    color: seriesColor(chart.columns[col]!.trim() || `Series ${i + 1}`, i, chart.colors),
    values: rows.map((r) => chartNumber(chart.rows[r]![col])),
    unit: columnUnit(chart.rows.map((r) => r[col] ?? null)),
    col,
  }));
  return { labels: rows.map((r) => label(chart.rows[r]![0], r)), series, rows };
}

export interface Point {
  x: number;
  y: number;
  size: number | null;
  label: string;
  row: number;
}

export interface PointSeries {
  name: string;
  color: ChartColor;
  points: Point[];
}

export interface PointModel {
  series: PointSeries[];
  xName: string;
  yName: string;
  sizeName: string;
  xUnit: Unit;
  yUnit: Unit;
  sizeUnit: Unit;
}

/**
 * Scatter and bubble charts. With text in the first column each row is a labelled point: [label, x, y,
 * size]. With numbers there, it's the x of every other column's points (one series each; a bubble chart's
 * third column is the size).
 */
export function pointModel(chart: ChartData): PointModel {
  const bubble = chart.kind === "bubble";
  const labelled = chart.rows.length > 0 && chart.rows.some((r) => r[0] !== null && chartNumber(r[0]) === null);
  const cols = numericColumns(chart);
  const unit = (col: number | undefined) => (col === undefined ? columnUnit([]) : columnUnit(chart.rows.map((r) => r[col] ?? null)));
  if (labelled) {
    const [xc, yc, sc] = cols;
    const points: Point[] = [];
    if (xc !== undefined && yc !== undefined) {
      chart.rows.forEach((r, i) => {
        const x = chartNumber(r[xc]);
        const y = chartNumber(r[yc]);
        if (x !== null && y !== null) points.push({ x, y, size: bubble && sc !== undefined ? chartNumber(r[sc]) : null, label: label(r[0], i), row: i });
      });
    }
    const name = chart.columns[yc ?? 1] ?? "Values";
    return {
      series: [{ name, color: seriesColor(name, 0, chart.colors), points }],
      xName: chart.columns[xc ?? 1] ?? "",
      yName: chart.columns[yc ?? 2] ?? "",
      sizeName: bubble && sc !== undefined ? chart.columns[sc]! : "",
      xUnit: unit(xc),
      yUnit: unit(yc),
      sizeUnit: unit(sc),
    };
  }
  const ys = bubble ? cols.slice(0, 1) : cols;
  const sc = bubble ? cols[1] : undefined;
  const series = ys.map((col, i) => {
    const name = chart.columns[col]!.trim() || `Series ${i + 1}`;
    const points: Point[] = [];
    chart.rows.forEach((r, row) => {
      const x = chartNumber(r[0]);
      const y = chartNumber(r[col]);
      if (x !== null && y !== null) points.push({ x, y, size: sc !== undefined ? chartNumber(r[sc]) : null, label: chartCellText(r[0] ?? null), row });
    });
    return { name, color: seriesColor(name, i, chart.colors), points };
  });
  return { series, xName: chart.columns[0] ?? "", yName: ys.length === 1 ? chart.columns[ys[0]!]! : "", sizeName: sc !== undefined ? chart.columns[sc]! : "", xUnit: columnUnit(chart.rows.map((r) => r[0] ?? null)), yUnit: unit(ys[0]), sizeUnit: unit(sc) };
}

export interface Slice {
  label: string;
  value: number;
  color: ChartColor;
  /** Its row in the table (-1 for "Other"). */
  row: number;
}

/** Most slices a pie shows; the smallest of the rest fold into "Other". */
export const MAX_SLICES = 7;

/** Pie and donut charts: a slice per row with a value above zero in the first number column. */
export function sliceModel(chart: ChartData): { slices: Slice[]; total: number; unit: Unit; name: string } {
  const col = numericColumns(chart)[0];
  if (col === undefined) return { slices: [], total: 0, unit: columnUnit([]), name: "" };
  const rows = sortedRows(chart, col);
  let raw = rows.map((r) => ({ label: label(chart.rows[r]![0], r), value: chartNumber(chart.rows[r]![col]) ?? 0, row: r })).filter((s) => s.value > 0);
  let other: Slice | null = null;
  if (raw.length > MAX_SLICES) {
    const keep = new Set([...raw].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES - 1).map((s) => s.row));
    const rest = raw.filter((s) => !keep.has(s.row));
    raw = raw.filter((s) => keep.has(s.row));
    other = { label: `Other (${rest.length})`, value: rest.reduce((n, s) => n + s.value, 0), row: -1, color: "gray" };
  }
  // Colours in the order the slices are shown (after folding), so they never repeat.
  const slices: Slice[] = [...raw.map((s, i) => ({ ...s, color: seriesColor(s.label, i, chart.colors) })), ...(other ? [other] : [])];
  return { slices, total: slices.reduce((n, s) => n + s.value, 0), unit: columnUnit(chart.rows.map((r) => r[col] ?? null)), name: chart.columns[col] ?? "" };
}

export interface OrgPerson {
  name: string;
  role: string;
  manager: string;
  children: number[];
  /** Colour of the branch (the person's top-level team), or the one chosen for their name. */
  color: ChartColor;
  row: number;
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * Org charts: a person per row ([name, reports to, role]). Everyone whose manager isn't in the list (or who
 * would report to themselves through a loop) is at the top. Each top-level person's team has its own colour.
 */
export function orgModel(chart: ChartData): { people: OrgPerson[]; roots: number[] } {
  const people: OrgPerson[] = [];
  const byName = new Map<string, number>();
  chart.rows.forEach((r, row) => {
    const name = chartCellText(r[0] ?? null).trim();
    if (!name || byName.has(key(name))) return;
    byName.set(key(name), people.length);
    people.push({ name, manager: chartCellText(r[1] ?? null).trim(), role: chartCellText(r[2] ?? null).trim(), children: [], color: "gray", row });
  });
  const parent = people.map((p) => byName.get(key(p.manager)) ?? -1);
  // A manager chain that comes back round puts the person who closes the loop at the top.
  for (let i = 0; i < people.length; i++) {
    const seen = new Set([i]);
    for (let at = parent[i]!; at >= 0; at = parent[at]!) {
      if (seen.has(at)) {
        parent[i] = -1;
        break;
      }
      seen.add(at);
    }
  }
  const roots: number[] = [];
  people.forEach((p, i) => (parent[i]! >= 0 ? people[parent[i]!]!.children.push(i) : roots.push(i)));
  // One root: its direct reports' teams take the colours; several: each root's tree does.
  const heads = roots.length === 1 ? people[roots[0]!]!.children : roots;
  const paint = (i: number, color: ChartColor) => {
    const p = people[i]!;
    p.color = chart.colors[p.name] ?? color;
    for (const c of p.children) paint(c, p.color);
  };
  if (roots.length === 1) people[roots[0]!]!.color = chart.colors[people[roots[0]!]!.name] ?? "gray";
  heads.forEach((h, i) => paint(h, seriesColor(people[h]!.name, i, chart.colors)));
  return { people, roots };
}

export interface VennSet {
  name: string;
  size: number;
  color: ChartColor;
}

export interface VennModel {
  sets: VennSet[];
  /** Sizes of the overlaps, by the sets' indices sorted ("0,1", "0,1,2"). */
  overlaps: Map<string, number>;
  unit: Unit;
  /** Sizes given (otherwise the circles are drawn equal). */
  sized: boolean;
}

/** An overlap's name split into its sets: "A & B", "A ∩ B". */
export const overlapParts = (name: string) => name.split(/\s*[&∩]\s*/).map((s) => s.trim()).filter(Boolean);

/** Venn diagrams: rows of sets ([name, size]) and overlaps ("A & B"). Two or three sets. */
export function vennModel(chart: ChartData): VennModel {
  const col = numericColumns(chart)[0] ?? 1;
  const sets: VennSet[] = [];
  const pending: { parts: string[]; size: number | null }[] = [];
  chart.rows.forEach((r) => {
    const name = chartCellText(r[0] ?? null).trim();
    if (!name) return;
    const parts = overlapParts(name);
    const size = chartNumber(r[col]);
    if (parts.length >= 2) pending.push({ parts, size });
    else if (sets.length < 3 && !sets.some((s) => key(s.name) === key(name))) sets.push({ name, size: size ?? NaN, color: "gray" });
  });
  // Sets named only in an overlap still get a circle.
  for (const p of pending) for (const part of p.parts) if (sets.length < 3 && !sets.some((s) => key(s.name) === key(part))) sets.push({ name: part, size: NaN, color: "gray" });
  const sized = sets.length > 0 && sets.every((s) => Number.isFinite(s.size) && s.size > 0);
  sets.forEach((s, i) => {
    s.color = seriesColor(s.name, i, chart.colors);
    if (!sized) s.size = 10;
  });
  const overlaps = new Map<string, number>();
  for (const p of pending) {
    const idx = [...new Set(p.parts.map((part) => sets.findIndex((s) => key(s.name) === key(part))))].sort();
    if (idx.length < 2 || idx.some((i) => i < 0) || p.size === null) continue;
    overlaps.set(idx.join(","), p.size);
  }
  return { sets, overlaps, unit: columnUnit(chart.rows.map((r) => r[col] ?? null)), sized };
}

/** What can be given a colour in this chart, with the colour each has now: series, slices, sets or teams. */
export function colorTargets(chart: ChartData): { name: string; color: ChartColor }[] {
  switch (chart.kind) {
    case "pie":
    case "donut":
      return sliceModel(chart).slices.filter((s) => s.row >= 0).map((s) => ({ name: s.label, color: s.color }));
    case "venn":
      return vennModel(chart).sets.map((s) => ({ name: s.name, color: s.color }));
    case "org": {
      const { people, roots } = orgModel(chart);
      const heads = roots.length === 1 ? people[roots[0]!]!.children : roots;
      return heads.map((i) => ({ name: people[i]!.name, color: people[i]!.color }));
    }
    case "scatter":
    case "bubble":
      return pointModel(chart).series.map((s) => ({ name: s.name, color: s.color }));
    default:
      return categoryModel(chart).series.map((s) => ({ name: s.name, color: s.color }));
  }
}
