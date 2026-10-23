"use client";

// Dropping notes and folders on folders, wherever they show: the sidebar's tree (into a folder, or on a line
// between two to reorder; a folder dragged out of its parent onto a line at another level, or onto "Move to the
// top level", leaves it), Drafts, the folder cards of the Folders page and the folder chips of a folder's page.
// Targets only carry data attributes; this layer reads the pointer for all of them, once per window:
//   data-drop-folder="<id>"  a folder ("" is Drafts, which takes notes; "@top" the top level, which takes folders)
//   data-drop-name           what the toast calls it
//   data-drop-key            which highlight it is, when the same folder shows twice (a card and its sidebar row)
//   data-drop-tree           a sidebar row: its top and bottom quarters are lines before and after it
//   data-drop-open="1"       the row's subfolders show under it; data-drop-closed="1": it has some, hidden
//   data-drop-expand         hovering here while dragging presses it (the folder list's "+N more")
//   data-drag-scroll         a list that scrolls when the pointer nears its top or bottom edge
// A mouse drags the browser's own way (HTML5 drag and drop: in the Mac app the same drag also drops notes in
// Finder), except from search results, which this layer carries itself (startPointerDrag). A finger presses and holds (the menu opens as on iOS) and then moves: the menu gives way and what was
// held follows the finger (lib/touchContextMenu.ts sends the move). Every move goes through the outbox, so it
// shows at once, syncs (account, local library and encrypted spaces alike) and has one Undo in its toast.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MAX_FOLDER_DEPTH } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useFolderActions, useFolderTree, useOpenFolders } from "@/lib/app/folders";
import { POINTER_DRAG_EVENT, beginDrag, dragState, endDrag, setDropHint, type DragPayload, type DropHint, type PointerDragDetail } from "@/lib/app/dragSession";
import { folderPlace, resolveFolderDrop, zoneAt, type FolderPlace } from "@/lib/app/folderDrop";
import { FOLDER_MIME } from "@/lib/app/folders";
import { NOTE_MIME, draggedNoteIds, previewOf } from "@/lib/app/noteDrag";
import { HOLD_MOVE_EVENT, type HoldMoveDetail } from "@/lib/touchContextMenu";
import { haptic } from "@/lib/nativeApp";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useNoteActions } from "@/components/views/noteActions";

/** How long a drag rests on a closed folder (or "+N more") before it opens. */
const EXPAND_MS = 650;
/** How near a list's edge the pointer scrolls it. */
const EDGE = 36;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Why a folder can't go where it's over, in a few words (the row shows it). */
export function refusalText(problem: "self" | "descendant" | "depth"): string {
  return problem === "depth" ? `Only ${MAX_FOLDER_DEPTH} levels of folders` : problem === "self" ? "Can’t go inside itself" : "Can’t go inside its own subfolder";
}

