// Drawing one flowchart shape with everything v2 puts in it: the outline (with the stacked copies behind a
// multiple-documents shape and the stroke-only details inside the library's shapes), custom fill and outline,
// an image, an icon, the label with its formatting (bold, italic, underline, strike, code, links, text
// colours, highlights, bullets and numbers, alignment) and the note and page-link badges. No hooks and no
// browser APIs: the editor, read-only notes and share pages all draw shapes with this. The geometry comes
// from the model (nodeContentBoxes, nodeTextLayout), so it matches the exports pixel for pixel.
import { memo, type CSSProperties, type ReactNode } from "react";
import {
  FLOWCHART_FONT_SIZE,
  FLOWCHART_ICON_DEFS,
  FLOWCHART_LINE_HEIGHT,
  customFillInk,
  isBareShape,
  nodeContentBoxes,
  nodeTextLayout,
  shapeBackPaths,
  shapeDetailPath,
  shapePath,
  type FlowNode,
  type FlowRun,
  type FlowTextLine,
} from "./schema";

type Mark = NonNullable<FlowRun["marks"]>[number];

const HEX = /^#[0-9a-f]{6}$/i;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Only addresses an image may load from (the same rule as the exports). */
const IMAGE_URL = /^(https?:|data:image\/|blob:|app:\/\/folevi\/|\/)/i;

/** Dash pattern for an outline style (as the exports draw it). */
function dashFor(style: FlowNode["strokeStyle"], width: number): string | undefined {
  if (style === "dashed") return `${r1(4 * width)} ${r1(3.4 * width)}`;
  if (style === "dotted") return `0.1 ${r1(2.6 * width + 1)}`;
  return undefined;
}

/** Inline paint for a shape's outline: custom fill and outline colour, width and style over the theme's. */
function outlineStyle(n: FlowNode): CSSProperties | undefined {
  const s: CSSProperties = {};
  if (n.fill && (n.fill === "none" || HEX.test(n.fill))) s.fill = n.fill === "none" ? "transparent" : n.fill;
  if (n.stroke && (n.stroke === "none" || HEX.test(n.stroke))) s.stroke = n.stroke === "none" ? "transparent" : n.stroke;
  if (n.strokeWidth !== undefined) s.strokeWidth = n.strokeWidth;
  const dash = dashFor(n.strokeStyle, Math.max(1, n.strokeWidth ?? 1.5));
  if (dash) {
    s.strokeDasharray = dash;
    s.strokeLinecap = "round";
  }
  return Object.keys(s).length ? s : undefined;
}

/** A styled piece of a label. */
function Span({ text, marks, links }: { text: string; marks?: readonly Mark[]; links: boolean }) {
  if (!marks?.length) return <tspan>{text}</tspan>;
  const style: CSSProperties = {};
  const deco: string[] = [];
  const classes: string[] = [];
  let href: string | null = null;
  for (const m of marks) {
    if (m.type === "bold") style.fontWeight = 650;
    else if (m.type === "italic") style.fontStyle = "italic";
    else if (m.type === "underline") deco.push("underline");
    else if (m.type === "strike") deco.push("line-through");
    else if (m.type === "code") {
      style.fontFamily = "var(--font-mono)";
      style.fontSize = FLOWCHART_FONT_SIZE * 0.92;
    } else if (m.type === "color") classes.push(`fc-tc fb-color-${m.value}`);
    else if (m.type === "link") {
      deco.push("underline");
      classes.push("fc-link");
      href = m.href;
    }
  }
  if (deco.length) style.textDecoration = deco.join(" ");
  const span = (
    <tspan style={style} className={classes.join(" ") || undefined}>
      {text}
    </tspan>
  );
  return links && href ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {span}
    </a>
  ) : (
    span
  );
}

/** Highlights drawn as soft boxes behind their words (widths are estimates, as in the exports). */
function Highlights({ lines, t }: { lines: FlowTextLine[]; t: ReturnType<typeof nodeTextLayout> }) {
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    const total = line.spans.reduce((k, s) => k + s.text.length, 0);
    if (!total || !line.spans.some((s) => s.marks?.some((m) => m.type === "highlight"))) return;
    const y = t.y + i * FLOWCHART_LINE_HEIGHT;
    let x = t.anchor === "start" ? t.x + line.indent : t.anchor === "end" ? t.x - line.width : t.x - line.width / 2;
    line.spans.forEach((s, j) => {
      const w = (line.width - line.indent) * (s.text.length / total);
      const hl = s.marks?.find((m): m is Extract<Mark, { type: "highlight" }> => m.type === "highlight");
      if (hl) out.push(<rect key={`${i}-${j}`} className={`fc-hl fc-hl-${hl.value}`} x={r1(x)} y={r1(y - FLOWCHART_FONT_SIZE * 0.85)} width={r1(w)} height={r1(FLOWCHART_FONT_SIZE * 1.15)} rx={2} />);
      x += w;
    });
  });
  return out.length ? <>{out}</> : null;
}

