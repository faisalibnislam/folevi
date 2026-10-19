// Draws a chart as a scene (scene.ts) at a given size: every kind, to scale, with its axes, gridlines,
// legend, value labels and the regions that show tooltips. Pure and without a browser, so the editor, share
// pages (on the server) and exports all draw the same picture.
//
// The marks follow the dataviz rules: bars at most 24 px thick with a 4 px rounded data end and a square
// baseline, 2 px gaps in the surface colour between touching marks, 2 px lines, 8 px dots with a surface
// ring, area washes at about 12%, hairline gridlines, text in the chart's inks (never a series colour),
// a legend for two series or more, and value labels only when asked or where they fit.
import { CHART_KIND_LABEL, chartNumber, type ChartData, type ChartKind } from "@folevi/editor-schema";
import { fitText, formatCompact, formatValue, niceTicks, PLAIN, textWidth, wrapText, type Unit } from "./format";
import { categoryModel, orgModel, pointModel, sliceModel, vennModel, type CategoryModel } from "./model";
import type { Paint } from "./palette";
import type { ChartColor } from "@folevi/editor-schema";
import { linePath, round, roundedRect, slicePath, type Hit, type Mark, type Scene, type Tip } from "./scene";

export interface DrawOptions {
  width: number;
  height: number;
  /** Draw the title above and the takeaway below (exports; on screen they're the block's own text). */
  titled?: boolean;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LegendItem {
  label: string;
  color: ChartColor;
  key: "rect" | "line" | "dot";
}

const TICK = 11;
const LABEL = 11.5;
const BAR_MAX = 24;
const GAP = 2;
const c = (color: ChartColor): Paint => `c:${color}`;
/** About one tick per `per` pixels of axis, between 2 and 8. */
const tickCount = (length: number, per: number) => Math.max(2, Math.min(8, Math.floor(length / per)));

/** Draws `chart` at the given size. */
export function drawChart(chart: ChartData, opts: DrawOptions): Scene {
  const width = Math.max(120, Math.round(opts.width));
  const height = Math.max(100, Math.round(opts.height));
  const marks: Mark[] = [];
  const hits: Hit[] = [];
  const pad = width < 420 ? 8 : 12;
  const box: Box = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };
  if (opts.titled) titleAndTakeaway(chart, box, marks);
  const kindName = CHART_KIND_LABEL[chart.kind];
  const out = (summary: string, empty = false, size?: { w: number; h: number }): Scene => ({
    width: size?.w ?? width,
    height: size?.h ?? height,
    viewBox: [0, 0, size?.w ?? width, size?.h ?? height],
    marks,
    hits,
    summary: `${kindName}${chart.title ? `: ${chart.title}` : ""}. ${summary}`,
    empty,
  });
  if (!chart.columns.length || !chart.rows.length) return out("No data yet.", true);
  switch (chart.kind) {
    case "bar":
    case "stackedBar":
    case "line":
    case "area": {
      const model = categoryModel(chart);
      if (!model.series.length) return out("No numbers to draw yet: add a column of numbers.", true);
      const legendKey = chart.kind === "line" ? "line" : "rect";
      placeLegend(chart, box, marks, model.series.map((s) => ({ label: s.name, color: s.color, key: legendKey })), width);
      return out(drawCategories(chart, model, box, marks, hits));
    }
    case "scatter":
    case "bubble": {
      const model = pointModel(chart);
      if (!model.series.some((s) => s.points.length)) return out(chart.kind === "bubble" ? "No points yet: add columns for x, y and size." : "No points yet: add columns of numbers for x and y.", true);
      placeLegend(chart, box, marks, model.series.map((s) => ({ label: s.name, color: s.color, key: "dot" })), width);
      return out(drawPoints(chart, model, box, marks, hits));
    }
    case "pie":
    case "donut": {
      const model = sliceModel(chart);
      if (!model.slices.length) return out("No slices yet: add a column of numbers above zero.", true);
      placeLegend(chart, box, marks, model.slices.map((s) => ({ label: s.label, color: s.color, key: "rect" })), width, model.slices.length >= 2);
      return out(drawSlices(chart, model, box, marks, hits));
    }
    case "org": {
      const model = orgModel(chart);
      const managers = chart.rows.map((r) => r[1]).filter((v) => v !== null && v !== undefined && v !== "");
      if (!model.people.length || (managers.length && managers.every((v) => chartNumber(v ?? null) !== null))) return out("An org chart reads each row as a person: their name, who they report to and their role.", true);
      const r = drawOrg(model, box, marks, hits, width, height);
      return out(r.summary, false, r.size);
    }
    case "venn": {
      const model = vennModel(chart);
      if (model.sets.length < 2 || (!model.overlaps.size && chart.rows.length > 3)) return out("A Venn diagram reads two or three sets with their sizes, and overlaps named like “A & B”.", true);
      return out(drawVenn(model, box, marks, hits));
    }
  }
}

// ---------------------------------------------------------------- frame: title, takeaway and the legend

function titleAndTakeaway(chart: ChartData, box: Box, marks: Mark[]) {
  if (chart.title) {
    marks.push({ t: "text", x: box.x, y: box.y + 16, text: fitText(chart.title, 16, box.w, true), size: 16, weight: 600, fill: "heading" });
    box.y += 30;
    box.h -= 30;
  }
  const lines = chart.takeaway ? chart.takeaway.split(/\n+/).flatMap((l) => wrapText(l.trim(), 13, box.w, 2)).slice(0, 4) : [];
  if (lines.length) {
    const h = lines.length * 18 + 10;
    lines.forEach((l, i) => marks.push({ t: "text", x: box.x, y: box.y + box.h - h + 22 + i * 18, text: l, size: 13, fill: "muted" }));
    box.h -= h;
  }
}