/** The few words a target shows when what's dragged can't go there. */
export function DropRefusal({ text, className = "", style }: { text: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span role="status" style={style} className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-chip bg-heading px-2 py-1 text-[11.5px] font-medium text-canvas shadow-[0_4px_12px_rgb(0_0_0/0.18)] ${className}`}>
      {text}
    </span>
  );
}

/**
 * The same words under a row of a list that scrolls (the sidebar's): drawn over the page, so they never make
 * the list longer (which would scroll it under the drag).
 */
export function FloatingDropRefusal({ text, anchor, left = 0 }: { text: string; anchor: HTMLElement | null; left?: number }) {
  if (!anchor || typeof document === "undefined") return null;
  const r = anchor.getBoundingClientRect();
  return createPortal(<DropRefusal text={text} className="fixed z-[60]" style={{ top: r.bottom + 2, left: r.left + left }} />, document.body);
}

interface Intent {
  hint: DropHint;
  target: HTMLElement;
  /** Set when the drop is allowed. */
  run?: () => void;
}

export function FolderDropLayer() {
  const { scope, canEdit } = useAppState();
  const tree = useFolderTree(scope);
  const notes = useNoteActions();
  const actions = useFolderActions();
  const toast = useToast();
  const [, setFolderOpen] = useOpenFolders();

  // The listeners are added once; what they need is read from here at the time.
  const live = useRef({ folders: tree?.folders ?? [], canEdit, notes, actions, toast, setFolderOpen });
  live.current = { folders: tree?.folders ?? [], canEdit, notes, actions, toast, setFolderOpen };

  useEffect(() => {
    let point: { x: number; y: number } | null = null;
    let current: Intent | null = null;
    let expand: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
    let frame = 0;
    let ghost: { el: HTMLElement; dx: number; dy: number } | null = null;

    const moveFolder = (id: string, to: FolderPlace) => {
      const { folders, actions, toast, setFolderOpen } = live.current;
      const folder = folders.find((f) => f.id === id);
      const was = folderPlace(folders, id);
      if (!folder || !was) return;
      try {
        actions.move(id, to.parentFolderId, to.afterFolderId);
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
        return;
      }
      if (to.parentFolderId) setFolderOpen(to.parentFolderId, true);
      const where = to.parentFolderId ? (folders.find((f) => f.id === to.parentFolderId)?.name ?? "the folder") : "the top level";
      const message = to.parentFolderId === was.parentFolderId ? `Moved “${folder.name}”` : `Moved “${folder.name}” to ${where}`;
      toast.show(message, {
        action: {
          label: "Undo",
          onClick: () => {
            try {
              live.current.actions.move(id, was.parentFolderId, was.afterFolderId);
            } catch (e) {
              live.current.toast.show(errorMessage(e), { tone: "error" });
            }
          },
        },
      });
    };

    /** What dropping here would do (null: nothing; `run` unset: refused, and the target says why). */
    const intentAt = (el: Element | null, x: number, y: number, payload: DragPayload | null, types?: readonly string[]): Intent | null => {
      if (!live.current.canEdit) return null;
      const target = el?.closest<HTMLElement>("[data-drop-folder]");
      if (!target) return null;
      const key = target.dataset.dropFolder ?? "";
      const shown = target.dataset.dropKey ?? key;
      const name = target.dataset.dropName || (key ? "the folder" : "Drafts");
      const notesDragged = payload ? payload.kind === "notes" : !!types?.includes(NOTE_MIME);
      if (notesDragged) {
        if (key === "@top") return null;
        const ids = payload?.kind === "notes" ? payload.ids : null;
        return {
          hint: { key: shown, zone: "inside" },
          target,
          run: () => {
            const dropped = ids ?? pendingIds;
            if (dropped.length) void live.current.notes.moveTo(dropped, { id: key || null, name });
          },
        };
      }
      // A folder (only one dragged from this window: another window's folders belong to its own list).
      if (payload?.kind !== "folder" || key === "") return null;
      const { folders } = live.current;
      const rect = target.getBoundingClientRect();
      const zone = key !== "@top" && target.hasAttribute("data-drop-tree") ? zoneAt(y, rect.top, rect.height) : "inside";
      const drop = resolveFolderDrop(folders, payload.id, key === "@top" ? null : key, zone, target.dataset.dropOpen === "1");
      // (Over its own row it simply isn't taken; anywhere else the target says why.)
      if (!drop.ok) return drop.problem === "self" && key === payload.id ? null : { hint: { key: shown, zone: "inside", refused: refusalText(drop.problem) }, target };
      if (!drop.changed) return null;
      return { hint: { key: shown, zone }, target, run: () => moveFolder(payload.id, drop) };
    };
    // Notes dropped from another Folevi window: their ids come with the drop.
    let pendingIds: string[] = [];

    const stopExpand = () => {
      if (expand) clearTimeout(expand.timer);
      expand = null;
    };
    /** A closed folder (or "+N more") held under the drag opens after a moment. */
    const watchExpand = (el: Element | null) => {
      const host = el?.closest<HTMLElement>("[data-drop-closed='1'], [data-drop-expand]") ?? null;
      if (host === expand?.el) return;
      stopExpand();
      if (!host) return;
      expand = {
        el: host,
        timer: setTimeout(() => {
          expand = null;
          if (host.hasAttribute("data-drop-expand")) host.click();
          else if (host.dataset.dropFolder) live.current.setFolderOpen(host.dataset.dropFolder, true);
        }, EXPAND_MS),
      };
    };

    /** Lists scroll while the pointer rests near their top or bottom edge. */
    const scrollLoop = () => {
      frame = 0;
      if (!dragState().payload || !point) return;
      let best: HTMLElement | null = null;
      let area = Infinity;
      for (const el of document.querySelectorAll<HTMLElement>("[data-drag-scroll]")) {
        const r = el.getBoundingClientRect();
        if (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom || el.scrollHeight - el.clientHeight < 2) continue;
        if (r.width * r.height < area) {
          best = el;
          area = r.width * r.height;
        }
      }
      if (best) {
        const r = best.getBoundingClientRect();
        const up = point.y - r.top;
        const down = r.bottom - point.y;
        const step = (d: number) => Math.ceil((EDGE - d) / 3) + 1;
        if (up < EDGE) best.scrollTop -= step(up);
        else if (down < EDGE) best.scrollTop += step(down);
      }
      frame = requestAnimationFrame(scrollLoop);
    };
    const track = (x: number, y: number) => {
      point = { x, y };
      if (!frame) frame = requestAnimationFrame(scrollLoop);
    };

    const show = (intent: Intent | null) => {
      const before = current?.hint.key;
      current = intent;
      setDropHint(intent?.hint ?? null);
      if (dragState().custom && intent && intent.hint.key !== before) haptic(intent.run ? "selection" : "light");
    };

    const reset = () => {
      stopExpand();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      point = null;
      current = null;
      ghost?.el.remove();
      ghost = null;
      endDrag();
    };

    // ---- The mouse: the browser's own drag.
    const onDragOver = (e: DragEvent) => {
      const payload = dragState().payload;
      if (!payload && !e.dataTransfer?.types.includes(NOTE_MIME)) return;
      track(e.clientX, e.clientY);
      const intent = intentAt(e.target as Element | null, e.clientX, e.clientY, payload, e.dataTransfer?.types);
      watchExpand(e.target as Element | null);
      show(intent);
      if (intent?.run) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      }
    };
    const onDragLeave = (e: DragEvent) => {
      // Out of the window: nothing is under the drag any more.
      if (!e.relatedTarget) {
        show(null);
        stopExpand();
      }
    };
    const onDrop = (e: DragEvent) => {
      const intent = intentAt(e.target as Element | null, e.clientX, e.clientY, dragState().payload, e.dataTransfer?.types);
      if (intent?.run) {
        e.preventDefault();
        pendingIds = e.dataTransfer ? draggedNoteIds(e) : [];
        intent.run();
        pendingIds = [];
      }
      reset();
    };
    const onDragEnd = () => reset();

    // ---- A finger: press and hold, then move.
    const onHoldMove = (e: Event) => {
      if (dragState().payload || !live.current.canEdit) return;
      const held = e.target instanceof Element ? e.target : null;
      if (!held || held.closest("[contenteditable='true'], .ProseMirror")) return;
      const source = held.closest<HTMLElement>("[draggable='true']");
      if (!source) return;
      const { startX, startY, x, y } = (e as CustomEvent<HoldMoveDetail>).detail;
      // What it carries is what its own drag would (a selection of cards goes along): its dragstart says.
      let transfer: DataTransfer;
      try {
        transfer = new DataTransfer();
      } catch {
        return;
      }
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer, clientX: startX, clientY: startY }));
      const payload = dragState().payload;
      if (!payload || !(transfer.types.includes(NOTE_MIME) || transfer.types.includes(FOLDER_MIME))) {
        endDrag();
        return;
      }
      e.preventDefault();
      // The held menu gives way.
      document.querySelector<HTMLElement>('[role="menu"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      const face = payload.kind === "notes" ? previewOf(source) : (source.closest<HTMLElement>("[data-drop-folder]") ?? source);
      carry(payload, face, startX, startY);
      haptic("medium");
      follow(x, y);
    };
    /** The layer's own drag begins: a copy of `face` lifts and follows the pointer. */
    const carry = (payload: DragPayload, face: HTMLElement | null, x: number, y: number) => {
      beginDrag(payload, true);
      ghost?.el.remove();
      ghost = face ? lift(face, x, y, payload.kind === "notes" ? payload.ids.length : 1) : null;
    };
    // A mouse drag the browser couldn't carry (search results sit in a modal): the pointer's moves carry it.
    const onPointerDrag = (e: Event) => {
      const { payload, face, x, y } = (e as CustomEvent<PointerDragDetail>).detail;
      if (!live.current.canEdit) return;
      carry(payload, face, x, y);
      follow(x, y);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragState().custom || e.pointerType === "touch") return;
      follow(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragState().custom || e.pointerType === "touch") return;
      const intent = current;
      if (e.type === "pointerup" && intent?.run) intent.run();
      reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragState().custom) reset();
    };
    const follow = (x: number, y: number) => {
      track(x, y);
      if (ghost) ghost.el.style.transform = `translate3d(${x - ghost.dx}px, ${y - ghost.dy}px, 0)${reducedMotion() ? "" : " scale(1.03)"}`;
      const under = document.elementFromPoint(x, y);
      watchExpand(under);
      show(intentAt(under, x, y, dragState().payload));
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragState().custom) return;
      const t = e.touches[0];
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      follow(t.clientX, t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!dragState().custom) return;
      const intent = current;
      if (e.type === "touchend" && intent?.run) {
        intent.run();
        haptic("success");
      }
      reset();
    };

    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onDragEnd, true);
    document.addEventListener(HOLD_MOVE_EVENT, onHoldMove);
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    document.addEventListener("touchend", onTouchEnd, true);
    document.addEventListener("touchcancel", onTouchEnd, true);
    document.addEventListener(POINTER_DRAG_EVENT, onPointerDrag);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener(POINTER_DRAG_EVENT, onPointerDrag);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onDragEnd, true);
      document.removeEventListener(HOLD_MOVE_EVENT, onHoldMove);
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
      reset();
    };
  }, []);

  return null;
}

/** The picture a finger carries: a copy of what it held, lifted off the page, with a count when several go. */
function lift(face: HTMLElement, x: number, y: number, count: number): { el: HTMLElement; dx: number; dy: number } {
  const box = face.getBoundingClientRect();
  const el = face.cloneNode(true) as HTMLElement;
  el.removeAttribute("id");
  for (const n of el.querySelectorAll("[id]")) n.removeAttribute("id");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-drag-ghost", "");
  el.removeAttribute("data-held-lift");
  Object.assign(el.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
    zIndex: "2147483000",
    pointerEvents: "none",
    opacity: "0.92",
    boxShadow: "0 12px 32px rgb(0 0 0 / 0.22), 0 2px 8px rgb(0 0 0 / 0.12)",
    borderRadius: "var(--radius-chip)",
    background: getComputedStyle(face).backgroundColor === "rgba(0, 0, 0, 0)" ? "var(--color-surface, var(--color-canvas))" : "",
    transformOrigin: `${x - box.left}px ${y - box.top}px`,
    transform: `translate3d(${box.left}px, ${box.top}px, 0)`,
    transition: "none",
  });
  // A card keeps its panel corners, a row its chip corners.
  if (box.height > 60) el.style.borderRadius = "var(--radius-panel)";
  if (count > 1) {
    const badge = document.createElement("span");
    badge.textContent = `${count} notes`;
    Object.assign(badge.style, {
      position: "absolute",
      top: "8px",
      left: "8px",
      padding: "3px 9px",
      borderRadius: "var(--radius-chip)",
      font: "600 12px system-ui, sans-serif",
      background: "var(--color-heading)",
      color: "var(--color-canvas)",
    });
    el.appendChild(badge);
  }
  document.body.appendChild(el);
  return { el, dx: x - box.left, dy: y - box.top };
}
