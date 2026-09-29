"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../ui";
import { DemoCard, LiveRegion } from "./DemoCard";

type Item = { id: string; text: string; depth: number };

const MAX_DEPTH = 3;

const INITIAL: Item[] = [
  { id: "a", text: "Opening: the empty desk", depth: 0 },
  { id: "b", text: "Three small examples", depth: 0 },
  { id: "c", text: "The margin note", depth: 1 },
  { id: "d", text: "The index card", depth: 0 },
  { id: "e", text: "Closing: return to the page", depth: 0 },
  { id: "f", text: "Why tools should stay quiet", depth: 0 },
];

/** Index just past the block's subtree (the block plus every following deeper block). */
function subtreeEnd(items: Item[], index: number): number {
  const depth = items[index]!.depth;
  let end = index + 1;
  while (end < items.length && items[end]!.depth > depth) end++;
  return end;
}

/** Ensure every block is at most one level deeper than the one before it. */
function normalize(items: Item[]): Item[] {
  let prev = -1;
  return items.map((item) => {
    const depth = Math.max(0, Math.min(item.depth, prev + 1, MAX_DEPTH));
    prev = depth;
    return depth === item.depth ? item : { ...item, depth };
  });
}

/** Move the block at `from` (with its children) so that it starts at insertion index `to` of the original list. */
function moveTo(items: Item[], from: number, to: number): Item[] {
  const end = subtreeEnd(items, from);
  if (to >= from && to <= end) return items;
  const chunk = items.slice(from, end);
  const rest = [...items.slice(0, from), ...items.slice(end)];
  const at = to > from ? to - chunk.length : to;
  const prevDepth = at > 0 ? rest[at - 1]!.depth : -1;
  const first = chunk[0]!;
  const delta = Math.min(first.depth, prevDepth + 1) - first.depth;
  const moved = chunk.map((item) => ({ ...item, depth: item.depth + delta }));
  return normalize([...rest.slice(0, at), ...moved, ...rest.slice(at)]);
}

function previousSibling(items: Item[], index: number): number {
  const depth = items[index]!.depth;
  for (let j = index - 1; j >= 0; j--) {
    if (items[j]!.depth === depth) return j;
    if (items[j]!.depth < depth) return -1;
  }
  return -1;
}

function nextSibling(items: Item[], index: number): number {
  const end = subtreeEnd(items, index);
  return end < items.length && items[end]!.depth === items[index]!.depth ? end : -1;
}

function parentOf(items: Item[], index: number): Item | undefined {
  const depth = items[index]!.depth;
  for (let j = index - 1; j >= 0; j--) if (items[j]!.depth < depth) return items[j];
  return undefined;
}

