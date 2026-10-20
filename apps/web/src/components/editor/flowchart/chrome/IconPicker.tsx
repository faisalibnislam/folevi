"use client";

// Icons for the selected shapes: the flowchart's own icon set (flowchartIcons in the model, so exports and
// share pages draw the same ones), searchable, placed inside the shape beside the text, above it, or as a
// small badge in the corner. Arrow keys move through the grid.
import { useId, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { FLOWCHART_ICON_DEFS, searchFlowIcons, type FlowIconName, type FlowIconPlace } from "../schema";
import { FlowPanel } from "./FlowPanel";

const PLACES: { value: FlowIconPlace; label: string; hint: string }[] = [
  { value: "left", label: "Beside text", hint: "Inside the shape, left of the text" },
  { value: "top", label: "Above text", hint: "Inside the shape, above the text" },
  { value: "badge", label: "Corner", hint: "A small badge in the shape's corner" },
];

/** One of the flowchart's icons, as drawn on the canvas. */
export function FlowIcon({ name, size = 18 }: { name: FlowIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={FLOWCHART_ICON_DEFS[name].d} />
    </svg>
  );
}

const COLUMNS = 6;

export function IconPicker({
  current,
  place,
  onPick,
  onPlace,
  onRemove,
  onClose,
}: {
  /** The selected shapes' icon, when they share one. */
  current: FlowIconName | null;
  place: FlowIconPlace;
  onPick: (name: FlowIconName) => void;
  onPlace: (place: FlowIconPlace) => void;
  /** Removes the icon (null when no selected shape has one). */
  onRemove: (() => void) | null;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const icons = useMemo(() => searchFlowIcons(query), [query]);
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-icon]")];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (!step) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, i + step))]?.focus();
  };
  return (
    <FlowPanel title="Icon" onClose={onClose} className="fc-panel-icons">
      <label className="fc-panel-search">
        <Search size={14} aria-hidden />
        <input
          data-autofocus
          className="fc-input"
          type="text"
          role="searchbox"
          aria-label="Search icons"
          aria-controls={`${id}-grid`}
          placeholder="Search icons"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && icons[0]) {
              e.preventDefault();
              onPick(icons[0]);
            }
          }}
        />
      </label>
      <div className="fc-seg" role="radiogroup" aria-label="Where the icon goes">
        {PLACES.map((p) => (
          <button key={p.value} type="button" role="radio" aria-checked={place === p.value} title={p.hint} className="fc-seg-btn" onClick={() => onPlace(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="fc-panel-scroll">
        {icons.length ? (
          <div id={`${id}-grid`} className="fc-icon-grid" role="group" aria-label="Icons" onKeyDown={onGridKey}>
            {icons.map((name) => (
              <button key={name} type="button" data-icon={name} className="fc-icon-tile" aria-label={FLOWCHART_ICON_DEFS[name].label} aria-pressed={current === name} title={FLOWCHART_ICON_DEFS[name].label} onClick={() => onPick(name)}>
                <FlowIcon name={name} size={20} />
              </button>
            ))}
          </div>
        ) : (
          <p className="fc-panel-empty">No icon matches “{query.trim()}”.</p>
        )}
      </div>
      {onRemove ? (
        <div className="fc-panel-actions">
          <button type="button" className="fc-btn fc-btn-text" onClick={onRemove}>
            <Trash2 size={14} aria-hidden /> Remove icon
          </button>
        </div>
      ) : null}
    </FlowPanel>
  );
}
