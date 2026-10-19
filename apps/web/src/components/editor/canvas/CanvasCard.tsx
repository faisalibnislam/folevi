"use client";

// The shell the visual blocks (mind map, sticky notes, chart, wireframe) are drawn in: a card in the note
// with the block's own glass toolbar (its name, its tools, Export and Full canvas), the canvas area, an
// empty-state hint, and a height handle. Full canvas (canvas/useFullCanvas.ts) lifts it over the window:
// ⇧⌘F or the toolbar's button, Esc back. Esc in the note's card hands the keyboard back to the note, with
// the block selected. Each block puts its editor in `children` and its tools in `tools`. Styles: canvas.css.
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Expand, Shrink } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { BlockExportMenu } from "./BlockExport";
import { useFullCanvas, type FullCanvas } from "./useFullCanvas";

const HEIGHT_STEP = 40;

export interface CanvasCardProps {
  /** The node view's props (the node, selection, editor and position). */
  view: ReactNodeViewProps;
  /** Block type, for classes (`fb-<type>`) and export. */
  type: string;
  /** The block's name ("Mind map"), shown in its toolbar and read out. */
  name: string;
  icon: ReactNode;
  /** Height limits in the note (LIMITS.min/max<Type>Height) and the default height. */
  minHeight: number;
  maxHeight: number;
  defaultHeight: number;
  /** Nothing in the block yet: the hint shows over the canvas. */
  empty: boolean;
  /** Nothing to export, when that differs from `empty` (a block that draws its own empty state). */
  blank?: boolean;
  hint: ReactNode;
  /** The block's own tools, before Export and Full canvas. */
  tools?: ReactNode;
  /** The block's editor or drawing; given the full canvas state (to fit content on a change, say). */
  children?: ReactNode | ((full: FullCanvas, height: number) => ReactNode);
  /** Runs a frame after full canvas turns on or off (fit the content to the new size). */
  onRefit?: (full: boolean) => void;
  /** The block's own keys first; return true when one was used. */
  onKey?: (e: React.KeyboardEvent<HTMLDivElement>) => boolean;
}

/** Clamps a stored height into the block's range (bad or missing values read as the default). */
export const clampHeight = (h: unknown, min: number, max: number, fallback: number) => {
  const n = Number(h);
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(n) && n > 0 ? n : fallback)));
};

export function CanvasCard({ view, type, name, icon, minHeight, maxHeight, defaultHeight, empty, blank = empty, hint, tools, children, onRefit, onKey }: CanvasCardProps) {
  const { node, selected, editor, getPos, updateAttributes } = view;
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const fullCanvas = useFullCanvas({ cardRef, focusRef: bodyRef, onRefit });
  const { full, toggleFull, cardProps, handleKey } = fullCanvas;
  const savedHeight = clampHeight(node.attrs.height, minHeight, maxHeight, defaultHeight);
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  const height = liveHeight ?? savedHeight;
  const editable = editor.isEditable;

  const exitToNote = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.closest(".fb-vc-bar")) return;
    if (onKey?.(e)) return;
    if (handleKey(e)) return;
    if (e.key === "Escape" && !full) {
      e.preventDefault();
      e.stopPropagation();
      exitToNote();
    }
  };

  // Height: drag the bottom edge, or focus it and use the arrow keys.
  const resizing = useRef<{ startY: number; startH: number } | null>(null);
  const clampH = (h: number) => Math.round(Math.max(minHeight, Math.min(maxHeight, h)));
  const commitHeight = (h: number) => {
    setLiveHeight(null);
    if (h !== savedHeight) updateAttributes({ height: h });
  };

  return (
    <NodeViewWrapper className={`fb-atom fb-${type} ${selected ? "fb-atom-selected" : ""}`} aria-label={name}>
      <div ref={cardRef} contentEditable={false} className="fb-vcard fb-canvas-card" data-active={active || undefined} {...cardProps} aria-label={full ? `${name}, full canvas` : undefined}>
        <div
          ref={bodyRef}
          className="fb-vcard-body fb-canvas-body"
          style={{ height: full ? undefined : height }}
          tabIndex={0}
          role="group"
          aria-label={name}
          onKeyDown={onKeyDown}
          onFocus={() => setActive(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
          }}
        >
          {typeof children === "function" ? children(fullCanvas, height) : children}
          {empty ? (
            <div className="fb-vc-empty">
              <p>{hint}</p>
            </div>
          ) : null}
          <div className="fb-vc-bar" role="toolbar" aria-label={`${name} tools`} onPointerDown={(e) => e.stopPropagation()}>
            <span className="fb-vc-title">
              <span className="fb-vc-icon" aria-hidden>
                {icon}
              </span>
              {name}
            </span>
            {tools ? (
              <>
                <span className="fb-vc-sep" aria-hidden />
                {tools}
              </>
            ) : null}
            <span className="fb-vc-spacer" aria-hidden />
            <BlockExportMenu type={type} attrs={() => node.attrs} empty={blank || undefined} triggerClassName="fb-vc-btn" />
            <button type="button" className="fb-vc-btn" aria-pressed={full} aria-label={full ? "Exit full canvas" : "Full canvas"} title={full ? "Exit full canvas (Esc)" : "Full canvas (⇧⌘F)"} onClick={() => toggleFull()}>
              {full ? <Shrink size={14} aria-hidden /> : <Expand size={14} aria-hidden />}
            </button>
          </div>
        </div>
        {editable ? (
          <div
            className="fb-wb-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label={`${name} height`}
            aria-valuemin={minHeight}
            aria-valuemax={maxHeight}
            aria-valuenow={height}
            tabIndex={0}
            title="Drag to resize (or use the arrow keys)"
            onKeyDown={(e) => {
              const delta = e.key === "ArrowDown" ? HEIGHT_STEP : e.key === "ArrowUp" ? -HEIGHT_STEP : 0;
              if (!delta) return;
              e.preventDefault();
              commitHeight(clampH(height + delta));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              resizing.current = { startY: e.clientY, startH: height };
            }}
            onPointerMove={(e) => {
              const r = resizing.current;
              if (!r) return;
              setLiveHeight(clampH(r.startH + (e.clientY - r.startY)));
            }}
            onPointerUp={() => {
              if (!resizing.current) return;
              resizing.current = null;
              commitHeight(height);
            }}
            onPointerCancel={() => {
              resizing.current = null;
              setLiveHeight(null);
            }}
          >
            <span aria-hidden />
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
