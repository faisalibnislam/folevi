"use client";

import { useCallback } from "react";
import { ulid, DEFAULT_DOCUMENT_STYLE, DEFAULT_COVER, randomNoteCover } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { openNextInNewTab } from "@/lib/app/tabs";

/**
 * Creates a document through the sync engine (works offline: the create is queued durably and the
 * editor opens immediately on the new id).
 *
 * A top-level note created while a folder page is open (the tab bar's New note, ⌘⌥N, the palette) goes
 * into that folder; elsewhere it starts in Drafts. Pass `folderId` (null for Drafts) to choose.
 */
export function useCreateDocument() {
  const { engine } = useAppState();
  const { navigate, route } = useAppRouter();
  const currentFolder = route.name === "folder" ? route.id : null;
  return useCallback(
    async (opts: { title?: string; parentDocumentId?: string | null; folderId?: string | null; templateId?: string | null; kind?: "document" | "template"; navigateTo?: boolean }) => {
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
        // Every new note starts with a random note style (templates stay plain).
        cover: (opts.kind ?? "document") === "document" ? randomNoteCover() : DEFAULT_COVER,
        templateId: opts.templateId ?? null,
      });
      await engine.persisted();
      if (opts.navigateTo !== false) {
        // A new top-level page opens in its own tab; a nested one stays in the note's tab.
        if (!opts.parentDocumentId) openNextInNewTab();
        navigate(`/d/${id}?new=1`);
      }
      return id;
    },
    [engine, navigate, currentFolder],
  );
}
