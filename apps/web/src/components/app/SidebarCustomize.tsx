"use client";

import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { LOCKED_SIDEBAR_ITEMS, moveSidebarItem, placeSidebarItem, stepSidebarItem, type SidebarItemId, type SidebarSlot } from "@/lib/app/sidebarLayout";

const DRAG_TYPE = "application/x-folevi-sidebar-item";

/**
 * Customize sidebar: one row per sidebar item this person can see here, checked when it's on the sidebar and
 * unchecked when it's under More, in the sidebar's order. Drag a row (or use its Move up and Move down buttons) to
 * reorder. Home and Drafts are always on the sidebar. Every change is saved as it's made.
 */
export function SidebarCustomize({
  open,
  onClose,
  slots,
  items,
  onChange,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  /** Every item's place, the ones not shown here too (they keep theirs). */
  slots: readonly SidebarSlot[];
  /** The items shown here, by id. */
  items: ReadonlyMap<SidebarItemId, { label: string; icon: React.ReactNode }>;
  onChange: (next: SidebarSlot[]) => void;
  onReset: () => void;
}) {
  const shown = slots.filter((s) => items.has(s.id));
  const shownIds = shown.map((s) => s.id);
  const [dragged, setDragged] = useState<SidebarItemId | null>(null);
  const [over, setOver] = useState<{ id: SidebarItemId; after: boolean } | null>(null);
  // Said to screen readers after a move ("Tasks moved up, 4 of 9").
  const [said, setSaid] = useState("");

  const step = (id: SidebarItemId, by: -1 | 1) => {
    const next = stepSidebarItem(slots, id, by, shownIds);
    onChange(next);
    const at = next.filter((s) => items.has(s.id)).findIndex((s) => s.id === id);
    setSaid(`${items.get(id)!.label} moved ${by < 0 ? "up" : "down"}, ${at + 1} of ${shown.length}`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Customize sidebar"
      description="Checked items show on the sidebar. The rest are under More. Drag to reorder."
      fit
      footer={
        <>
          <Button variant="ghost" onClick={onReset}>
            Reset to default
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <ul aria-label="Sidebar items" className="min-h-0 space-y-0.5 overflow-y-auto" data-testid="sidebar-customize-list">
        {shown.map((s, i) => {
          const item = items.get(s.id)!;
          const locked = LOCKED_SIDEBAR_ITEMS.has(s.id);
          const line = over?.id === s.id && dragged !== s.id ? (over.after ? "after" : "before") : null;
          return (
            <li
              key={s.id}
              data-sidebar-item={s.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, s.id);
                e.dataTransfer.effectAllowed = "move";
                setDragged(s.id);
              }}
              onDragEnd={() => {
                setDragged(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!dragged) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const box = e.currentTarget.getBoundingClientRect();
                setOver({ id: s.id, after: e.clientY > box.top + box.height / 2 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged && over) {
                  onChange(placeSidebarItem(slots, dragged, over.id, over.after));
                  setSaid(`${items.get(dragged)!.label} moved`);
                }
                setDragged(null);
                setOver(null);
              }}
              className={`relative flex h-10 items-center gap-2 rounded-chip pl-1 pr-1 transition-colors hover:bg-[var(--glass-hover)] pointer-coarse:h-11 ${dragged === s.id ? "opacity-50" : ""}`}
            >
              {line ? <span aria-hidden className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-tiny bg-heading ${line === "before" ? "top-0" : "bottom-0"}`} /> : null}
              <span aria-hidden className="grid w-5 flex-none cursor-grab place-items-center text-faint">
                <GripVertical size={14} />
              </span>
              <Checkbox
                checked={!s.more}
                disabled={locked}
                onChange={(on) => onChange(moveSidebarItem(slots, s.id, !on))}
                describedBy={locked ? "sidebar-customize-locked" : undefined}
                className="min-w-0 flex-1 items-center"
              >
                <span className="flex min-w-0 items-center gap-2 text-body text-ink">
                  <span aria-hidden className="text-muted">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                  {locked ? <span className="text-footnote text-faint">Always shown</span> : s.more ? <span className="text-footnote text-faint">Under More</span> : null}
                </span>
              </Checkbox>
              <IconButton label={`Move ${item.label} up`} size="icon-compact" variant="quiet" disabled={i === 0} onClick={() => step(s.id, -1)}>
                <ArrowUp size={14} aria-hidden />
              </IconButton>
              <IconButton label={`Move ${item.label} down`} size="icon-compact" variant="quiet" disabled={i === shown.length - 1} onClick={() => step(s.id, 1)}>
                <ArrowDown size={14} aria-hidden />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <p id="sidebar-customize-locked" className="sr-only">
        Home and Drafts are always on the sidebar.
      </p>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </Dialog>
  );
}
