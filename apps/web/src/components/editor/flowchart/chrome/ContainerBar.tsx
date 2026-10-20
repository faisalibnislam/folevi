"use client";

// Frames and swimlanes in the chrome: the toolbar's Frame button and Swimlanes menu, and the floating bar for a
// selected frame, pool or lane (rename, colour, add and reorder lanes, delete). Presentational; the actions
// come from interactions/containers.tsx. Neutral chrome: only the swatches carry colour.
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Frame, Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import { MenuButton } from "@/components/ui/Menu";
import { FLOWCHART_COLORS, FLOWCHART_COLOR_LABEL, type FlowBoxKind, type FlowColor, type FlowPoolOrient } from "../schema";

/** The toolbar's buttons: a frame (around the selected shapes when there are some) and swimlanes. */
export function ContainerTools({ framing, onFrame, onSwimlanes }: { framing: boolean; onFrame: () => void; onSwimlanes: (orient: FlowPoolOrient) => void }) {
  return (
    <span role="group" aria-label="Frames and swimlanes" className="fc-group">
      <button type="button" className="fc-btn" aria-label={framing ? "Frame selection" : "Add frame"} title={framing ? "Frame selection (⌥⌘G)" : "Add a frame (⌥⌘G frames the selected shapes)"} onClick={onFrame}>
        <Frame size={15} aria-hidden />
      </button>
      <MenuButton
        label="Add swimlanes"
        align="start"
        triggerClassName="fc-btn"
        trigger={<Rows3 size={15} aria-hidden />}
        items={[
          { label: "Swimlanes in rows", icon: <Rows3 size={14} />, onSelect: () => onSwimlanes("rows") },
          { label: "Swimlanes in columns", icon: <Columns3 size={14} />, onSelect: () => onSwimlanes("columns") },
        ]}
      />
    </span>
  );
}

export interface ContainerBarProps {
  kind: FlowBoxKind;
  /** For a lane: whether its pool's lanes are rows, and whether it can move back or forward. */
  rows?: boolean;
  canBack?: boolean;
  canForward?: boolean;
  color: FlowColor | null;
  onRename: () => void;
  onColor: ((c: FlowColor) => void) | null;
  onAddLane: (() => void) | null;
  onMove: ((dir: -1 | 1) => void) | null;
  onDelete: () => void;
  style: React.CSSProperties;
  /** Wraps onto two rows (a narrow canvas). */
  compact?: boolean;
}

const NOUN: Record<FlowBoxKind, string> = { frame: "frame", pool: "swimlanes", lane: "lane" };

/** Edits the selected frame, pool or lane. */
export function ContainerBar({ kind, rows = true, canBack, canForward, color, onRename, onColor, onAddLane, onMove, onDelete, style, compact = false }: ContainerBarProps) {
  const noun = NOUN[kind];
  return (
    <div className={`fc-bar fc-bar-float${compact ? " fc-bar-wrap" : ""}`} role="toolbar" aria-label={kind === "frame" ? "Selected frame" : kind === "lane" ? "Selected lane" : "Selected swimlanes"} style={style} onPointerDown={(e) => e.stopPropagation()}>
      {compact ? (
        <button type="button" className="fc-btn" aria-label="Rename" onClick={onRename} title="Rename (Enter)">
          <Pencil size={14} aria-hidden />
        </button>
      ) : (
        <button type="button" className="fc-btn fc-btn-text" onClick={onRename} title="Rename (Enter)">
          <Pencil size={13} aria-hidden /> Rename
        </button>
      )}
      {onColor ? (
        <>
          <span className="fc-sep" aria-hidden />
          <span role="group" aria-label="Colour" className="fc-group">
            {FLOWCHART_COLORS.map((c) => (
              <button key={c} type="button" className="fc-swatch" data-color={c} aria-pressed={color === c} aria-label={FLOWCHART_COLOR_LABEL[c]} title={FLOWCHART_COLOR_LABEL[c]} onClick={() => onColor(c)} />
            ))}
          </span>
        </>
      ) : null}
      {onAddLane || onMove ? <span className="fc-sep" aria-hidden /> : null}
      {onAddLane ? (
        <button type="button" className="fc-btn" aria-label="Add lane" title={kind === "lane" ? (rows ? "Add a lane below" : "Add a lane to the right") : "Add a lane"} onClick={onAddLane}>
          <Plus size={15} aria-hidden />
        </button>
      ) : null}
      {onMove ? (
        <>
          <button type="button" className="fc-btn" aria-label={rows ? "Move lane up" : "Move lane left"} title={rows ? "Move up (⌥↑)" : "Move left (⌥←)"} disabled={!canBack} onClick={() => onMove(-1)}>
            {rows ? <ArrowUp size={15} aria-hidden /> : <ArrowLeft size={15} aria-hidden />}
          </button>
          <button type="button" className="fc-btn" aria-label={rows ? "Move lane down" : "Move lane right"} title={rows ? "Move down (⌥↓)" : "Move right (⌥→)"} disabled={!canForward} onClick={() => onMove(1)}>
            {rows ? <ArrowDown size={15} aria-hidden /> : <ArrowRight size={15} aria-hidden />}
          </button>
        </>
      ) : null}
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn" aria-label={`Delete ${noun}`} title="Delete (⌫)" onClick={onDelete}>
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}