export function ShapeDemo() {
  const [items, setItems] = useState<Item[]>(INITIAL);
  const [selectedId, setSelectedId] = useState("d");
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const selected = items[index]!;
  const canUp = previousSibling(items, index) >= 0;
  const canDown = nextSibling(items, index) >= 0;
  const canIndent = previousSibling(items, index) >= 0 && selected.depth < MAX_DEPTH;
  const canOutdent = selected.depth > 0;

  const describe = (list: Item[], id: string) => {
    const i = list.findIndex((item) => item.id === id);
    const parent = parentOf(list, i);
    return `${i + 1} of ${list.length}${parent ? `, nested under “${parent.text}”` : ", top level"}`;
  };

  const apply = (next: Item[], verb: string) => {
    if (next === items) return;
    setItems(next);
    setMessage(`${verb} “${selected.text}”. Now ${describe(next, selected.id)}.`);
  };

  const moveUp = () => {
    const prev = previousSibling(items, index);
    if (prev >= 0) apply(moveTo(items, index, prev), "Moved up");
  };
  const moveDown = () => {
    const next = nextSibling(items, index);
    if (next >= 0) apply(moveTo(items, index, subtreeEnd(items, next)), "Moved down");
  };
  const shift = (delta: 1 | -1) => {
    if (delta === 1 && !canIndent) return;
    if (delta === -1 && !canOutdent) return;
    const end = subtreeEnd(items, index);
    const next = normalize(items.map((item, i) => (i >= index && i < end ? { ...item, depth: item.depth + delta } : item)));
    apply(next, delta === 1 ? "Nested" : "Outdented");
  };

  const focusRow = (id: string) => rowRefs.current.get(id)?.focus();

  const onRowKey = (event: KeyboardEvent<HTMLLIElement>, i: number) => {
    const item = items[i]!;
    if (event.altKey && event.shiftKey) {
      const actions: Record<string, () => void> = {
        ArrowUp: moveUp,
        ArrowDown: moveDown,
        ArrowRight: () => shift(1),
        ArrowLeft: () => shift(-1),
      };
      const action = actions[event.key];
      if (action && item.id === selectedId) {
        event.preventDefault();
        action();
        requestAnimationFrame(() => focusRow(item.id));
      }
      return;
    }
    let target = -1;
    if (event.key === "ArrowDown") target = Math.min(items.length - 1, i + 1);
    else if (event.key === "ArrowUp") target = Math.max(0, i - 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = items.length - 1;
    if (target >= 0) {
      event.preventDefault();
      const id = items[target]!.id;
      setSelectedId(id);
      focusRow(id);
    }
  };

  // Pointer drag on the handle: works for mouse, pen and touch.
  const dropIndexAt = (clientY: number): number => {
    for (let i = 0; i < items.length; i++) {
      const el = rowRefs.current.get(items[i]!.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return items.length;
  };
  const onPointerDown = (event: PointerEvent<HTMLSpanElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(id);
    setDrag({ id, target: items.findIndex((item) => item.id === id) });
  };
  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const target = dropIndexAt(event.clientY);
    if (target !== drag.target) setDrag({ ...drag, target });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const from = items.findIndex((item) => item.id === drag.id);
    const next = moveTo(items, from, drag.target);
    setDrag(null);
    if (next !== items) {
      setItems(next);
      const moved = next.find((item) => item.id === drag.id)!;
      setMessage(`Moved “${moved.text}”. Now ${describe(next, drag.id)}.`);
    }
  };

  const reset = () => {
    setItems(INITIAL);
    setSelectedId("d");
    setMessage("Demo reset.");
  };

  const dragFrom = drag ? items.findIndex((item) => item.id === drag.id) : -1;
  const dragEnd = drag ? subtreeEnd(items, dragFrom) : -1;
  const showIndicator = (i: number) => drag !== null && drag.target === i && !(i >= dragFrom && i <= dragEnd);

  const posInSet = (i: number) => {
    const depth = items[i]!.depth;
    let pos = 1;
    for (let j = i - 1; j >= 0 && items[j]!.depth >= depth; j--) if (items[j]!.depth === depth) pos++;
    let size = pos;
    for (let j = i + 1; j < items.length && items[j]!.depth >= depth; j++) if (items[j]!.depth === depth) size++;
    return { pos, size };
  };

  return (
    <DemoCard title="Essay: On quiet tools" onReset={reset}>
      <div className="px-3 pb-2 pt-4 sm:px-4">
        <ul role="tree" aria-label="Essay outline" className="relative select-none">
          {items.map((item, i) => {
            const isSelected = item.id === selectedId;
            const dragging = drag !== null && i >= dragFrom && i < dragEnd;
            const { pos, size } = posInSet(i);
            return (
              <li
                key={item.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(item.id, node);
                  else rowRefs.current.delete(item.id);
                }}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-posinset={pos}
                aria-setsize={size}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onFocus={() => setSelectedId(item.id)}
                onClick={() => setSelectedId(item.id)}
                onKeyDown={(event) => onRowKey(event, i)}
                className={cx(
                  "relative flex h-11 cursor-default items-center gap-1 rounded-[6px] pr-3 text-[15px] transition-[background-color,opacity] duration-150",
                  isSelected ? "bg-(--color-selection) text-(--color-heading)" : "text-ink hover:bg-sunken",
                  dragging && "opacity-45",
                )}
                style={{ paddingLeft: 4 + item.depth * 26 }}
              >
                {showIndicator(i) ? <span aria-hidden="true" className="absolute -top-[2px] left-2 right-2 h-[3px] rounded-full bg-(--color-heading)" /> : null}
                {Array.from({ length: item.depth }, (_, level) => (
                  <span key={level} aria-hidden="true" className="absolute inset-y-0 w-px bg-line-strong/70" style={{ left: 22 + level * 26 }} />
                ))}
                <span
                  aria-hidden="true"
                  title="Drag to move"
                  onPointerDown={(event) => onPointerDown(event, item.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => setDrag(null)}
                  className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-[6px] text-faint hover:bg-sunken hover:text-muted active:cursor-grabbing"
                >
                  <Icon name="grip" size={16} />
                </span>
                <span aria-hidden="true" className={cx("mr-2 inline-block size-[6px] shrink-0 rounded-full", item.depth === 0 ? "bg-ink/80" : "border border-ink/70")} />
                <span className="truncate">{item.text}</span>
              </li>
            );
          })}
          {showIndicator(items.length) ? <li aria-hidden="true" className="mx-2 h-[3px] rounded-full bg-(--color-heading)" /> : null}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t mk-hair bg-(--mk-well) px-3 py-2.5 sm:px-4" role="toolbar" aria-label="Move the selected block">
        <p className="mr-auto hidden min-w-0 truncate pl-1 text-[12.5px] text-muted sm:block">
          <span className="sr-only">Selected: </span>
          {selected.text}
        </p>
        <ToolButton icon="arrow-up" label="Move up" disabled={!canUp} onClick={moveUp} />
        <ToolButton icon="arrow-down" label="Move down" disabled={!canDown} onClick={moveDown} />
        <ToolButton icon="outdent" label="Outdent" disabled={!canOutdent} onClick={() => shift(-1)} />
        <ToolButton icon="indent" label="Nest" disabled={!canIndent} onClick={() => shift(1)} />
      </div>
      <LiveRegion message={message} />
    </DemoCard>
  );
}

function ToolButton({ icon, label, disabled, onClick }: { icon: IconName; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label} selected block`}
      title={label}
      className="mk-btn mk-btn-secondary h-11 min-w-11 gap-1.5 px-3 text-[13px] font-medium disabled:pointer-events-none disabled:opacity-40 sm:h-8 sm:min-w-8"
    >
      <Icon name={icon} size={16} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
