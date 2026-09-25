"use client";

import { useCallback } from "react";
import { ulid, DEFAULT_DOCUMENT_STYLE, DEFAULT_COVER } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";

/**
 * Creates a document through the sync engine (works offline: the create is queued durably and the
 * editor opens immediately on the new id).
 */
export function useCreateDocument() {
  const { engine } = useAppState();
  const { navigate } = useAppRouter();
  return useCallback(
    async (opts: { title?: string; parentDocumentId?: string | null; folderId?: string | null; templateId?: string | null; kind?: "document" | "template"; navigateTo?: boolean }) => {
      if (!engine) return null;
      const id = ulid();
      engine.createDocument({
        id,
        parentDocumentId: opts.parentDocumentId ?? null,
        folderId: opts.folderId ?? null,
        kind: opts.kind ?? "document",
        title: opts.title ?? "",
        icon: null,
        style: DEFAULT_DOCUMENT_STYLE,
        cover: DEFAULT_COVER,
        templateId: opts.templateId ?? null,
      });
      await engine.persisted();
      if (opts.navigateTo !== false) navigate(`/d/${id}?new=1`);
      return id;
    },
    [engine, navigate],
  );
}
