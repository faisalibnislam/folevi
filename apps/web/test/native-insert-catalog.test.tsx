// The Insert panel for the native apps (docs/IOS_REBUILD_PLAN.md, I1): its sections, tiles and pictures, as
// components/doc/InsertPanel.tsx and insertPreviews.tsx draw them, written as Swift data for FoleviDesign's native
// Insert sheet (apps/native-kit/Sources/FoleviDesign/Generated/InsertCatalog.swift). Each picture is rendered
// through React and its SVG walked: rects, circles, paths, text, rotated and clipped groups, each painted in the
// text colour, the paper colour or the tile's accent at an opacity. The same data is written as Kotlin for the
// Android app's native Insert sheet (apps/android/app/src/main/java/com/folevi/android/design/InsertCatalog.kt).
//   UPDATE_INSERT_CATALOG=1 pnpm --filter @folevi/web exec vitest run test/native-insert-catalog.test.tsx
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NATIVE_INSERT_SECTIONS, NATIVE_SCAN_TILES } from "@/components/doc/InsertPanel";
import { InsertPreview, type PreviewKind } from "@/components/doc/insertPreviews";

const OUT = join(import.meta.dirname, "../../native-kit/Sources/FoleviDesign/Generated/InsertCatalog.swift");
const OUT_KT = join(import.meta.dirname, "../../android/app/src/main/java/com/folevi/android/design/InsertCatalog.kt");

const num = (v: string | null | undefined, fallback = 0) => {
  const n = v === null || v === undefined || v === "" ? fallback : Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return Number(n.toFixed(4)).toString();
};
const str = (v: string) => JSON.stringify(v);

/** A paint colour: the text colour, the paper (surface) colour or the accent; null for none. */
function ink(v: string | null): string | null {
  if (v === null || v === "none") return null;
  if (v === "currentColor") return ".current";
  if (v === "var(--color-surface-raised)") return ".paper";
  if (v === "var(--color-accent)") return ".accent";
  throw new Error(`unknown paint ${v}`);
}

interface Paint {
  fill: string | null;
  fillOpacity: string;
  stroke: string | null;
  strokeOpacity: string;
  strokeWidth: string;
  cap: string;
  join: string;
  dash: string;
}

const DEFAULT_PAINT: Paint = { fill: "currentColor", fillOpacity: "1", stroke: null, strokeOpacity: "1", strokeWidth: "1", cap: "butt", join: "miter", dash: "" };

function paintOf(el: Element, parent: Paint): Paint {
  const a = (n: string) => el.getAttribute(n);
  return {
    fill: a("fill") ?? parent.fill,
    fillOpacity: a("fill-opacity") ?? parent.fillOpacity,
    stroke: a("stroke") ?? parent.stroke,
    strokeOpacity: a("stroke-opacity") ?? parent.strokeOpacity,
    strokeWidth: a("stroke-width") ?? parent.strokeWidth,
    cap: a("stroke-linecap") ?? parent.cap,
    join: a("stroke-linejoin") ?? parent.join,
    dash: a("stroke-dasharray") ?? parent.dash,
  };
}

function swiftPaint(p: Paint): string {
  const dash = p.dash ? p.dash.split(/[\s,]+/).map((d) => num(d)) : [];
  return `InsertPaint(fill: ${ink(p.fill) ?? "nil"}, fillOpacity: ${num(p.fillOpacity, 1)}, stroke: ${ink(p.stroke) ?? "nil"}, strokeOpacity: ${num(p.strokeOpacity, 1)}, strokeWidth: ${num(p.strokeWidth, 1)}, roundCap: ${p.cap === "round"}, roundJoin: ${p.join === "round"}, dash: [${dash.join(", ")}])`;
}

function shape(el: Element): string | null {
  const a = (n: string) => el.getAttribute(n);
  switch (el.tagName.toLowerCase()) {
    case "rect": {
      const rx = a("rx") ?? a("ry") ?? "0";
      return `.rect(x: ${num(a("x"))}, y: ${num(a("y"))}, width: ${num(a("width"))}, height: ${num(a("height"))}, rx: ${num(rx)}, ry: ${num(a("ry") ?? rx)})`;
    }
    case "circle":
      return `.circle(cx: ${num(a("cx"))}, cy: ${num(a("cy"))}, r: ${num(a("r"))})`;
    case "path":
      return `.path(${str(a("d") ?? "")})`;
    case "line":
      return `.line(x1: ${num(a("x1"))}, y1: ${num(a("y1"))}, x2: ${num(a("x2"))}, y2: ${num(a("y2"))})`;
    default:
      return null;
  }
}

