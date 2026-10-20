"use client";

// The compact shape picker that opens where a connector (or a quick add arrow) was let go on empty canvas:
// a search box over the shape library, the shapes used most recently first. Arrow keys move, Enter picks,
// Esc closes; a press anywhere else closes it too (interactions/quickAdd.tsx).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FLOWCHART_SHAPES, FLOWCHART_SHAPE_INFO, FLOWCHART_SHAPE_LABEL, searchFlowShapes, shapeDetailPath, shapePath, type FlowShape } from "../schema";

const RECENT_KEY = "folevi.flowchart.recentShapes";
const RECENT_MAX = 5;
const DEFAULT_RECENT: FlowShape[] = ["process", "decision", "terminator"];

/** The shapes picked most recently on this device (a convenience: it falls back to the common ones). */
export function recentShapes(): FlowShape[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "null") as unknown;
    if (Array.isArray(raw)) {
      const valid = raw.filter((s): s is FlowShape => typeof s === "string" && (FLOWCHART_SHAPES as readonly string[]).includes(s));
      if (valid.length) return valid.slice(0, RECENT_MAX);
    }
  } catch {
    // Storage blocked (private window): the defaults.
  }
  return [...DEFAULT_RECENT];
}

export function rememberShape(shape: FlowShape): void {
  try {
    const next = [shape, ...recentShapes().filter((s) => s !== shape)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not remembered: fine.
  }
}

/** Any shape's outline at its own size, scaled into a small square (the library's geometry, as on the canvas). */
export function MiniShape({ shape, size = 20 }: { shape: FlowShape; size?: number }) {
  const { w, h } = FLOWCHART_SHAPE_INFO[shape];
  const side = Math.max(w, h) * 1.12;
  const box = { shape, x: 0, y: 0, w, h };
  const details = shapeDetailPath(box);
  return (
    <svg width={size} height={size} viewBox={`${(w - side) / 2} ${(h - side) / 2} ${side} ${side}`} aria-hidden className="fc-mini-shape">
      <path d={shapePath(box)} />
      {details ? <path d={details} className="fc-mini-detail" /> : null}
    </svg>
  );
}

export function ShapePicker({ left, top, maxHeight, onPick, onClose }: { left: number; top: number; maxHeight: number; onPick: (shape: FlowShape) => void; onClose: (refocus: boolean) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const recent = useMemo(() => recentShapes(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    if (query.trim()) return [{ heading: null as string | null, shapes: searchFlowShapes(query) }];
    return [
      { heading: "Recent", shapes: recent },
      { heading: "All shapes", shapes: FLOWCHART_SHAPES.filter((s) => !recent.includes(s)) },
    ];
  }, [query, recent]);
  const options = sections.flatMap((s) => s.shapes);
  const current = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  // Keeps the active row in view by scrolling the list only (scrollIntoView would also scroll the canvas).
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [current]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const n = options.length;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (n) setActive((current + 1) % n);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      if (n) setActive((current - 1 + n) % n);
    } else if (e.key === "Home" && !query) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && !query) {
      e.preventDefault();
      setActive(Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = options[current];
      if (s) onPick(s);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
    }
  };

  let index = 0;
  return (
    <div
      className="fc-picker ui-pop"
      role="dialog"
      aria-label="Choose a shape"
      style={{ left, top, maxHeight }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose(false);
      }}
    >
      <input
        ref={inputRef}
        className="fc-picker-search"
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={`${id}-list`}
        aria-activedescendant={options.length ? `${id}-${current}` : undefined}
        aria-autocomplete="list"
        aria-label="Search shapes"
        placeholder="Search shapes"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Shapes" className="fc-picker-list">
        {options.length ? (
          sections.map((sec) =>
            sec.shapes.length ? (
              <div key={sec.heading ?? "results"} role="group" aria-label={sec.heading ?? "Results"}>
                {sec.heading ? (
                  <div aria-hidden className="fc-picker-head">
                    {sec.heading}
                  </div>
                ) : null}
                {sec.shapes.map((s) => {
                  const i = index++;
                  return (
                    <div
                      key={s}
                      id={`${id}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === current}
                      className="fc-picker-option"
                      onPointerMove={() => i !== current && setActive(i)}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onPick(s)}
                    >
                      <MiniShape shape={s} />
                      <span>{FLOWCHART_SHAPE_LABEL[s]}</span>
                    </div>
                  );
                })}
              </div>
            ) : null,
          )
        ) : (
          <p className="fc-picker-none">No shape matches</p>
        )}
      </div>
    </div>
  );
}
