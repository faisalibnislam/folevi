"use client";

// The drag under way in this window (notes or a folder) and where it would land, shared by what starts drags
// (cards, rows, sidebar folders), the drop layer that reads the pointer (components/app/FolderDropLayer.tsx)
// and the rows that draw the highlight or the line. A mouse drag is the browser's own (HTML5, so the Mac app
// can also drop notes in Finder); a finger's is the drop layer's, after a press and hold.
import { useSyncExternalStore } from "react";
import type { DropZone } from "./folderDrop";

/**
 * What's dragged: notes, one folder, or a selection with folders in it ("items": a multi-select of folders, or of
 * folders and notes, dragged together onto a folder).
 */
export type DragPayload = { kind: "notes"; ids: string[] } | { kind: "folder"; id: string } | { kind: "items"; notes: string[]; folders: string[] };

/** Where the drag would land: a folder row's line or inside (`key` is the folder id, "" Drafts, "@top" the top level). */
export interface DropHint {
  key: string;
  zone: DropZone;
  /** Why it can't go there (the row shows it refused). */
  refused?: string;
  /** A gap between cards (a reorderable list's, `key` "reorder:<list>"): where among the others it would land. */
  index?: number;
}

interface State {
  payload: DragPayload | null;
  hint: DropHint | null;
  /**
   * The drop layer's own drag, not the browser's: a finger's (after a press and hold), or a mouse's from where the
   * browser's drag can't leave (search results, over a modal). The layer draws the picture under the pointer.
   */
  custom: boolean;
}

let state: State = { payload: null, hint: null, custom: false };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function dragState(): State {
  return state;
}

export function beginDrag(payload: DragPayload, custom = false) {
  set({ payload, hint: null, custom });
}

export function endDrag() {
  if (state.payload || state.hint) set({ payload: null, hint: null, custom: false });
}

export function setDropHint(hint: DropHint | null) {
  const h = state.hint;
  if (h === hint || (h && hint && h.key === hint.key && h.zone === hint.zone && h.refused === hint.refused && h.index === hint.index)) return;
  set({ hint });
}

/**
 * A list whose cards a dragged folder can be put between (the Folders page's grid, `data-reorder-list="<key>"`):
 * the drop layer asks it where over it the drag is, and has it make the move.
 */
export interface ReorderList {
  /** The gap the folder would go in (an index among the other cards), "inside" a card's middle, or null: nothing here. */
  spotAt(el: Element, x: number, y: number, draggedId: string): { gap: number; changes: boolean } | "inside" | null;
  /** Puts the folder in that gap. */
  commit(draggedId: string, gap: number): void;
}

const reorderLists = new Map<string, ReorderList>();

/** Makes a list reorderable while it's on screen (returns what takes it off). */
export function registerReorderList(key: string, list: ReorderList): () => void {
  reorderLists.set(key, list);
  return () => {
    if (reorderLists.get(key) === list) reorderLists.delete(key);
  };
}

export function reorderList(key: string): ReorderList | undefined {
  return reorderLists.get(key);
}

/** Asks the drop layer to carry `payload` itself from (x, y), showing a copy of `face` (see State.custom). */
export const POINTER_DRAG_EVENT = "folevi:pointer-drag";
export type PointerDragDetail = { payload: DragPayload; face: HTMLElement; x: number; y: number };

export function startPointerDrag(detail: PointerDragDetail) {
  document.dispatchEvent(new CustomEvent<PointerDragDetail>(POINTER_DRAG_EVENT, { detail }));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The drag under way (null when nothing is dragged). */
export function useDragPayload(): DragPayload | null {
  return useSyncExternalStore(
    subscribe,
    () => state.payload,
    () => null,
  );
}

/** The drop hint for one target (null unless the drag is over it). */
export function useDropHint(key: string): DropHint | null {
  return useSyncExternalStore(
    subscribe,
    () => (state.hint?.key === key ? state.hint : null),
    () => null,
  );
}
