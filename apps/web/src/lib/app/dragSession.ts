"use client";

// The drag under way in this window (notes or a folder) and where it would land, shared by what starts drags
// (cards, rows, sidebar folders), the drop layer that reads the pointer (components/app/FolderDropLayer.tsx)
// and the rows that draw the highlight or the line. A mouse drag is the browser's own (HTML5, so the Mac app
// can also drop notes in Finder); a finger's is the drop layer's, after a press and hold.
import { useSyncExternalStore } from "react";
import type { DropZone } from "./folderDrop";

export type DragPayload = { kind: "notes"; ids: string[] } | { kind: "folder"; id: string };

/** Where the drag would land: a folder row's line or inside (`key` is the folder id, "" Drafts, "@top" the top level). */
export interface DropHint {
  key: string;
  zone: DropZone;
  /** Why it can't go there (the row shows it refused). */
  refused?: string;
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
  if (h === hint || (h && hint && h.key === hint.key && h.zone === hint.zone && h.refused === hint.refused)) return;
  set({ hint });
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