/** An element and what's in it, as InsertArt literals. */
function walk(el: Element, parent: Paint, clips: Map<string, Element>): string[] {
  const out: string[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "clippath") continue;
    const paint = paintOf(child, parent);
    if (tag === "g") {
      const t = child.getAttribute("transform");
      let rotate = "nil";
      if (t) {
        const m = /^rotate\(([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\)$/.exec(t.trim());
        if (!m) throw new Error(`unknown transform ${t}`);
        rotate = `InsertRotation(degrees: ${num(m[1])}, cx: ${num(m[2])}, cy: ${num(m[3])})`;
      }
      let clip = "nil";
      const c = child.getAttribute("clip-path");
      if (c) {
        const id = /url\(#(.+)\)/.exec(c)?.[1];
        const clipEl = id ? clips.get(id) : undefined;
        const clipShape = clipEl?.firstElementChild ? shape(clipEl.firstElementChild) : null;
        if (!clipShape) throw new Error(`unknown clip ${c}`);
        clip = clipShape;
      }
      out.push(`.group(rotate: ${rotate}, clip: ${clip}, [${walk(child, paint, clips).join(", ")}])`);
      continue;
    }
    if (tag === "text") {
      const a = (n: string) => child.getAttribute(n);
      const serif = (a("font-family") ?? "").includes("serif") && !(a("font-family") ?? "").includes("sans");
      out.push(
        `.text(${str(child.textContent ?? "")}, x: ${num(a("x"))}, y: ${num(a("y"))}, size: ${num(a("font-size"), 12)}, weight: ${num(a("font-weight"), 400)}, italic: ${a("font-style") === "italic"}, centered: ${a("text-anchor") === "middle"}, serif: ${serif}, paint: ${swiftPaint(paint)})`,
      );
      continue;
    }
    const s = shape(child);
    if (!s) throw new Error(`unknown element <${tag}>`);
    out.push(`.shape(${s}, ${swiftPaint(paint)})`);
  }
  return out;
}

function picture(kind: PreviewKind): string[] {
  const html = renderToStaticMarkup(<InsertPreview kind={kind} />);
  const doc = new DOMParser().parseFromString(html, "image/svg+xml");
  const svg = doc.documentElement;
  const clips = new Map<string, Element>();
  for (const c of Array.from(svg.querySelectorAll("clipPath"))) clips.set(c.getAttribute("id") ?? "", c);
  return walk(svg, DEFAULT_PAINT, clips);
}

function tile(t: { kind: string; label: string; name: string | null; preview: string | null; hue: string | null; keywords: string }): string {
  return `InsertTileSpec(kind: ${str(t.kind)}, label: ${str(t.label)}, name: ${t.name ? str(t.name) : "nil"}, preview: ${t.preview ? str(t.preview) : "nil"}, hue: ${t.hue ? str(t.hue) : "nil"}, keywords: ${str(t.keywords.trim())})`;
}

function swift(): string {
  const kinds = new Set<PreviewKind>();
  for (const s of NATIVE_INSERT_SECTIONS) for (const t of s.tiles) if (t.preview) kinds.add(t.preview);
  for (const t of NATIVE_SCAN_TILES) if (t.preview) kinds.add(t.preview);
  const lines = [
    "// Generated by apps/web/test/native-insert-catalog.test.tsx from components/doc/InsertPanel.tsx and",
    "// insertPreviews.tsx. Do not edit. Regenerate with",
    "// `UPDATE_INSERT_CATALOG=1 pnpm --filter @folevi/web exec vitest run test/native-insert-catalog.test.tsx`.",
    "import CoreGraphics",
    "",
    "public enum InsertCatalog {",
    "    /// The Insert sheet's sections, in order.",
    "    public static let sections: [InsertSectionSpec] = [",
    ...NATIVE_INSERT_SECTIONS.map((s) => `        InsertSectionSpec(title: ${str(s.title)}, tiles: [\n${s.tiles.map((t) => `            ${tile(t)},`).join("\n")}\n        ]),`),
    "    ]",
    "",
    "    /// The scanner's tiles (after Media's, where the device has a scanner).",
    "    public static let scanTiles: [InsertTileSpec] = [",
    ...NATIVE_SCAN_TILES.map((t) => `        ${tile(t)},`),
    "    ]",
    "",
    "    /// Each tile's picture on a 48 x 36 grid.",
    "    public static let pictures: [String: [InsertArt]] = [",
    ...[...kinds].sort().map((k) => `        ${str(k)}: [\n${picture(k).map((a) => `            ${a},`).join("\n")}\n        ],`),
    "    ]",
    "}",
    "",
  ];
  return lines.join("\n");
}


// ---------------------------------------------------------------- Kotlin (the Android app)

const kstr = (v: string) => JSON.stringify(v).replace(/\$/g, "\\$");
const kf = (v: string | null | undefined, fallback = 0) => `${num(v, fallback)}f`;

function kInk(v: string | null): string {
  const i = ink(v);
  return i === null ? "null" : `InsertInk.${i.slice(1).toUpperCase()}`;
}

function kPaint(p: Paint): string {
  const dash = p.dash ? p.dash.split(/[\s,]+/).map((d) => kf(d)) : [];
  return `p(${kInk(p.fill)}, ${kf(p.fillOpacity, 1)}, ${kInk(p.stroke)}, ${kf(p.strokeOpacity, 1)}, ${kf(p.strokeWidth, 1)}, ${p.cap === "round"}, ${p.join === "round"}${dash.length ? `, ${dash.join(", ")}` : ""})`;
}

function kShape(el: Element): string | null {
  const a = (n: string) => el.getAttribute(n);
  switch (el.tagName.toLowerCase()) {
    case "rect": {
      const rx = a("rx") ?? a("ry") ?? "0";
      return `InsertNode.Rect(${kf(a("x"))}, ${kf(a("y"))}, ${kf(a("width"))}, ${kf(a("height"))}, ${kf(rx)}, ${kf(a("ry") ?? rx)})`;
    }
    case "circle":
      return `InsertNode.Circle(${kf(a("cx"))}, ${kf(a("cy"))}, ${kf(a("r"))})`;
    case "path":
      return `InsertNode.PathData(${kstr(a("d") ?? "")})`;
    case "line":
      return `InsertNode.Line(${kf(a("x1"))}, ${kf(a("y1"))}, ${kf(a("x2"))}, ${kf(a("y2"))})`;
    default:
      return null;
  }
}

function kWalk(el: Element, parent: Paint, clips: Map<string, Element>): string[] {
  const out: string[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "clippath") continue;
    const paint = paintOf(child, parent);
    if (tag === "g") {
      const t = child.getAttribute("transform");
      let rotate = "null";
      if (t) {
        const m = /^rotate\(([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\)$/.exec(t.trim());
        if (!m) throw new Error(`unknown transform ${t}`);
        rotate = `InsertRotation(${kf(m[1])}, ${kf(m[2])}, ${kf(m[3])})`;
      }
      let clip = "null";
      const c = child.getAttribute("clip-path");
      if (c) {
        const id = /url\(#(.+)\)/.exec(c)?.[1];
        const clipEl = id ? clips.get(id) : undefined;
        const clipShape = clipEl?.firstElementChild ? kShape(clipEl.firstElementChild) : null;
        if (!clipShape) throw new Error(`unknown clip ${c}`);
        clip = clipShape;
      }
      out.push(`InsertArt.Group(${rotate}, ${clip}, listOf(${kWalk(child, paint, clips).join(", ")}))`);
      continue;
    }
    if (tag === "text") {
      const a = (n: string) => child.getAttribute(n);
      const serif = (a("font-family") ?? "").includes("serif") && !(a("font-family") ?? "").includes("sans");
      out.push(
        `InsertArt.Text(${kstr(child.textContent ?? "")}, ${kf(a("x"))}, ${kf(a("y"))}, ${kf(a("font-size"), 12)}, ${kf(a("font-weight"), 400)}, ${a("font-style") === "italic"}, ${a("text-anchor") === "middle"}, ${serif}, ${kPaint(paint)})`,
      );
      continue;
    }
    const s = kShape(child);
    if (!s) throw new Error(`unknown element <${tag}>`);
    out.push(`InsertArt.Shape(${s}, ${kPaint(paint)})`);
  }
  return out;
}

function kPicture(kind: PreviewKind): string[] {
  const html = renderToStaticMarkup(<InsertPreview kind={kind} />);
  const doc = new DOMParser().parseFromString(html, "image/svg+xml");
  const svg = doc.documentElement;
  const clips = new Map<string, Element>();
  for (const c of Array.from(svg.querySelectorAll("clipPath"))) clips.set(c.getAttribute("id") ?? "", c);
  return kWalk(svg, DEFAULT_PAINT, clips);
}

function kTile(t: { kind: string; label: string; name: string | null; preview: string | null; hue: string | null; keywords: string }): string {
  return `InsertTileSpec(${kstr(t.kind)}, ${kstr(t.label)}, ${t.name ? kstr(t.name) : "null"}, ${t.preview ? kstr(t.preview) : "null"}, ${t.hue ? kstr(t.hue) : "null"}, ${kstr(t.keywords.trim())})`;
}

const kName = (k: string) => "art" + k.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_m, _p, c: string) => c.toUpperCase());

function kotlin(): string {
  const kinds = new Set<PreviewKind>();
  for (const s of NATIVE_INSERT_SECTIONS) for (const t of s.tiles) if (t.preview) kinds.add(t.preview);
  for (const t of NATIVE_SCAN_TILES) if (t.preview) kinds.add(t.preview);
  const sorted = [...kinds].sort();
  const lines = [
    "// Generated by apps/web/test/native-insert-catalog.test.tsx from components/doc/InsertPanel.tsx and",
    "// insertPreviews.tsx (the same data as the iPhone's InsertCatalog.swift). Do not edit. Regenerate with",
    "// `UPDATE_INSERT_CATALOG=1 pnpm --filter @folevi/web exec vitest run test/native-insert-catalog.test.tsx`.",
    "package com.folevi.android.design",
    "",
    "object InsertCatalog {",
    "    /** The Insert sheet's sections, in order. */",
    "    val sections: List<InsertSectionSpec> by lazy {",
    "        listOf(",
    ...NATIVE_INSERT_SECTIONS.map((s) => `            InsertSectionSpec(${kstr(s.title)}, listOf(\n${s.tiles.map((t) => `                ${kTile(t)},`).join("\n")}\n            )),`),
    "        )",
    "    }",
    "",
    "    /** The scanner's tiles (after Media's, where the device has a scanner). */",
    "    val scanTiles: List<InsertTileSpec> by lazy {",
    "        listOf(",
    ...NATIVE_SCAN_TILES.map((t) => `            ${kTile(t)},`),
    "        )",
    "    }",
    "",
    "    /** Each tile's picture on a 48 x 36 grid (one function each, so no method grows too large). */",
    "    val pictures: Map<String, List<InsertArt>> by lazy {",
    "        mapOf(",
    ...sorted.map((k) => `            ${kstr(k)} to ${kName(k)}(),`),
    "        )",
    "    }",
    "",
    ...sorted.flatMap((k) => [`    private fun ${kName(k)}(): List<InsertArt> = listOf(`, ...kPicture(k).map((a) => `        ${a},`), "    )", ""]),
    "    private fun p(fill: InsertInk?, fillOpacity: Float, stroke: InsertInk?, strokeOpacity: Float, strokeWidth: Float, roundCap: Boolean, roundJoin: Boolean, vararg dash: Float) =",
    "        InsertPaint(fill, fillOpacity, stroke, strokeOpacity, strokeWidth, roundCap, roundJoin, dash.toList())",
    "}",
    "",
  ];
  return lines.join("\n");
}

describe("the native Insert catalog", () => {
  if (process.env.UPDATE_INSERT_CATALOG) {
    it("writes the Swift and Kotlin files", () => {
      writeFileSync(OUT, swift());
      writeFileSync(OUT_KT, kotlin());
    });
    return;
  }
  it("is current with the Insert panel", () => {
    expect(readFileSync(OUT, "utf8"), "InsertCatalog.swift is stale: regenerate it").toBe(swift());
  });
  it("is current for the Android app", () => {
    expect(readFileSync(OUT_KT, "utf8"), "InsertCatalog.kt is stale: regenerate it").toBe(kotlin());
  });
});
