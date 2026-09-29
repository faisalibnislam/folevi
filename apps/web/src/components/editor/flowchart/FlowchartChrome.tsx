"use client";

// The flowchart canvas's floating controls: the shape toolbar, zoom, and the bar that edits the current
// selection (colour, shape, line style, arrows). Neutral glass chrome; only the swatches carry colour.
import { Copy, Maximize, Minus, Plus, Redo2, Trash2, Undo2, Type, WandSparkles } from "lucide-react";
import {
  FLOWCHART_COLORS,
  FLOWCHART_COLOR_LABEL,
  FLOWCHART_SHAPES,
  FLOWCHART_SHAPE_LABEL,
  type FlowArrow,
  type FlowColor,
  type FlowEdgeStyle,
  type FlowShape,
} from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { MenuButton } from "@/components/ui/Menu";

/** A small outline of each shape for buttons and menus. */
export function ShapeIcon({ shape, size = 18 }: { shape: FlowShape; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      {shape === "process" ? <rect x="2.5" y="5" width="15" height="10" rx="2.5" {...common} /> : null}
      {shape === "decision" ? <path d="M10 2.8 17.2 10 10 17.2 2.8 10Z" {...common} /> : null}
      {shape === "terminator" ? <rect x="2" y="6" width="16" height="8" rx="4" {...common} /> : null}
      {shape === "io" ? <path d="M6 5h11.5L14 15H2.5Z" {...common} /> : null}
      {shape === "circle" ? <circle cx="10" cy="10" r="6.8" {...common} /> : null}
      {shape === "note" ? <path d="M3.5 3.5h13v9l-4 4h-9Z M12.5 16.5v-4h4" {...common} /> : null}
      {shape === "text" ? <Type size={15} x={2.5} y={2.5} aria-hidden /> : null}
    </svg>
  );
}

export function MainToolbar({
  onAdd,
  onTidy,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  canTidy,
  onAi,
  aiOpen,
}: {
  onAdd: (shape: FlowShape) => void;
  onTidy: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canTidy: boolean;
  onAi: (() => void) | null;
  aiOpen: boolean;
}) {
  return (
    <div className="fc-bar fc-bar-main" role="toolbar" aria-label="Flowchart tools" onPointerDown={(e) => e.stopPropagation()}>
      <span role="group" aria-label="Add a shape" className="fc-group">
        {FLOWCHART_SHAPES.map((s) => (
          <button key={s} type="button" className="fc-btn" aria-label={`Add ${FLOWCHART_SHAPE_LABEL[s].toLowerCase()}`} title={FLOWCHART_SHAPE_LABEL[s]} onClick={() => onAdd(s)}>
            <ShapeIcon shape={s} />
          </button>
        ))}
      </span>
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn fc-btn-text" onClick={onTidy} disabled={!canTidy} title="Tidy up: lay the chart out neatly">
        <WandSparkles size={15} aria-hidden /> Tidy up
      </button>
      {onAi ? (
        <button type="button" className="fc-btn fc-btn-text" aria-pressed={aiOpen} aria-expanded={aiOpen} onClick={onAi} title="Create or change the flowchart with AI">
          <AiIcon size={14} className="fc-ai-mark" /> AI
        </button>
      ) : null}
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={15} aria-hidden />
      </button>
      <button type="button" className="fc-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={15} aria-hidden />
      </button>
    </div>
  );
}

export function ZoomBar({ zoom, onZoomIn, onZoomOut, onFit }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void }) {
  return (
    <div className="fc-bar fc-bar-zoom" role="toolbar" aria-label="Zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="fc-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={onZoomOut}>
        <Minus size={15} aria-hidden />
      </button>
      <span className="fc-zoom" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" className="fc-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={onZoomIn}>
        <Plus size={15} aria-hidden />
      </button>
      <button type="button" className="fc-btn" aria-label="Fit to content" title="Fit to content (⇧1)" onClick={onFit}>
        <Maximize size={14} aria-hidden />
      </button>
    </div>
  );
}

