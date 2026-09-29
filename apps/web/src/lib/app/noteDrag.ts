"use client";

import type { DragEvent } from "react";

/** One dragged note (also what list reordering reads). */
export const NOTE_MIME = "application/x-folevi-document";
/** Every dragged note (a multi-selection), as a JSON array of ids. */
export const NOTES_MIME = "application/x-folevi-documents";

/**
 * Starts dragging notes from a card or row (native HTML5 drag, so dropping on a sidebar folder works from
 * any list). Several notes drag as a small "N notes" chip.
 */
export function startNoteDrag(e: DragEvent, ids: string[]) {
  if (!ids.length) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(NOTE_MIME, ids[0]!);
  e.dataTransfer.setData(NOTES_MIME, JSON.stringify(ids));
  if (ids.length > 1) {
    const chip = document.createElement("div");
    chip.textContent = `${ids.length} notes`;
    const dark = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    Object.assign(chip.style, {
      position: "fixed",
      top: "-1000px",
      left: "-1000px",
      padding: "6px 12px",
      borderRadius: "8px",
      font: "600 13px system-ui, sans-serif",
      background: dark ? "#f4f4f5" : "#18181b",
      color: dark ? "#18181b" : "#ffffff",
      boxShadow: "0 4px 14px rgb(0 0 0 / 0.2)",
    });
    document.body.appendChild(chip);
    e.dataTransfer.setDragImage(chip, 16, 16);
    setTimeout(() => chip.remove(), 0);
  }
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
