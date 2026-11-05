"use client";

import type { DragEvent } from "react";
import { dragNotesOut } from "@/lib/desktop/capabilities";
import { beginDrag } from "./dragSession";
import { selectionNoun } from "./multiSelect";

/** One dragged note (also what list reordering reads). */
export const NOTE_MIME = "application/x-folevi-document";
/** Every dragged note (a multi-selection), as a JSON array of ids. */
export const NOTES_MIME = "application/x-folevi-documents";

/**
 * Starts dragging notes from a card or row (native HTML5 drag, so dropping on a sidebar folder works from
 * any list). The pointer carries the note itself: the card (or the list row) as it looks on screen, with a
 * count on it when several notes go along. Without this a card dragged by its link showed the browser's
 * link chip (the title and address in a box).
 */
export function startNoteDrag(e: DragEvent, ids: string[], titleOf?: (id: string) => string | null | undefined) {
  if (!ids.length) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(NOTE_MIME, ids[0]!);
  e.dataTransfer.setData(NOTES_MIME, JSON.stringify(ids));
  // Drop targets read what's dragged while it's in the air (the drag's own data can't be read until the drop).
  beginDrag({ kind: "notes", ids });
  // The native Mac app: dropped in Finder, Mail or another app, the notes become Markdown files.
  dragNotesOut(ids, titleOf);
  setDragPicture(e, ids.length > 1 ? `${ids.length} notes` : null);
}

/** A multi-selection with folders in it (folders, or folders and notes), dragged together onto a folder. */
export const ITEMS_MIME = "application/x-folevi-items";

/**
 * Starts dragging a selection that holds folders (from any of its cards or rows): dropped on a folder, every
 * folder and note goes inside it (components/app/FolderDropLayer.tsx). The pointer carries the card held, with a
 * count ("2 folders and 3 notes").
 */
export function startItemsDrag(e: DragEvent, items: { notes: string[]; folders: string[] }, titleOf?: (id: string) => string | null | undefined) {
  const total = items.notes.length + items.folders.length;
  if (!total) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(ITEMS_MIME, JSON.stringify(items));
  beginDrag({ kind: "items", notes: items.notes, folders: items.folders });
  if (items.notes.length) dragNotesOut(items.notes, titleOf);
  setDragPicture(e, total > 1 ? selectionNoun(items.notes.length, items.folders.length) : null);
}

/** The drag's picture: the card or row it starts from, with `badgeText` (a count) painted in its corner. */
function setDragPicture(e: DragEvent, badgeText: string | null) {
  const image = previewOf(e.currentTarget);
  if (!image) return;
  const box = image.getBoundingClientRect();
  let undo = () => {};
  if (badgeText) {
    // A count in the corner, painted into the drag image and removed straight after.
    const badge = document.createElement("span");
    badge.textContent = badgeText;
    const dark = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    Object.assign(badge.style, {
      position: "absolute",
      top: "8px",
      left: "8px",
      zIndex: "30",
      padding: "3px 9px",
      borderRadius: "var(--radius-chip)",
      font: "600 12px system-ui, sans-serif",
      background: dark ? "#f4f4f5" : "#18181b",
      color: dark ? "#18181b" : "#ffffff",
      boxShadow: "0 2px 8px rgb(0 0 0 / 0.2)",
    });
    const position = image.style.position;
    if (getComputedStyle(image).position === "static") image.style.position = "relative";
    image.appendChild(badge);
    undo = () => {
      badge.remove();
      image.style.position = position;
    };
  }
  const x = Math.min(Math.max(e.clientX - box.left, 0), box.width);
  const y = Math.min(Math.max(e.clientY - box.top, 0), box.height);
  e.dataTransfer.setDragImage(image, x, y);
  setTimeout(undo, 0);
}

/** What the drag shows: a card's face (its link, without the hover buttons), else the row it starts from. */
export function previewOf(target: EventTarget): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  // A drag handle stands for its row.
  const host = target.getBoundingClientRect().height < 24 ? (target.closest<HTMLElement>("li, tr, [role=row]") ?? target) : target;
  const face = host.querySelector<HTMLElement>('a[href^="/d/"]');
  return face && face.getBoundingClientRect().height > 60 ? face : host;
}

/** Anything carrying a drag's data (React's drag event or the browser's). */
type WithTransfer = { dataTransfer: DataTransfer | null };

export function isNoteDrag(e: WithTransfer): boolean {
  return !!e.dataTransfer?.types.includes(NOTE_MIME);
}

export function draggedNoteIds(e: WithTransfer): string[] {
  if (!e.dataTransfer) return [];
  try {
    const many = JSON.parse(e.dataTransfer.getData(NOTES_MIME) || "null") as unknown;
    if (Array.isArray(many) && many.every((x) => typeof x === "string")) return many as string[];
  } catch {
    /* fall back to the single id */
  }
  const one = e.dataTransfer.getData(NOTE_MIME);
  return one ? [one] : [];
}