function Swatches({ value, onPick }: { value: FlowColor | null; onPick: (c: FlowColor) => void }) {
  return (
    <span role="group" aria-label="Colour" className="fc-group">
      {FLOWCHART_COLORS.map((c) => (
        <button key={c} type="button" className="fc-swatch" data-color={c} aria-pressed={value === c} aria-label={FLOWCHART_COLOR_LABEL[c]} title={FLOWCHART_COLOR_LABEL[c]} onClick={() => onPick(c)} />
      ))}
    </span>
  );
}

/** Edits the selected shapes. */
export function NodeBar({
  color,
  shape,
  onColor,
  onShape,
  onDuplicate,
  onDelete,
  style,
}: {
  color: FlowColor | null;
  shape: FlowShape | null;
  onColor: (c: FlowColor) => void;
  onShape: (s: FlowShape) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  style: React.CSSProperties;
}) {
  return (
    <div className="fc-bar fc-bar-float" role="toolbar" aria-label="Selected shapes" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <MenuButton
        label="Change shape"
        align="start"
        triggerClassName="fc-btn fc-btn-menu"
        trigger={<ShapeIcon shape={shape ?? "process"} />}
        items={FLOWCHART_SHAPES.map((s) => ({ label: FLOWCHART_SHAPE_LABEL[s], icon: <ShapeIcon shape={s} size={16} />, checked: shape === s, onSelect: () => onShape(s) }))}
      />
      <span className="fc-sep" aria-hidden />
      <Swatches value={color} onPick={onColor} />
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={onDuplicate}>
        <Copy size={14} aria-hidden />
      </button>
      <button type="button" className="fc-btn" aria-label="Delete" title="Delete (⌫)" onClick={onDelete}>
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

const ARROWS: { value: FlowArrow; label: string; d: string }[] = [
  { value: "end", label: "Arrow at the end", d: "M3 10h13M12 6l4 4-4 4" },
  { value: "both", label: "Arrows at both ends", d: "M4 10h12M8 6l-4 4 4 4M12 6l4 4-4 4" },
  { value: "none", label: "No arrows", d: "M3 10h14" },
];

/** Edits the selected connectors. */
export function EdgeBar({
  lineStyle,
  arrow,
  onStyle,
  onArrow,
  onLabel,
  onDelete,
  style,
}: {
  lineStyle: FlowEdgeStyle | null;
  arrow: FlowArrow | null;
  onStyle: (s: FlowEdgeStyle) => void;
  onArrow: (a: FlowArrow) => void;
  onLabel: (() => void) | null;
  onDelete: () => void;
  style: React.CSSProperties;
}) {
  const icon = (d: string, dashed = false) => (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} strokeDasharray={dashed ? "3 3" : undefined} />
    </svg>
  );
  return (
    <div className="fc-bar fc-bar-float" role="toolbar" aria-label="Selected connectors" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <span role="group" aria-label="Line" className="fc-group">
        <button type="button" className="fc-btn" aria-pressed={lineStyle === "solid"} aria-label="Solid line" title="Solid" onClick={() => onStyle("solid")}>
          {icon("M3 10h14")}
        </button>
        <button type="button" className="fc-btn" aria-pressed={lineStyle === "dashed"} aria-label="Dashed line" title="Dashed" onClick={() => onStyle("dashed")}>
          {icon("M3 10h14", true)}
        </button>
      </span>
      <span className="fc-sep" aria-hidden />
      <span role="group" aria-label="Arrows" className="fc-group">
        {ARROWS.map((a) => (
          <button key={a.value} type="button" className="fc-btn" aria-pressed={arrow === a.value} aria-label={a.label} title={a.label} onClick={() => onArrow(a.value)}>
            {icon(a.d)}
          </button>
        ))}
      </span>
      {onLabel ? (
        <>
          <span className="fc-sep" aria-hidden />
          <button type="button" className="fc-btn fc-btn-text" onClick={onLabel} title="Label (Enter)">
            Label
          </button>
        </>
      ) : null}
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn" aria-label="Delete connector" title="Delete (⌫)" onClick={onDelete}>
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}
