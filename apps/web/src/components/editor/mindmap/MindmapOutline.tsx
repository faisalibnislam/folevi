"use client";

// The mind map as an outline inside the block: the same ideas as a nested bulleted list, edited in place
// and saved to the same data (so switching back shows the same map). Like a list in a note: Enter adds the
// next idea, Tab and Shift+Tab nest and un-nest, Backspace in an empty idea removes it, the arrows move
// between ideas, ⌘Z undoes. Esc goes back to the block (and Esc again to the note).
import { useLayoutEffect, useRef, useState } from "react";
import { MINDMAP_LIMITS, mindmapColors, mindmapOutline, type MindmapData } from "@folevi/editor-schema";
import { addChild, addSibling, byId, indent, outdent, removeIdeas, setText } from "./ops";

export function MindmapOutline({
  map,
  commit,
  undo,
  redo,
  selected,
  onSelect,
  onExit,
}: {
  map: MindmapData;
  commit: (next: MindmapData, opts?: { key?: string }) => void;
  undo: () => void;
  redo: () => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onExit: () => void;
}) {
  const rows = mindmapOutline(map);
  const colors = mindmapColors(map);
  const listRef = useRef<HTMLUListElement>(null);
  // The idea to focus once the list has redrawn, and where the caret goes in it.
  const [focusAt, setFocusAt] = useState<{ id: string; caret: "end" | "start" } | null>(() => (selected ? { id: selected, caret: "end" } : null));

  useLayoutEffect(() => {
    if (!focusAt) return;
    const input = listRef.current?.querySelector<HTMLInputElement>(`input[data-id="${CSS.escape(focusAt.id)}"]`);
    if (!input) return;
    input.focus({ preventScroll: false });
    const at = focusAt.caret === "end" ? input.value.length : 0;
    input.setSelectionRange(at, at);
    setFocusAt(null);
  }, [focusAt, map]);

  const go = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (r) setFocusAt({ id: r.node.id, caret: "end" });
  };

  return (
    <ul ref={listRef} className="mm-outline" aria-label="Mind map outline">
      {rows.map(({ node, depth }, i) => (
        <li key={node.id} className="mm-outline-row" style={{ paddingLeft: depth * 22 }} data-depth={Math.min(depth, 2)} data-color={colors.get(node.id)}>
          <span className="mm-outline-dot" aria-hidden />
          <input
            data-id={node.id}
            className="mm-outline-input"
            value={node.text}
            placeholder={depth === 0 ? "Central idea" : "Idea"}
            maxLength={MINDMAP_LIMITS.maxText}
            aria-label={depth === 0 ? "Central idea" : `Idea, level ${depth}`}
            aria-current={selected === node.id || undefined}
            onFocus={() => onSelect(node.id)}
            onChange={(e) => commit(setText(map, node.id, e.target.value), { key: `text:${node.id}` })}
            onKeyDown={(e) => {
              const mod = e.metaKey || e.ctrlKey;
              const key = e.key.toLowerCase();
              const input = e.currentTarget;
              const stop = () => {
                e.preventDefault();
                e.stopPropagation();
              };
              if (mod && (key === "z" || key === "y")) {
                stop();
                if (key === "y" || e.shiftKey) redo();
                else undo();
                return;
              }
              if (e.key === "Enter") {
                stop();
                // The centre gets a first idea inside it; any other idea a sibling after it (or before, at its start).
                const atStart = input.selectionStart === 0 && input.selectionEnd === 0 && input.value.length > 0;
                const r = node.parent === null ? addChild(map, node.id) : addSibling(map, node.id, atStart);
                if (r) {
                  commit(r.map);
                  setFocusAt({ id: atStart ? node.id : r.id, caret: atStart ? "start" : "end" });
                }
                return;
              }
              if (e.key === "Tab") {
                stop();
                const next = e.shiftKey ? outdent(map, node.id) : indent(map, node.id);
                if (next !== map) commit(next);
                setFocusAt({ id: node.id, caret: "end" });
                return;
              }
              if (e.key === "Backspace" && !input.value && node.parent !== null && !rows.some((r) => r.node.parent === node.id)) {
                stop();
                commit(removeIdeas(map, [node.id]).map);
                go(i - 1);
                return;
              }
              if (e.key === "ArrowUp" && !e.altKey) {
                stop();
                go(i - 1);
                return;
              }
              if (e.key === "ArrowDown" && !e.altKey) {
                stop();
                go(i + 1);
                return;
              }
              if (e.key === "Escape") {
                stop();
                onExit();
                return;
              }
              // Everything else is typing: keep it from the canvas and the note.
              e.stopPropagation();
            }}
          />
          {byId(map, node.id)?.collapsed ? <span className="mm-outline-folded">collapsed</span> : null}
        </li>
      ))}
    </ul>
  );
}