/** Shows the legend where the chart asks (auto: on top, for two series or more) and takes its room from the box. */
function placeLegend(chart: ChartData, box: Box, marks: Mark[], items: LegendItem[], width: number, auto = items.length >= 2) {
  const where = chart.legend === "auto" ? (auto ? "top" : "none") : chart.legend;
  if (where === "none" || !items.length) return;
  const size = 12;
  const itemW = (it: LegendItem) => 16 + textWidth(it.label, size);
  if (where === "right" && width >= 420) {
    const w = Math.min(box.w * 0.32, Math.max(...items.map(itemW)) + 4);
    const rows = Math.max(1, Math.floor(box.h / 20));
    items.slice(0, rows).forEach((it, i) => {
      const x = box.x + box.w - w;
      const y = box.y + 8 + i * 20;
      swatch(marks, it, x, y);
      marks.push({ t: "text", x: x + 16, y: y + 4, text: fitText(it.label, size, w - 16), size, fill: "muted" });
    });
    box.w -= w + 16;
    return;
  }
  // Rows of items, wrapped to the width.
  const lines: { it: LegendItem; x: number }[][] = [[]];
  let x = 0;
  for (const it of items) {
    const w = Math.min(itemW(it), box.w);
    if (x > 0 && x + w > box.w) {
      lines.push([]);
      x = 0;
    }
    lines[lines.length - 1]!.push({ it, x });
    x += w + 16;
  }
  const shown = lines.slice(0, 3);
  const h = shown.length * 20;
  const top = where === "bottom" ? box.y + box.h - h + 4 : box.y + 4;
  shown.forEach((line, row) =>
    line.forEach(({ it, x: lx }) => {
      const y = top + row * 20 + 6;
      swatch(marks, it, box.x + lx, y);
      marks.push({ t: "text", x: box.x + lx + 16, y: y + 4, text: fitText(it.label, size, box.w - lx - 16), size, fill: "muted" });
    }),
  );
  if (where === "bottom") box.h -= h + 10;
  else {
    box.y += h + 10;
    box.h -= h + 10;
  }
}

function swatch(marks: Mark[], it: LegendItem, x: number, y: number) {
  if (it.key === "line") marks.push({ t: "rect", x, y: y - 1, w: 11, h: 2.5, r: [1, 1, 1, 1], fill: c(it.color) });
  else if (it.key === "dot") marks.push({ t: "circle", cx: x + 5, cy: y, r: 4.5, fill: c(it.color) });
  else marks.push({ t: "rect", x, y: y - 5, w: 10, h: 10, r: [2, 2, 2, 2], fill: c(it.color) });
}

// ---------------------------------------------------------------- bar, stacked bar, line and area

/** One unit for a value axis when every series shares it (otherwise plain numbers). */
const sharedUnit = (units: Unit[]): Unit => (units.length && units.every((u) => u.prefix === units[0]!.prefix && u.suffix === units[0]!.suffix) ? units[0]! : PLAIN);

function valueDomain(chart: ChartData, values: number[], forceZero: boolean, count: number) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (forceZero || (lo >= 0 && lo <= hi / 2) || hi <= 0) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (chart.yMin !== null) lo = chart.yMin;
  if (chart.yMax !== null) hi = chart.yMax;
  if (lo > hi) [lo, hi] = [hi, lo];
  const nice = niceTicks(lo, hi, count);
  // A range set by hand is kept exactly; ticks inside it.
  const min = chart.yMin ?? nice.lo;
  const max = chart.yMax ?? nice.hi;
  return { lo: min, hi: max === min ? min + 1 : max, ticks: nice.ticks.filter((t) => t >= min - 1e-9 && t <= max + 1e-9) };
}

