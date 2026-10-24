"use client";

// The editor's text size on this device (Settings > Appearance, "Editor text size"; the native apps through
// settings.update { editorZoom }): a number kept in localStorage and applied as the --editor-zoom CSS variable
// (components/editor/editor.css). Applied by Shell for the whole app, on every page, not only in Settings.
import { useLayoutEffect } from "react";

export const EDITOR_ZOOMS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35];
export const EDITOR_ZOOM_KEY = "folevi:editor-zoom";

export function editorZoom(): number {
  try {
    const raw = localStorage.getItem(EDITOR_ZOOM_KEY);
    const v = raw === null ? 1 : Number(JSON.parse(raw));
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

/** Sets the --editor-zoom variable from what this device keeps. */
export function applyEditorZoom(): void {
  document.documentElement.style.setProperty("--editor-zoom", String(editorZoom()));
}

/** Applies the editor's text size now and whenever it changes (here, or in another tab). */
export function useEditorZoom(): void {
  useLayoutEffect(() => {
    applyEditorZoom();
    const onStorage = (e: StorageEvent) => {
      if (e.key === EDITOR_ZOOM_KEY || e.key === null) applyEditorZoom();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(`folevi-ls:${EDITOR_ZOOM_KEY}`, applyEditorZoom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(`folevi-ls:${EDITOR_ZOOM_KEY}`, applyEditorZoom);
    };
  }, []);
}
