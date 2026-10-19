// Numbers and text for the chart drawing: value labels and axis ticks as people expect them ("$1,200",
// "40%", "1.2K"), the units a column is written in, nice axis steps, and text measured without a browser
// (share pages draw on the server), so labels can be fitted, thinned and shortened before they're drawn.
import { parseChartNumber, type ChartCell } from "@folevi/editor-schema";

/** How a column's numbers are written: a currency sign before them, "%" or a sign after, and decimals. */
export interface Unit {
  prefix: string;
  suffix: string;
  decimals: number;
}

export const PLAIN: Unit = { prefix: "", suffix: "", decimals: 0 };

/** The unit most of a column's cells are written with, and the most decimals any of them shows. */
export function columnUnit(cells: readonly ChartCell[]): Unit {
  const prefixes = new Map<string, number>();
  const suffixes = new Map<string, number>();
  let decimals = 0;
  let count = 0;
  for (const c of cells) {
    if (c === null) continue;
    const text = typeof c === "number" ? String(c) : c;
    const n = typeof c === "number" ? { value: c, prefix: "", suffix: "" } : parseChartNumber(c);
    if (!n) continue;
    count++;
    if (n.prefix) prefixes.set(n.prefix, (prefixes.get(n.prefix) ?? 0) + 1);
    if (n.suffix) suffixes.set(n.suffix, (suffixes.get(n.suffix) ?? 0) + 1);
    const m = /[.,](\d+)\s*\D*$/.exec(text.replace(/\s+$/, ""));
    if (m && !/^\d{1,3}([.,]\d{3})+$/.test(text.replace(/[^\d.,]/g, ""))) decimals = Math.max(decimals, Math.min(4, m[1]!.length));
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const p = top(prefixes);
  const s = top(suffixes);
  return { prefix: p && p[1] * 2 >= count ? p[0] : "", suffix: s && s[1] * 2 >= count ? s[0] : "", decimals };
}

const groupFormat = new Map<number, Intl.NumberFormat>();
function grouped(n: number, decimals: number): string {
  let f = groupFormat.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
    groupFormat.set(decimals, f);
  }
  return f.format(n);
}

const withUnit = (body: string, n: number, u: Unit) => `${n < 0 ? "-" : ""}${u.prefix}${body}${u.suffix === "%" ? "%" : u.suffix ? ` ${u.suffix}` : ""}`;

/** A value in full, written the way its column is: "$1,200.5", "42%", "3,400". */
export function formatValue(n: number, u: Unit = PLAIN): string {
  const decimals = Math.max(u.decimals, Math.abs(n) < 10 && !Number.isInteger(n) ? 2 : 0);
  return withUnit(grouped(Math.abs(n), Math.min(decimals, 4)), n, u);
}

/** A value made short for axes and tight labels, from 1,000 up: "1.2K", "$3M". */
export function formatCompact(n: number, u: Unit = PLAIN): string {
  const a = Math.abs(n);
  const short = (v: number, s: string) => `${grouped(v, v >= 100 ? 0 : 1)}${s}`;
  const body = a >= 1e9 ? short(a / 1e9, "B") : a >= 1e6 ? short(a / 1e6, "M") : a >= 1e4 ? short(a / 1e3, "K") : grouped(a, a >= 100 ? 0 : a >= 1 ? 1 : 2);
  return withUnit(body, n, u);
}

/** Round steps for an axis from `lo` to `hi`: about `count` ticks at 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, count = 5): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (lo === hi) {
    const pad = Math.abs(lo) || 1;
    lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad;
    hi += pad;
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start, i = 0; v <= end + step / 2 && i < 50; v += step, i++) ticks.push(Math.round(v / step) * step);
  return { lo: start, hi: end, ticks: ticks.map((t) => (Math.abs(t) < step / 1e6 ? 0 : Number(t.toPrecision(12)))) };
}

// Widths of characters in Instrument Sans as a share of the font size (close enough to fit labels).
const NARROW = new Set("il.,:;'|!()[]{}jtfr ");
const WIDE = new Set("mwMW@%");
/** The width of `text` in pixels at `size`, measured without a browser. */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) w += 0.3;
    else if (WIDE.has(ch)) w += 0.84;
    else if (/[0-9]/.test(ch)) w += 0.56;
    else if (/[A-Z]/.test(ch)) w += 0.64;
    else if (/[\u3000-\u9fff\uac00-\ud7af]/.test(ch)) w += 1;
    else w += 0.52;
  }
  return w * size * (bold ? 1.06 : 1);
}

/** `text` shortened with an ellipsis to fit `max` pixels (empty when not even one letter fits). */
export function fitText(text: string, size: number, max: number, bold = false): string {
  if (textWidth(text, size, bold) <= max) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${chars.slice(0, mid).join("").trimEnd()}…`, size, bold) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo ? `${chars.slice(0, lo).join("").trimEnd()}…` : "";
}

/** Words wrapped into lines no wider than `max` (at most `lines`, the last one shortened). */
export function wrapText(text: string, size: number, max: number, lines = 2, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (textWidth(next, size, bold) <= max || !line) line = next;
    else {
      out.push(line);
      line = words[i]!;
      if (out.length === lines - 1) {
        line = words.slice(i).join(" ");
        break;
      }
    }
  }
  if (line) out.push(line);
  return out.slice(0, lines).map((l, i, all) => (i === all.length - 1 ? fitText(l, size, max, bold) : l));
}
