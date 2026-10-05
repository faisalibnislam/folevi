"use client";

import type { DragEvent } from "react";

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
export function startNoteDrag(e: DragEvent, ids: string[]) {
  if (!ids.length) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(NOTE_MIME, ids[0]!);
  e.dataTransfer.setData(NOTES_MIME, JSON.stringify(ids));
  const image = previewOf(e.currentTarget);
  if (!image) return;
  const box = image.getBoundingClientRect();
  let undo = () => {};
  if (ids.length > 1) {
    // A count in the corner, painted into the drag image and removed straight after.
    const badge = document.createElement("span");
    badge.textContent = `${ids.length} notes`;
    const dark = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    Object.assign(badge.style, {
      position: "absolute",
      top: "8px",
      left: "8px",
      zIndex: "30",
      padding: "3px 9px",
      borderRadius: "999px",
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
function previewOf(target: EventTarget): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  // A drag handle stands for its row.
  const host = target.getBoundingClientRect().height < 24 ? (target.closest<HTMLElement>("li, tr, [role=row]") ?? target) : target;
  const face = host.querySelector<HTMLElement>('a[href^="/d/"]');
  return face && face.getBoundingClientRect().height > 60 ? face : host;
}

export function isNoteDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(NOTE_MIME);
}

export function draggedNoteIds(e: DragEvent): string[] {
  try {
    const many = JSON.parse(e.dataTransfer.getData(NOTES_MIME) || "null") as unknown;
    if (Array.isArray(many) && many.every((x) => typeof x === "string")) return many as string[];
  } catch {
    /* fall back to the single id */
  }
  const one = e.dataTransfer.getData(NOTE_MIME);
  return one ? [one] : [];
}