export interface FlowNodeShapeProps {
  node: FlowNode;
  /** Leaves the label out (it is being written in an editor over the shape). */
  hideText?: boolean;
  /** The image's address (the editor and pages resolve file ids); a placeholder shows without one. */
  imageHref?: string | null;
  /** Links in the label are live links (read-only views); in the editor a click selects the shape. */
  links?: boolean;
  /** A prefix that keeps this picture's clip ids apart from other charts on the page. */
  uid?: string;
}

/** A node: its outline, image, icon, wrapped label and badges. */
export const FlowNodeShape = memo(function FlowNodeShape({ node, hideText = false, imageHref, links = false, uid = "fc" }: FlowNodeShapeProps) {
  const n = node;
  const outline = shapePath(n);
  const paint = outlineStyle(n);
  const details = shapeDetailPath(n);
  const boxes = nodeContentBoxes(n);
  const t = nodeTextLayout(n);
  const ink = customFillInk(n.fill);
  const clip = `${uid}-img-${n.id}`;
  const img = n.image ? boxes.image : null;
  const href = imageHref && IMAGE_URL.test(imageHref) ? imageHref : null;
  const icon = n.icon ? FLOWCHART_ICON_DEFS[n.icon.name] : undefined;
  return (
    <g style={ink ? ({ "--fc-ink": ink } as CSSProperties) : undefined}>
      {shapeBackPaths(n).map((d, i) => (
        <path key={i} className="fc-shape fc-shape-back" d={d} style={paint} />
      ))}
      {isBareShape(n.shape) ? <path className="fc-shape fc-shape-bare" d={outline} /> : <path className="fc-shape" d={outline} style={paint} />}
      {n.shape === "note" ? <path className="fc-note-fold" d={`M${n.x + n.w - 14} ${n.y + n.h}L${n.x + n.w} ${n.y + n.h - 14}`} /> : null}
      {details ? <path className="fc-shape-detail" d={details} style={paint?.stroke || paint?.strokeWidth !== undefined ? { stroke: paint.stroke, strokeWidth: paint.strokeWidth } : undefined} /> : null}
      {img ? (
        href ? (
          <>
            <clipPath id={clip}>
              <rect x={r1(img.x)} y={r1(img.y)} width={r1(img.w)} height={r1(img.h)} rx={6} />
            </clipPath>
            <image
              className="fc-image"
              href={href}
              x={r1(img.x)}
              y={r1(img.y)}
              width={r1(img.w)}
              height={r1(img.h)}
              preserveAspectRatio={`xMidYMid ${n.image?.fit === "contain" ? "meet" : "slice"}`}
              clipPath={`url(#${clip})`}
            />
          </>
        ) : (
          <>
            <rect className="fc-image-ph" x={r1(img.x)} y={r1(img.y)} width={r1(img.w)} height={r1(img.h)} rx={6} />
            <ImageGlyph box={img} />
          </>
        )
      ) : null}
      {icon && boxes.icon ? (
        <path className="fc-icon" d={icon.d} transform={`translate(${r1(boxes.icon.x)} ${r1(boxes.icon.y)}) scale(${Math.round((boxes.icon.w / 24) * 1000) / 1000})`} />
      ) : null}
      {!hideText && t.rich.length ? (
        <>
          <Highlights lines={t.rich} t={t} />
          <text className="fc-label" textAnchor={t.anchor} fontSize={FLOWCHART_FONT_SIZE}>
            {t.rich.map((line, i) => (
              <tspan key={i} x={r1(t.anchor === "start" && !line.marker ? t.x + line.indent : t.x)} y={r1(t.y + i * FLOWCHART_LINE_HEIGHT)}>
                {line.marker ? <tspan className="fc-marker">{`${line.marker} `}</tspan> : null}
                {line.spans.map((s, j) => (
                  <Span key={j} text={s.text} marks={s.marks} links={links} />
                ))}
              </tspan>
            ))}
          </text>
        </>
      ) : null}
      {boxes.badges.map((b) => {
        const glyph = FLOWCHART_ICON_DEFS[b.kind === "note" ? "file" : "link"];
        const s = b.r * 1.2;
        return (
          <g key={b.kind} className="fc-badge" data-fc-badge={b.kind} data-node={n.id}>
            <circle cx={r1(b.cx)} cy={r1(b.cy)} r={b.r + 4} className="fc-badge-hit" />
            <circle cx={r1(b.cx)} cy={r1(b.cy)} r={b.r} className="fc-badge-dot" />
            <path className="fc-badge-glyph" d={glyph.d} transform={`translate(${r1(b.cx - s / 2)} ${r1(b.cy - s / 2)}) scale(${Math.round((s / 24) * 1000) / 1000})`} />
          </g>
        );
      })}
    </g>
  );
});

/** A small picture glyph in an image's place while it loads (or when it can't be shown). */
function ImageGlyph({ box }: { box: { x: number; y: number; w: number; h: number } }) {
  const s = Math.min(24, box.w / 2, box.h / 2);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return <path className="fc-image-glyph" d={`M${r1(cx - s / 2)} ${r1(cy + s / 3)}L${r1(cx - s / 8)} ${r1(cy - s / 8)}L${r1(cx + s / 8)} ${r1(cy + s / 8)}L${r1(cx + s / 4)} ${r1(cy)}L${r1(cx + s / 2)} ${r1(cy + s / 3)}Z`} />;
}
