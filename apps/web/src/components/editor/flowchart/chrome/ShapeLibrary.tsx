"use client";

// The shape library: every flowchart and basic shape, searchable, in three sections (Flowchart, Basic,
// Arrows and callouts). Click (or Enter) adds the shape in the middle of the view, or drags it out onto the
// canvas to drop it where it should go; opened from a selected shape's bar it changes the selected shapes'
// kind instead. Arrow keys move between shapes.
import { useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { FLOWCHART_SHAPE_INFO, FLOWCHART_SHAPE_LABEL, shapeBackPaths, shapeDetailPath, shapePath, type FlowShape } from "../schema";
import { FlowPanel } from "./FlowPanel";
import { librarySections } from "./librarySections";

/** A shape drawn from the model's geometry, fitted in a small box (the library's tiles, menus, drag ghosts). */
export function ShapeThumb({ shape, width = 40, height = 30, className = "fc-thumb" }: { shape: FlowShape; width?: number; height?: number; className?: string }) {
  const info = FLOWCHART_SHAPE_INFO[shape];
  const pad = 2;
  const s = Math.min((width - pad * 2) / info.w, (height - pad * 2) / info.h);
  const w = info.w * s;
  const h = info.h * s;
  const box = { shape, x: (width - w) / 2, y: (height - h) / 2, w, h };
  const details = shapeDetailPath(box);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={className} data-shape={shape}>
      {shapeBackPaths(box).map((d, i) => (
        <path key={i} d={d} className="fc-thumb-shape" />
      ))}
      <path d={shapePath(box)} className={shape === "text" || shape === "annotation" ? "fc-thumb-bare" : "fc-thumb-shape"} />
      {details ? <path d={details} className="fc-thumb-detail" /> : null}
      {shape === "text" ? (
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" className="fc-thumb-text">
          Aa
        </text>
      ) : null}
    </svg>
  );
}

const COLUMNS = 4;

export function ShapeLibrary({
  mode,
  current,
  onPick,
  onDragOut,
  onClose,
}: {
  /** "add" puts a new shape on the canvas; "change" changes the selected shapes' kind. */
  mode: "add" | "change";
  /** The selected shapes' kind (change mode), shown as chosen. */
  current?: FlowShape | null;
  onPick: (shape: FlowShape) => void;
  /** A tile dragged out of the panel with a mouse or pen: the shape and the pointer, until it's let go. */
  onDragOut?: (shape: FlowShape, e: React.PointerEvent) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const sections = useMemo(() => librarySections(query), [query]);
  const listRef = useRef<HTMLDivElement>(null);

  // Arrow keys move through the tiles as a grid (rows of four within each section, then on to the next).
  const onGridKey = (e: React.KeyboardEvent) => {
    const tiles = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-tile]") ?? [])];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const sec = (el: HTMLElement) => Number(el.dataset.section);
    const col = (el: HTMLElement) => Number(el.dataset.col);
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(tiles.length - 1, i + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const down = e.key === "ArrowDown";
      const me = tiles[i]!;
      // The tile in the same column on the next (or previous) row, else the nearest one there.
      const rows = tiles.map((t, j) => ({ j, row: sec(t) * 1000 + Math.floor(Number(t.dataset.index) / COLUMNS), col: col(t) }));
      const myRow = rows[i]!.row;
      const target = down ? rows.find((r) => r.row > myRow)?.row : [...rows].reverse().find((r) => r.row < myRow)?.row;
      if (target === undefined) next = down ? tiles.length - 1 : 0;
      else {
        const inRow = rows.filter((r) => r.row === target);
        next = (inRow.find((r) => r.col === col(me)) ?? inRow[inRow.length - 1]!).j;
      }
    } else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tiles.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tiles[next]?.focus();
  };

  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <FlowPanel title={mode === "add" ? "Shapes" : "Change shape"} onClose={onClose} className="fc-panel-library">
      <label className="fc-panel-search">
        <Search size={14} aria-hidden />
        <input
          ref={searchRef}
          data-autofocus
          className="fc-input"
          type="text"
          role="searchbox"
          aria-label="Search shapes"
          aria-controls={`${id}-list`}
          placeholder="Search shapes"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              listRef.current?.querySelector<HTMLButtonElement>("[data-tile]")?.focus();
            } else if (e.key === "Enter") {
              const first = sections[0]?.shapes[0];
              if (first) {
                e.preventDefault();
                onPick(first);
              }
            }
          }}
        />
      </label>
      <div ref={listRef} id={`${id}-list`} className="fc-panel-scroll" onKeyDown={onGridKey}>
        {sections.length ? (
          sections.map((sec, si) => (
            <section key={sec.id} aria-labelledby={`${id}-${sec.id}`} className="fc-lib-section">
              <h4 id={`${id}-${sec.id}`} className="fc-panel-heading">
                {sec.label}
              </h4>
              <div className="fc-lib-grid" role="group" aria-labelledby={`${id}-${sec.id}`}>
                {sec.shapes.map((s, i) => (
                  <Tile key={s} shape={s} index={i} section={si} chosen={mode === "change" && current === s} mode={mode} onPick={onPick} onDragOut={onDragOut} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className="fc-panel-empty">
            No shape matches “{query.trim()}”.{" "}
            <button
              type="button"
              className="fc-link-btn"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              Show all
            </button>
          </p>
        )}
      </div>
      {mode === "add" ? <p className="fc-panel-foot">Click to add, or drag a shape onto the canvas.</p> : null}
    </FlowPanel>
  );
}

function Tile({
  shape,
  index,
  section,
  chosen,
  mode,
  onPick,
  onDragOut,
}: {
  shape: FlowShape;
  index: number;
  section: number;
  chosen: boolean;
  mode: "add" | "change";
  onPick: (shape: FlowShape) => void;
  onDragOut?: (shape: FlowShape, e: React.PointerEvent) => void;
}) {
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const dragged = useRef(false);
  const label = FLOWCHART_SHAPE_LABEL[shape];
  return (
    <button
      type="button"
      className="fc-lib-tile"
      data-tile=""
      data-index={index}
      data-section={section}
      data-col={index % COLUMNS}
      data-shape={shape}
      aria-label={mode === "add" ? `Add ${label.toLowerCase()}` : label}
      aria-pressed={mode === "change" ? chosen : undefined}
      title={label}
      onPointerDown={(e) => {
        if (!onDragOut || e.pointerType === "touch" || e.button !== 0) return;
        press.current = { x: e.clientX, y: e.clientY, dragged: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || !onDragOut) return;
        if (!p.dragged && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
        p.dragged = true;
        onDragOut(shape, e);
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p?.dragged) return;
        dragged.current = true;
        onDragOut?.(shape, e);
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onClick={() => {
        // A drag that ended isn't a click as well.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onPick(shape);
      }}
    >
      <ShapeThumb shape={shape} />
      <span className="fc-lib-name">{label}</span>
    </button>
  );
}
