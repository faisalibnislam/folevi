"use client";

import { useCallback, useEffect, useRef } from "react";
import { ulid, DEFAULT_DOCUMENT_STYLE, DEFAULT_COVER } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { openNextFresh, openNextInNewTab } from "@/lib/app/tabs";
import { loadDocumentView } from "@/lib/app/noteView";
import { haptic } from "@/lib/nativeApp";
import { useColumnsList, useNoteColumnsActive } from "@/lib/app/useNoteColumns";
import { columnsHref } from "@/lib/app/noteColumns";

/**
 * Creates a document through the sync engine (works offline: the create is queued durably and the
 * editor opens immediately on the new id).
 *
 * A top-level note created while a folder page is open (the tab bar's New note, ⌘⌥N, the palette) goes
 * into that folder; elsewhere it starts in Drafts. Pass `folderId` (null for Drafts) to choose.
 */
export function useCreateDocument() {
  const { engine: current } = useAppState();
  // A New note pressed while the sync engine is still starting (just after the page loads, or after switching
  // account) waits for it instead of doing nothing.
  const engineRef = useRef(current);
  useEffect(() => {
    engineRef.current = current;
  }, [current]);
  const { navigate, route } = useAppRouter();
  // In the columns layout (docs/NOTE_COLUMNS.md) a new note starts in the list on screen and opens in its column.
  const columns = useColumnsList();
  const columnsOn = useNoteColumnsActive();
  const currentFolder = columns ? (columns.route.name === "folder" ? columns.route.id : null) : route.name === "folder" ? route.id : null;
  return useCallback(
    async (opts: { title?: string; parentDocumentId?: string | null; folderId?: string | null; templateId?: string | null; kind?: "document" | "template"; navigateTo?: boolean }) => {
      let engine = engineRef.current;
      for (let waited = 0; !engine && waited < 10_000; waited += 50) {
        await new Promise((r) => setTimeout(r, 50));
        engine = engineRef.current;
      }
      if (!engine) return null;
      const id = ulid();
      const inFolder = opts.folderId !== undefined ? opts.folderId : !opts.parentDocumentId && (opts.kind ?? "document") === "document" ? currentFolder : null;
      engine.createDocument({
        id,
        parentDocumentId: opts.parentDocumentId ?? null,
        folderId: inFolder,
        kind: opts.kind ?? "document",
        title: opts.title ?? "",
        icon: null,
        style: DEFAULT_DOCUMENT_STYLE,
        // New notes start Plain; the owner picks a note theme later in Style.
        cover: DEFAULT_COVER,
        templateId: opts.templateId ?? null,
      });
      await engine.persisted();
      // In the iOS app, a new note is felt as well as seen.
      haptic("medium");
      if (opts.navigateTo !== false) {
        // The new note opens ready to type in, never on a placeholder that would swallow the first keys.
        await loadDocumentView().catch(() => undefined);
        // In a list's column a new note (not a template) opens there, in the list's tab.
        // Elsewhere with the layout on (Home, Tasks…), in its folder's column or Drafts': a note just made isn't on the
        // server yet for its list to be worked out from.
        const topLevel = !opts.parentDocumentId && (opts.kind ?? "document") === "document";
        const list = columns && topLevel && opts.templateId === undefined ? columns.path : columnsOn && topLevel ? (inFolder ? `/folders/${encodeURIComponent(inFolder)}` : "/drafts") : null;
        if (list) {
          navigate(columnsHref(id, list, { fresh: true }));
          return id;
        }
        // A new top-level page opens in its own tab; a nested one stays in the note's tab.
        if (!opts.parentDocumentId) openNextInNewTab();
        // The tab bar's New note ("+", ⌘⌥N, the palette) starts a fresh tab with no Back; a folder page's keeps one.
        if (!opts.parentDocumentId && opts.folderId === undefined) openNextFresh();
        navigate(`/d/${id}?new=1`);
      }
      return id;
    },
    [navigate, currentFolder, columns, columnsOn],
  );
}