function drawCategories(chart: ChartData, model: CategoryModel, box: Box, marks: Mark[], hits: Hit[]): string {
  const kind = chart.kind;
  const stacked = kind === "stackedBar";
  const bars = kind === "bar" || stacked;
  const horizontal = bars && chart.horizontal;
  const { labels, series } = model;
  const n = labels.length;
  const unit = sharedUnit(series.map((s) => s.unit));
  // The values the axis must hold: every value, or each stack's top and bottom.
  const all: number[] = [];
  const totals = labels.map((_, i) => {
    let pos = 0;
    let neg = 0;
    for (const s of series) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      if (v >= 0) pos += v;
      else neg += v;
    }
    return { pos, neg };
  });
  if (stacked) totals.forEach((t) => all.push(t.pos, t.neg));
  else series.forEach((s) => s.values.forEach((v) => v !== null && all.push(v)));
  if (!all.length) return "No numbers yet.";
  const valueLabels = chart.values;
  const yTitle = horizontal ? chart.xLabel : chart.yLabel;
  const xTitle = horizontal ? chart.yLabel : chart.xLabel;

  // Room for the axes: tick labels on the value axis, category labels on the other.
  const domain0 = valueDomain(chart, all, bars || kind === "area", horizontal ? tickCount(box.w, 100) : tickCount(box.h, 56));
  const { lo, hi, ticks } = domain0;
  const tickText = ticks.map((t) => formatCompact(t, unit));
  const titleRoom = (s: string) => (s ? 20 : 0);
  let plot: Box;
  if (horizontal) {
    const catW = Math.min(box.w * 0.34, Math.max(...labels.map((l) => textWidth(l, LABEL))) + 10);
    const left = box.x + titleRoom(yTitle) + catW;
    // Room after the longest bar for its value.
    const right = valueLabels ? Math.min(box.w * 0.25, Math.max(...series.flatMap((s) => s.values.map((v) => (v === null ? 0 : textWidth(formatValue(v, s.unit), TICK)))), stacked ? Math.max(...totals.map((t) => textWidth(formatValue(t.pos + t.neg, unit), TICK))) : 0) + 14) : 16;
    plot = { x: left, y: box.y + 4, w: Math.max(20, box.x + box.w - right - left), h: Math.max(20, box.h - 4 - 20 - titleRoom(xTitle)) };
  } else {
    const tickW = Math.max(...tickText.map((t) => textWidth(t, TICK))) + 10;
    const left = box.x + titleRoom(yTitle) + tickW;
    const top = box.y + (valueLabels || stacked ? 18 : 8);
    plot = { x: left, y: top, w: Math.max(20, box.x + box.w - 8 - left), h: Math.max(20, box.y + box.h - 20 - titleRoom(xTitle) - top) };
  }
  const span = hi - lo || 1;
  const clampV = (v: number) => Math.max(lo, Math.min(hi, v));
  // Position along the value axis (y going up, or x going right).
  const at = (v: number) => (horizontal ? plot.x + ((clampV(v) - lo) / span) * plot.w : plot.y + plot.h - ((clampV(v) - lo) / span) * plot.h);
  const base = at(lo <= 0 && hi >= 0 ? 0 : lo);

  // Gridlines and value ticks.
  ticks.forEach((t, i) => {
    const p = round(at(t));
    if (horizontal) {
      marks.push({ t: "line", x1: p, y1: plot.y, x2: p, y2: plot.y + plot.h, stroke: "grid", sw: 1 });
      marks.push({ t: "text", x: p, y: plot.y + plot.h + 15, text: tickText[i]!, size: TICK, fill: "faint", anchor: "middle", tabular: true });
    } else {
      marks.push({ t: "line", x1: plot.x, y1: p, x2: plot.x + plot.w, y2: p, stroke: "grid", sw: 1 });
      marks.push({ t: "text", x: plot.x - 8, y: p + 3.5, text: tickText[i]!, size: TICK, fill: "faint", anchor: "end", tabular: true });
    }
  });
  // The baseline.
  if (horizontal) marks.push({ t: "line", x1: round(base), y1: plot.y, x2: round(base), y2: plot.y + plot.h, stroke: "axis", sw: 1 });
  else marks.push({ t: "line", x1: plot.x, y1: round(base), x2: plot.x + plot.w, y2: round(base), stroke: "axis", sw: 1 });

  // Category labels, thinned and shortened to fit their bands.
  const band = (horizontal ? plot.h : plot.w) / n;
  const center = (i: number) => (horizontal ? plot.y + band * (i + 0.5) : plot.x + band * (i + 0.5));
  if (horizontal) {
    const every = Math.max(1, Math.ceil(16 / band));
    const catW = plot.x - box.x - titleRoom(yTitle) - 10;
    labels.forEach((l, i) => {
      if (i % every) return;
      marks.push({ t: "text", x: plot.x - 10, y: center(i) + 4, text: fitText(l, LABEL, catW), size: LABEL, fill: "muted", anchor: "end", g: i });
    });
  } else {
    const widest = Math.max(...labels.map((l) => textWidth(l, LABEL)));
    const every = Math.max(1, Math.ceil(Math.min(widest + 10, 120) / band));
    labels.forEach((l, i) => {
      if (i % every) return;
      marks.push({ t: "text", x: center(i), y: plot.y + plot.h + 15, text: fitText(l, LABEL, band * every - 6), size: LABEL, fill: "muted", anchor: "middle", g: i });
    });
  }
  // Axis titles.
  if (yTitle) {
    if (horizontal) marks.push({ t: "text", x: box.x + 12, y: plot.y + plot.h / 2, text: fitText(yTitle, 12, plot.h), size: 12, weight: 600, fill: "muted", anchor: "middle", rotate: -90 });
    else marks.push({ t: "text", x: box.x + 12, y: plot.y + plot.h / 2, text: fitText(yTitle, 12, plot.h), size: 12, weight: 600, fill: "muted", anchor: "middle", rotate: -90 });
  }
  if (xTitle) marks.push({ t: "text", x: plot.x + plot.w / 2, y: box.y + box.h - 3, text: fitText(xTitle, 12, plot.w), size: 12, weight: 600, fill: "muted", anchor: "middle" });

  const tip = (i: number): Tip => ({
    title: labels[i]!,
    rows: [
      ...series.map((s) => ({ label: s.name, value: s.values[i] === null || s.values[i] === undefined ? "No value" : formatValue(s.values[i]!, s.unit), paint: c(s.color), key: (kind === "line" ? "line" : "rect") as "line" | "rect" })),
      ...(stacked && series.length > 1 ? [{ label: "Total", value: formatValue(totals[i]!.pos + totals[i]!.neg, unit), paint: "none" as Paint, key: "rect" as const }] : []),
    ],
  });

  if (bars) {
    const m = stacked ? 1 : series.length;
    const thick = Math.max(2, Math.min(BAR_MAX, (band * 0.78 - (m - 1) * GAP) / m));
    const group = m * thick + (m - 1) * GAP;
    // A bar from value a to b (a nearer the baseline), rounded at its far end.
    const bar = (i: number, j: number, a: number, b: number, color: ChartColor, roundEnd: boolean, gapAtStart: boolean) => {
      const off = center(i) - group / 2 + j * (thick + GAP);
      let p0 = at(a);
      let p1 = at(b);
      const up = b >= a;
      if (gapAtStart) p0 += horizontal ? (up ? GAP : -GAP) : up ? -GAP : GAP;
      if (horizontal) {
        if (up && p1 - p0 < 1) p1 = p0 + 1;
        if (!up && p0 - p1 < 1) p1 = p0 - 1;
        const x = Math.min(p0, p1);
        const w = Math.abs(p1 - p0);
        const r: [number, number, number, number] = roundEnd ? (up ? [0, 4, 4, 0] : [4, 0, 0, 4]) : [0, 0, 0, 0];
        marks.push({ t: "path", d: roundedRect(x, off, w, thick, r), fill: c(color), g: i });
        return { x: x, y: off, w, h: thick, end: up ? x + w : x };
      }
      if (up && p0 - p1 < 1) p1 = p0 - 1;
      if (!up && p1 - p0 < 1) p1 = p0 + 1;
      const y = Math.min(p0, p1);
      const h = Math.abs(p1 - p0);
      const r: [number, number, number, number] = roundEnd ? (up ? [4, 4, 0, 0] : [0, 0, 4, 4]) : [0, 0, 0, 0];
      marks.push({ t: "path", d: roundedRect(off, y, thick, h, r), fill: c(color), g: i });
      return { x: off, y, w: thick, h, end: up ? y : y + h };
    };
    const valueText = (i: number, v: number, unit: Unit, x: number, y: number, room: number, below = false) => {
      const full = formatValue(v, unit);
      const text = textWidth(full, TICK) <= room ? full : formatCompact(v, unit);
      if (textWidth(text, TICK) > room && !horizontal) return;
      if (horizontal) marks.push({ t: "text", x: below ? x - 6 : x + 6, y: y + 4, text, size: TICK, fill: "muted", anchor: below ? "end" : "start", tabular: true, g: i });
      else marks.push({ t: "text", x, y: below ? y + 14 : y - 6, text, size: TICK, fill: "muted", anchor: "middle", tabular: true, g: i });
    };
    for (let i = 0; i < n; i++) {
      if (stacked) {
        let pos = 0;
        let neg = 0;
        const segs = series.map((s) => {
          const v = s.values[i];
          if (v === null || v === undefined || v === 0) return null;
          const from = v >= 0 ? pos : neg;
          const first = from === 0;
          if (v >= 0) pos += v;
          else neg += v;
          return { s, v, from, to: from + v, first };
        });
        const lastPos = segs.map((g, k) => (g && g.v > 0 ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
        const lastNeg = segs.map((g, k) => (g && g.v < 0 ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
        segs.forEach((g, k) => {
          if (!g) return;
          const r = bar(i, 0, g.from, g.to, g.s.color, k === lastPos || k === lastNeg, !g.first);
          // A segment's value inside it, only when it fits with room to spare.
          if (valueLabels) {
            const text = formatCompact(g.v, g.s.unit);
            const fits = horizontal ? textWidth(text, 10.5) + 8 <= r.w && r.h >= 14 : r.h >= 16 && textWidth(text, 10.5) + 4 <= r.w;
            if (fits) marks.push({ t: "text", x: r.x + r.w / 2, y: r.y + r.h / 2 + 3.5, text, size: 10.5, weight: 600, fill: `on:${g.s.color}`, anchor: "middle", tabular: true, g: i });
          }
        });
        if (valueLabels && (totals[i]!.pos || totals[i]!.neg)) {
          const total = totals[i]!.pos + totals[i]!.neg;
          const end = at(totals[i]!.pos ? totals[i]!.pos : totals[i]!.neg);
          if (horizontal) valueText(i, total, unit, end, center(i), total < 0 ? end - plot.x : box.x + box.w - end - 6, total < 0);
          else valueText(i, total, unit, center(i), end, band - 2, total < 0);
        }
      } else {
        series.forEach((s, j) => {
          const v = s.values[i];
          if (v === null || v === undefined) return;
          const r = bar(i, j, lo <= 0 && hi >= 0 ? 0 : lo, v, s.color, true, false);
          if (valueLabels) {
            if (horizontal) valueText(i, v, s.unit, r.end, r.y + r.h / 2 - 0.5, v < 0 ? r.end - plot.x : box.x + box.w - r.end - 6, v < 0);
            else valueText(i, v, s.unit, r.x + r.w / 2, r.end, m === 1 ? band - 2 : thick + GAP + 8, v < 0);
          }
        });
      }
      const top = Math.min(...series.map((s) => (s.values[i] === null || s.values[i] === undefined ? base : at(stacked ? totals[i]!.pos : s.values[i]!))));
      hits.push(
        horizontal
          ? { shape: "rect", x: plot.x, y: plot.y + band * i, w: plot.w, h: band, tip: tip(i), g: i, at: { x: Math.max(...series.map((s) => at(stacked ? totals[i]!.pos : (s.values[i] ?? 0)))), y: center(i) } }
          : { shape: "rect", x: plot.x + band * i, y: plot.y, w: band, h: plot.h, tip: tip(i), g: i, at: { x: center(i), y: top } },
      );
    }
  } else {
    // Line and area: a point per category at the middle of its band.
    const dots = n <= 24;
    series.forEach((s) => {
      const pts = s.values.map((v, i) => (v === null || v === undefined ? null : { x: center(i), y: at(v) }));
      if (kind === "area") {
        // The wash under each unbroken run of points.
        let run: { x: number; y: number }[] = [];
        const flush = () => {
          if (run.length >= 1) {
            const d = `${linePath(run)}L${round(run[run.length - 1]!.x)} ${round(base)}L${round(run[0]!.x)} ${round(base)}Z`;
            marks.push({ t: "path", d, fill: c(s.color), opacity: 0.12 });
          }
          run = [];
        };
        pts.forEach((p) => (p ? run.push(p) : flush()));
        flush();
      }
      marks.push({ t: "path", d: linePath(pts), fill: "none", stroke: c(s.color), sw: 2 });
      pts.forEach((p, i) => {
        if (!p) return;
        const lone = !pts[i - 1] && !pts[i + 1];
        if (dots || lone || i === n - 1) marks.push({ t: "circle", cx: p.x, cy: p.y, r: 4, fill: c(s.color), stroke: "surface", sw: 2, g: i });
      });
      if (valueLabels) {
        const every = n <= 12 ? 1 : n;
        pts.forEach((p, i) => {
          if (!p || (i % every && i !== n - 1)) return;
          marks.push({ t: "text", x: p.x, y: p.y - 9, text: formatCompact(s.values[i]!, s.unit), size: TICK, fill: "muted", anchor: "middle", tabular: true, g: i });
        });
      }
    });
    for (let i = 0; i < n; i++) {
      const ys = series.map((s) => s.values[i]).filter((v): v is number => v !== null && v !== undefined);
      hits.push({
        shape: "rect",
        x: plot.x + band * i,
        y: plot.y,
        w: band,
        h: plot.h,
        tip: tip(i),
        g: i,
        at: { x: center(i), y: ys.length ? at(Math.max(...ys)) : plot.y },
        crosshair: { x: center(i), y1: plot.y, y2: plot.y + plot.h, dots: series.flatMap((s) => (s.values[i] === null || s.values[i] === undefined ? [] : [{ y: at(s.values[i]!), paint: c(s.color) }])) },
      });
    }
  }
  return categorySummary(model, unit);
}

function categorySummary(model: CategoryModel, unit: Unit): string {
  const { labels, series } = model;
  let best: { v: number; s: string; l: string } | null = null;
  let worst: { v: number; s: string; l: string } | null = null;
  for (const s of series)
    s.values.forEach((v, i) => {
      if (v === null) return;
      if (!best || v > best.v) best = { v, s: s.name, l: labels[i]! };
      if (!worst || v < worst.v) worst = { v, s: s.name, l: labels[i]! };
    });
  const range = labels.length > 1 ? `${labels.length} categories from ${labels[0]} to ${labels[labels.length - 1]}` : `1 category, ${labels[0]}`;
  const names = series.length === 1 ? series[0]!.name : `${series.length} series: ${series.map((s) => s.name).join(", ")}`;
  const b = best as { v: number; s: string; l: string } | null;
  const w = worst as { v: number; s: string; l: string } | null;
  const extremes = b && w ? ` Highest ${series.length > 1 ? `${b.s} in ` : ""}${b.l} (${formatValue(b.v, unit)}), lowest ${series.length > 1 ? `${w.s} in ` : ""}${w.l} (${formatValue(w.v, unit)}).` : "";
  return `${range}; ${names}.${extremes}`;
}

// ---------------------------------------------------------------- scatter and bubble

function drawPoints(chart: ChartData, model: ReturnType<typeof pointModel>, box: Box, marks: Mark[], hits: Hit[]): string {
  const points = model.series.flatMap((s) => s.points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xTitle = chart.xLabel || model.xName;
  const yTitle = chart.yLabel || model.yName;
  const yd = valueDomain(chart, ys, false, tickCount(box.h, 56));
  const yText = yd.ticks.map((t) => formatCompact(t, model.yUnit));
  const tickW = Math.max(...yText.map((t) => textWidth(t, TICK))) + 10;
  const plot: Box = { x: box.x + (yTitle ? 20 : 0) + tickW, y: box.y + 10, w: 0, h: 0 };
  plot.w = Math.max(20, box.x + box.w - 14 - plot.x);
  plot.h = Math.max(20, box.y + box.h - 20 - (xTitle ? 20 : 0) - plot.y);
  const bubble = chart.kind === "bubble";
  const sizes = points.map((p) => p.size ?? 0).filter((s) => s > 0);
  const maxSize = sizes.length ? Math.max(...sizes) : 1;
  const rMax = Math.max(8, Math.min(36, Math.min(plot.w, plot.h) / 9));
  // Room inside the plot so no point (or bubble) is cut by its edges.
  const inX = bubble ? rMax + 4 : 10;
  const inTop = bubble ? rMax + 4 : 10;
  const inBottom = bubble ? rMax + 4 : 0;
  const xn = niceTicks(Math.min(...xs), Math.max(...xs), tickCount(plot.w, 100));
  const sx = (v: number) => plot.x + inX + ((v - xn.lo) / (xn.hi - xn.lo || 1)) * (plot.w - inX * 2);
  const sy = (v: number) => plot.y + plot.h - inBottom - ((Math.max(yd.lo, Math.min(yd.hi, v)) - yd.lo) / (yd.hi - yd.lo || 1)) * (plot.h - inTop - inBottom);
  yd.ticks.forEach((t, i) => {
    const p = round(sy(t));
    marks.push({ t: "line", x1: plot.x, y1: p, x2: plot.x + plot.w, y2: p, stroke: t === 0 && !inBottom ? "axis" : "grid", sw: 1 });
    marks.push({ t: "text", x: plot.x - 8, y: p + 3.5, text: yText[i]!, size: TICK, fill: "faint", anchor: "end", tabular: true });
  });
  xn.ticks.forEach((t) => {
    const p = round(sx(t));
    marks.push({ t: "line", x1: p, y1: plot.y, x2: p, y2: plot.y + plot.h, stroke: "grid", sw: 1 });
    marks.push({ t: "text", x: p, y: plot.y + plot.h + 15, text: formatCompact(t, model.xUnit), size: TICK, fill: "faint", anchor: "middle", tabular: true });
  });
  marks.push({ t: "line", x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: "axis", sw: 1 });
  if (yTitle) marks.push({ t: "text", x: box.x + 12, y: plot.y + plot.h / 2, text: fitText(yTitle, 12, plot.h), size: 12, weight: 600, fill: "muted", anchor: "middle", rotate: -90 });
  if (xTitle) marks.push({ t: "text", x: plot.x + plot.w / 2, y: box.y + box.h - 3, text: fitText(xTitle, 12, plot.w), size: 12, weight: 600, fill: "muted", anchor: "middle" });

  const radius = (s: number | null) => (bubble ? Math.max(4, rMax * Math.sqrt(Math.max(0, s ?? 0) / maxSize)) : 4);
  const label = points.length <= 14;
  let g = 0;
  // Biggest bubbles first, so small ones sit on top.
  const drawn = model.series.flatMap((s) => s.points.map((p) => ({ s, p, r: radius(p.size) }))).sort((a, b) => b.r - a.r);
  for (const { s, p, r } of drawn) {
    const x = sx(p.x);
    const y = sy(p.y);
    marks.push({ t: "circle", cx: round(x), cy: round(y), r: round(r), fill: c(s.color), opacity: bubble ? 0.78 : 1, stroke: "surface", sw: 2, g });
    if (chart.values || (label && p.label && chartLabelled(model))) {
      const text = chart.values ? (bubble && p.size !== null ? formatCompact(p.size, model.sizeUnit) : formatCompact(p.y, model.yUnit)) : p.label;
      if (bubble && r >= 16 && textWidth(text, 10.5) <= r * 1.7) marks.push({ t: "text", x: x, y: y + 3.5, text, size: 10.5, weight: 600, fill: `on:${s.color}`, anchor: "middle", g });
      else {
        // Beside the point, on its left when the right would run out of the plot.
        const shown = fitText(text, TICK, 110);
        const left = x + r + 5 + textWidth(shown, TICK) > plot.x + plot.w;
        marks.push({ t: "text", x: left ? x - r - 5 : x + r + 5, y: y + 3.5, text: shown, size: TICK, fill: "muted", anchor: left ? "end" : "start", g });
      }
    }
    hits.push({
      shape: "circle",
      cx: x,
      cy: y,
      r: Math.max(12, r + 3),
      g,
      at: { x, y: y - r },
      tip: {
        title: p.label || s.name,
        rows: [
          { label: model.xName || "x", value: formatValue(p.x, model.xUnit), paint: "none", key: "dot" },
          { label: model.yName || s.name, value: formatValue(p.y, model.yUnit), paint: c(s.color), key: "dot" },
          ...(bubble && p.size !== null ? [{ label: model.sizeName || "Size", value: formatValue(p.size, model.sizeUnit), paint: "none" as Paint, key: "dot" as const }] : []),
        ],
      },
    });
    g++;
  }
  return `${points.length} point${points.length === 1 ? "" : "s"}; ${model.xName || "x"} from ${formatValue(Math.min(...xs), model.xUnit)} to ${formatValue(Math.max(...xs), model.xUnit)}, ${model.yName || "y"} from ${formatValue(Math.min(...ys), model.yUnit)} to ${formatValue(Math.max(...ys), model.yUnit)}.`;
}

/** Whether the points carry their own names (a text first column). */
const chartLabelled = (model: ReturnType<typeof pointModel>) => model.series.length === 1 && model.series[0]!.points.some((p) => p.label && Number.isNaN(Number(p.label)));

// ---------------------------------------------------------------- pie and donut

function drawSlices(chart: ChartData, model: ReturnType<typeof sliceModel>, box: Box, marks: Mark[], hits: Hit[]): string {
  const donut = chart.kind === "donut";
  const r = Math.max(20, Math.min(box.w, box.h) / 2 - 6);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const inner = donut ? r * 0.6 : 0;
  let a = 0;
  model.slices.forEach((s, i) => {
    const sweep = (s.value / model.total) * Math.PI * 2;
    const d = slicePath(cx, cy, r, inner, a, a + sweep);
    // The surface-coloured edge is the gap between slices.
    marks.push({ t: "path", d, fill: c(s.color), stroke: model.slices.length > 1 ? "surface" : undefined, sw: 2, g: i });
    const mid = a + sweep / 2;
    const pct = (s.value / model.total) * 100;
    const pctText = `${pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%`;
    const text = chart.values ? formatCompact(s.value, model.unit) : pctText;
    const lr = donut ? (r + inner) / 2 : r * 0.64;
    const lx = cx + lr * Math.sin(mid);
    const ly = cy - lr * Math.cos(mid);
    const room = Math.min(sweep * lr, donut ? r - inner : r * 0.7);
    if (textWidth(text, 11.5, true) + 6 <= room && (donut ? r - inner >= 22 : true)) marks.push({ t: "text", x: round(lx), y: round(ly + 4), text, size: 11.5, weight: 600, fill: `on:${s.color}`, anchor: "middle", tabular: true, g: i });
    hits.push({ shape: "path", d, g: i, at: { x: cx + r * 0.8 * Math.sin(mid), y: cy - r * 0.8 * Math.cos(mid) }, tip: { title: s.label, rows: [{ label: model.name || "Value", value: `${formatValue(s.value, model.unit)} (${pctText})`, paint: c(s.color), key: "rect" }] } });
    a += sweep;
  });
  if (donut && inner >= 30) {
    const total = formatCompact(model.total, model.unit);
    const size = Math.min(22, inner * 0.42);
    marks.push({ t: "text", x: cx, y: cy + size * 0.2, text: total, size, weight: 600, fill: "ink", anchor: "middle" });
    marks.push({ t: "text", x: cx, y: cy + size * 0.2 + 16, text: fitText(`Total${model.name ? ` ${model.name}` : ""}`, 11, inner * 1.6), size: 11, fill: "muted", anchor: "middle" });
  }
  const top = [...model.slices].sort((x, y) => y.value - x.value)[0]!;
  return `${model.slices.length} slice${model.slices.length === 1 ? "" : "s"} adding up to ${formatValue(model.total, model.unit)}; the largest is ${top.label} at ${Math.round((top.value / model.total) * 100)}%.`;
}

// ---------------------------------------------------------------- org chart

const NODE_W = 156;
const NODE_H = 50;
const H_GAP = 16;
const V_GAP = 34;
const STACK_IN = 18;
const STACK_GAP = 10;

function drawOrg(model: ReturnType<typeof orgModel>, box: Box, marks: Mark[], hits: Hit[], width: number, height: number): { summary: string; size: { w: number; h: number } } {
  const { people, roots } = model;
  // Teams of people with nobody under them are listed down instead of across (narrower charts).
  const stacks = (i: number) => {
    const kids = people[i]!.children;
    return kids.length >= 3 && kids.every((k) => !people[k]!.children.length);
  };
  const widthOf = new Map<number, number>();
  const heightOf = new Map<number, number>();
  const measure = (i: number, depth: number): number => {
    if (depth > 40) return NODE_W;
    const kids = people[i]!.children;
    let w = NODE_W;
    let h = NODE_H;
    if (kids.length && stacks(i)) {
      w = NODE_W + STACK_IN;
      h = NODE_H + kids.length * (NODE_H + STACK_GAP) + 6;
    } else if (kids.length) {
      const ws = kids.map((k) => measure(k, depth + 1));
      w = Math.max(NODE_W, ws.reduce((a, b) => a + b, 0) + H_GAP * (kids.length - 1));
      h = NODE_H + V_GAP + Math.max(...kids.map((k) => heightOf.get(k) ?? NODE_H));
    }
    widthOf.set(i, w);
    heightOf.set(i, h);
    return w;
  };
  const rootWidths = roots.map((r) => measure(r, 0));
  const natW = rootWidths.reduce((a, b) => a + b, 0) + H_GAP * 2 * (roots.length - 1);
  const natH = Math.max(...roots.map((r) => heightOf.get(r) ?? NODE_H));
  // Fitted into the room, never larger than life and never so small it can't be read (it scrolls then).
  const s = Math.max(0.75, Math.min(1, box.w / natW, box.h / natH));
  const offX = box.x + Math.max(0, (box.w - natW * s) / 2);
  const offY = box.y + Math.max(0, Math.min(16, (box.h - natH * s) / 2));
  const X = (v: number) => offX + v * s;
  const Y = (v: number) => offY + v * s;
  const lines: string[] = [];
  const nodes: { i: number; x: number; y: number }[] = [];
  const place = (i: number, left: number, top: number, depth: number) => {
    const w = widthOf.get(i) ?? NODE_W;
    const kids = people[i]!.children;
    const stacked = kids.length > 0 && stacks(i);
    const x = stacked ? left : left + w / 2 - NODE_W / 2;
    nodes.push({ i, x, y: top });
    if (!kids.length || depth > 40) return;
    if (stacked) {
      kids.forEach((k, j) => {
        const ky = top + NODE_H + STACK_GAP + 6 + j * (NODE_H + STACK_GAP);
        lines.push(`M${round(X(x + 10))} ${round(Y(top + NODE_H))}V${round(Y(ky + NODE_H / 2))}H${round(X(x + STACK_IN))}`);
        nodes.push({ i: k, x: x + STACK_IN, y: ky });
      });
      return;
    }
    let at = left + (w - (kids.reduce((a, k) => a + (widthOf.get(k) ?? NODE_W), 0) + H_GAP * (kids.length - 1))) / 2;
    const mid = top + NODE_H + V_GAP / 2;
    for (const k of kids) {
      const kw = widthOf.get(k) ?? NODE_W;
      const kStacked = people[k]!.children.length > 0 && stacks(k);
      const kx = kStacked ? at + NODE_W / 2 : at + kw / 2;
      lines.push(`M${round(X(x + NODE_W / 2))} ${round(Y(top + NODE_H))}V${round(Y(mid))}H${round(X(kx))}V${round(Y(top + NODE_H + V_GAP))}`);
      place(k, at, top + NODE_H + V_GAP, depth + 1);
      at += kw + H_GAP;
    }
  };
  let left = 0;
  roots.forEach((r, i) => {
    place(r, left, 0, 0);
    left += rootWidths[i]! + H_GAP * 2;
  });
  if (lines.length) marks.push({ t: "path", d: lines.join(""), fill: "none", stroke: "axis", sw: 1.25 });
  const nameSize = 12.5 * Math.max(0.85, s);
  const roleSize = 11.5 * Math.max(0.85, s);
  nodes.forEach(({ i, x, y }) => {
    const p = people[i]!;
    const bx = X(x);
    const by = Y(y);
    const w = NODE_W * s;
    const h = NODE_H * s;
    marks.push({ t: "rect", x: round(bx), y: round(by), w: round(w), h: round(h), r: [8, 8, 8, 8], fill: "raised", stroke: "line", sw: 1, g: i });
    marks.push({ t: "rect", x: round(bx + 8 * s), y: round(by + 11 * s), w: 3, h: round(h - 22 * s), r: [1.5, 1.5, 1.5, 1.5], fill: c(p.color), g: i });
    const tx = bx + 19 * s;
    const room = w - 27 * s;
    if (p.role) {
      marks.push({ t: "text", x: round(tx), y: round(by + h / 2 - 3 * s), text: fitText(p.name, nameSize, room, true), size: nameSize, weight: 600, fill: "ink", g: i });
      marks.push({ t: "text", x: round(tx), y: round(by + h / 2 + 12 * s), text: fitText(p.role, roleSize, room), size: roleSize, fill: "muted", g: i });
    } else marks.push({ t: "text", x: round(tx), y: round(by + h / 2 + 4.5 * s), text: fitText(p.name, nameSize, room, true), size: nameSize, weight: 600, fill: "ink", g: i });
    const manager = people.find((m) => m.children.includes(i));
    hits.push({
      shape: "rect",
      x: bx,
      y: by,
      w,
      h,
      g: i,
      at: { x: bx + w / 2, y: by },
      tip: {
        title: p.name,
        rows: [
          ...(p.role ? [{ label: "Role", value: p.role, paint: "none" as Paint, key: "rect" as const }] : []),
          { label: "Reports to", value: manager ? manager.name : "Nobody", paint: "none", key: "rect" },
          ...(p.children.length ? [{ label: "Direct reports", value: String(p.children.length), paint: c(p.color), key: "rect" as const }] : []),
        ],
      },
    });
  });
  const size = { w: Math.max(width, Math.ceil(natW * s + (box.x * 2))), h: Math.max(height, Math.ceil(natH * s + offY + box.x)) };
  const top = roots.map((r) => people[r]!.name);
  return { summary: `${people.length} ${people.length === 1 ? "person" : "people"}; at the top ${top.slice(0, 3).join(", ")}${top.length > 3 ? ` and ${top.length - 3} more` : ""}.`, size };
}

// ---------------------------------------------------------------- Venn

/** The area two circles share. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - k;
}

/** How far apart two circles are when they share `area`. */
export function distanceFor(r1: number, r2: number, area: number): number {
  const full = Math.PI * Math.min(r1, r2) ** 2;
  if (area <= 0) return r1 + r2 + Math.min(r1, r2) * 0.08;
  if (area >= full) return Math.abs(r1 - r2);
  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (lensArea(r1, r2, mid) > area) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function drawVenn(model: ReturnType<typeof vennModel>, box: Box, marks: Mark[], hits: Hit[]): string {
  const { sets, overlaps, sized } = model;
  // Circle areas follow the sizes; distances the overlaps (equal circles, half overlapping, without sizes).
  const r = sets.map((s) => Math.sqrt(s.size / Math.PI));
  const pair = (i: number, j: number) => {
    const o = overlaps.get(`${i},${j}`);
    if (!sized) return r[i]!;
    return distanceFor(r[i]!, r[j]!, o === undefined ? 0 : Math.min(o, sets[i]!.size, sets[j]!.size));
  };
  const centers: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  const dAB = pair(0, 1);
  centers.push({ x: dAB, y: 0 });
  if (sets.length === 3) {
    const dAC = pair(0, 2);
    const dBC = pair(1, 2);
    const x = (dAC * dAC - dBC * dBC + dAB * dAB) / (2 * (dAB || 1));
    const y = Math.sqrt(Math.max(0, dAC * dAC - x * x)) || Math.max(r[2]!, 1) * 0.9;
    centers.push({ x, y });
  }
  const minX = Math.min(...centers.map((p, i) => p.x - r[i]!));
  const maxX = Math.max(...centers.map((p, i) => p.x + r[i]!));
  const minY = Math.min(...centers.map((p, i) => p.y - r[i]!));
  const maxY = Math.max(...centers.map((p, i) => p.y + r[i]!));
  const s = Math.min((box.w - 16) / (maxX - minX || 1), (box.h - 16) / (maxY - minY || 1));
  const ox = box.x + (box.w - (maxX - minX) * s) / 2 - minX * s;
  const oy = box.y + (box.h - (maxY - minY) * s) / 2 - minY * s;
  const P = centers.map((p) => ({ x: ox + p.x * s, y: oy + p.y * s }));
  const R = r.map((v) => v * s);
  const mid = { x: P.reduce((a, p) => a + p.x, 0) / P.length, y: P.reduce((a, p) => a + p.y, 0) / P.length };
  sets.forEach((set, i) => {
    marks.push({ t: "circle", cx: round(P[i]!.x), cy: round(P[i]!.y), r: round(R[i]!), fill: c(set.color), opacity: 0.16, g: i });
    marks.push({ t: "circle", cx: round(P[i]!.x), cy: round(P[i]!.y), r: round(R[i]!), fill: "none", stroke: c(set.color), sw: 2, g: i });
  });
  sets.forEach((set, i) => {
    // The set's name in its own part of the circle, away from the others.
    let dx = P[i]!.x - mid.x;
    let dy = P[i]!.y - mid.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) [dx, dy] = [0, -1];
    else [dx, dy] = [dx / len, dy / len];
    const lx = P[i]!.x + dx * R[i]! * 0.5;
    const ly = P[i]!.y + dy * R[i]! * 0.5;
    const room = Math.max(40, R[i]! * 1.1);
    marks.push({ t: "text", x: round(lx), y: round(ly - (sized ? 2 : -4)), text: fitText(set.name, 13, room, true), size: 13, weight: 600, fill: "ink", anchor: "middle", g: i });
    if (sized) marks.push({ t: "text", x: round(lx), y: round(ly + 14), text: formatCompact(set.size, model.unit), size: 12, fill: "muted", anchor: "middle", tabular: true, g: i });
    const shared = [...overlaps.entries()].filter(([k]) => k.split(",").map(Number).includes(i));
    hits.push({
      shape: "circle",
      cx: P[i]!.x,
      cy: P[i]!.y,
      r: R[i]!,
      g: i,
      at: { x: P[i]!.x, y: P[i]!.y - R[i]! },
      tip: {
        title: set.name,
        rows: [
          ...(sized ? [{ label: "In all", value: formatValue(set.size, model.unit), paint: c(set.color), key: "dot" as const }] : []),
          ...shared.map(([k, v]) => ({ label: `With ${k.split(",").map(Number).filter((j) => j !== i).map((j) => sets[j]!.name).join(" and ")}`, value: formatValue(v, model.unit), paint: "none" as Paint, key: "dot" as const })),
        ],
      },
    });
  });
  // Overlap sizes in the middle of each lens (all three at the centre).
  for (const [k, v] of overlaps) {
    const idx = k.split(",").map(Number);
    let x: number;
    let y: number;
    if (idx.length === 3) [x, y] = [mid.x, mid.y];
    else {
      const [i, j] = idx as [number, number];
      const d = Math.hypot(P[j]!.x - P[i]!.x, P[j]!.y - P[i]!.y) || 1;
      const t = (d - R[j]! + R[i]!) / 2 / d;
      x = P[i]!.x + (P[j]!.x - P[i]!.x) * t;
      y = P[i]!.y + (P[j]!.y - P[i]!.y) * t;
      if (sets.length === 3) {
        // Pushed out from the centre, clear of the three-way overlap.
        const ex = x - mid.x;
        const ey = y - mid.y;
        const el = Math.hypot(ex, ey) || 1;
        x += (ex / el) * Math.min(R[i]!, R[j]!) * 0.18;
        y += (ey / el) * Math.min(R[i]!, R[j]!) * 0.18;
      }
    }
    marks.push({ t: "text", x: round(x), y: round(y + 4), text: formatCompact(v, model.unit), size: 12, weight: 600, fill: "ink", anchor: "middle", tabular: true });
  }
  const names = sets.map((x) => x.name);
  return `${sets.length} sets: ${names.join(", ")}${overlaps.size ? `; ${[...overlaps.entries()].map(([k, v]) => `${k.split(",").map((i) => sets[Number(i)]!.name).join(" and ")} share ${formatValue(v, model.unit)}`).join("; ")}` : ""}.`;
}

/** The kinds that read the table as categories and series (they can switch between each other freely). */
export const CATEGORY_KINDS: readonly ChartKind[] = ["bar", "stackedBar", "line", "area", "pie", "donut"];
