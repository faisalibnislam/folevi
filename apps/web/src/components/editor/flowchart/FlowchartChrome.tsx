"use client";

// The flowchart canvas's floating controls: the shape toolbar, zoom, and the bar that edits the selected
// shapes (colour, shape; chrome/ConnectorBar.tsx edits connectors). Neutral glass chrome; only the swatches
// carry colour.
import { Copy, Expand, Maximize, Minus, Plus, Redo2, Shrink, Trash2, Undo2, Type, WandSparkles } from "lucide-react";
import {
  FLOWCHART_COLORS,
  FLOWCHART_COLOR_LABEL,
  FLOWCHART_QUICK_SHAPES,
  FLOWCHART_SHAPE_LABEL,
  type FlowColor,
  type FlowShape,
} from "./schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { MenuButton } from "@/components/ui/Menu";
import { ShapeThumb } from "./chrome/ShapeLibrary";

/** A small outline of each shape for buttons and menus. */
export function ShapeIcon({ shape, size = 18 }: { shape: FlowShape; size?: number }) {
  // The library's other shapes are drawn from their own geometry.
  if (!(FLOWCHART_QUICK_SHAPES as readonly string[]).includes(shape)) return <ShapeThumb shape={shape} width={size} height={size} className="fc-shape-icon" />;
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
  library,
  onTidy,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  canTidy,
  onAi,
  aiOpen,
  exportMenu,
  containers,
  tidyControl,
  checkControl,
}: {
  onAdd: (shape: FlowShape) => void;
  /** The shape library button (interactions/content.tsx), after the quick shapes. */
  library?: React.ReactNode;
  onTidy: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canTidy: boolean;
  onAi: (() => void) | null;
  aiOpen: boolean;
  /** The Export menu (PNG, SVG, PDF, Copy as image), at the end of the bar. */
  exportMenu?: React.ReactNode;
  /** Frame and swimlane buttons (chrome/ContainerBar.tsx), after the shapes. */
  containers?: React.ReactNode;
  /** Tidy up with its layout options (chrome/TidyControl.tsx), in place of the plain Tidy up button. */
  tidyControl?: React.ReactNode;
  /** The Check button (chrome/CheckPanel.tsx), after Foli AI. */
  checkControl?: React.ReactNode;
}) {
  return (
    <div className="fc-bar fc-bar-main" role="toolbar" aria-label="Flowchart tools" onPointerDown={(e) => e.stopPropagation()}>
      <span role="group" aria-label="Add a shape" className="fc-group">
        {FLOWCHART_QUICK_SHAPES.map((s) => (
          <button key={s} type="button" className="fc-btn" aria-label={`Add ${FLOWCHART_SHAPE_LABEL[s].toLowerCase()}`} title={FLOWCHART_SHAPE_LABEL[s]} onClick={() => onAdd(s)}>
            <ShapeIcon shape={s} />
          </button>
        ))}
        {library}
      </span>
      {containers ? (
        <>
          <span className="fc-sep" aria-hidden />
          {containers}
        </>
      ) : null}
      <span className="fc-sep" aria-hidden />
      {tidyControl ?? (
        <button type="button" className="fc-btn fc-btn-text" onClick={onTidy} disabled={!canTidy} title="Tidy up: lay the chart out neatly">
          <WandSparkles size={15} aria-hidden /> Tidy up
        </button>
      )}
      {onAi ? (
        <button type="button" className="fc-btn fc-btn-text" aria-pressed={aiOpen} aria-expanded={aiOpen} onClick={onAi} title="Create or change the flowchart with AI">
          <AiIcon size={14} className="fc-ai-mark" /> AI
        </button>
      ) : null}
      {checkControl}
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={15} aria-hidden />
      </button>
      <button type="button" className="fc-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={15} aria-hidden />
      </button>
      {exportMenu ? (
        <>
          <span className="fc-sep" aria-hidden />
          {exportMenu}
        </>
      ) : null}
    </div>
  );
}

export function ZoomBar({ zoom, onZoomIn, onZoomOut, onFit, full, onFull }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; full: boolean; onFull: () => void }) {
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
      <button type="button" className="fc-btn" aria-pressed={full} aria-label={full ? "Exit full canvas" : "Full canvas"} title={full ? "Exit full canvas (Esc)" : "Full canvas (⇧⌘F)"} onClick={onFull}>
        {full ? <Shrink size={14} aria-hidden /> : <Expand size={14} aria-hidden />}
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
  onShapeLibrary,
  libraryOpen,
  content,
  compact,
  onDuplicate,
  onDelete,
  style,
  align,
}: {
  color: FlowColor | null;
  shape: FlowShape | null;
  onColor: (c: FlowColor) => void;
  onShape: (s: FlowShape) => void;
  /** Opens the shape library to change the kind (instead of the quick shape menu). */
  onShapeLibrary?: () => void;
  libraryOpen?: boolean;
  /** Colours, icon, image, note, page link, text size (chrome/ContentTools.tsx). */
  content?: React.ReactNode;
  /** A narrow canvas: the colour swatches give way (Colours has them all). */
  compact?: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  style: React.CSSProperties;
  /** Align and distribute (chrome/AlignMenu.tsx), with several shapes selected. */
  align?: React.ReactNode;
}) {
  return (
    <div className="fc-bar fc-bar-float" role="toolbar" aria-label="Selected shapes" style={style} onPointerDown={(e) => e.stopPropagation()}>
      {onShapeLibrary ? (
        <button type="button" className="fc-btn fc-btn-menu" aria-label="Change shape" aria-expanded={libraryOpen ?? false} title={shape ? `${FLOWCHART_SHAPE_LABEL[shape]}: change shape` : "Change shape"} onClick={onShapeLibrary}>
          <ShapeIcon shape={shape ?? "process"} />
        </button>
      ) : (
        <MenuButton
          label="Change shape"
          align="start"
          triggerClassName="fc-btn fc-btn-menu"
          trigger={<ShapeIcon shape={shape ?? "process"} />}
          items={FLOWCHART_QUICK_SHAPES.map((s) => ({ label: FLOWCHART_SHAPE_LABEL[s], icon: <ShapeIcon shape={s} size={16} />, checked: shape === s, onSelect: () => onShape(s) }))}
        />
      )}
      {compact ? null : (
        <>
          <span className="fc-sep" aria-hidden />
          <Swatches value={color} onPick={onColor} />
        </>
      )}
      {content ? (
        <>
          <span className="fc-sep" aria-hidden />
          {content}
        </>
      ) : null}
      {align ? (
        <>
          <span className="fc-sep" aria-hidden />
          {align}
        </>
      ) : null}
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
