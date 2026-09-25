"use client";

import { useEffect, useRef } from "react";
import { dailyDocumentId, DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { FullPageMessage } from "@/lib/app/state";

export function dailyTitle(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Opens (creating if needed) the Daily Note for a date. The note's id is derived from person +
 * workspace + date, so every device converges on the same page even when offline.
 */
export function DailyView({ date }: { date: string | null }) {
  const { engine, profile, workspace, today } = useAppState();
  const { navigate } = useAppRouter();
  const [template] = useLocalStorage<string | null>("folevi:daily-template", null);
  const target = date ?? today;
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!engine || done.current === target) return;
    done.current = target;
    const id = dailyDocumentId(profile.id, workspace.id, target);
    const known = engine.state.pending.some((op) => op.kind === "document.create" && op.document.id === id);
    if (!known) {
      // Idempotent: if the note exists (created elsewhere), the server simply reports it.
      engine.createDocument({
        id,
        parentDocumentId: null,
        folderId: null,
        kind: "daily",
        title: dailyTitle(target),
        icon: "🗓",
        style: { ...DEFAULT_DOCUMENT_STYLE, font: "serif", width: "narrow" },
        cover: DEFAULT_COVER,
        dailyDate: target,
        templateId: template,
      });
    }
    navigate(`/d/${id}?daily=${target}`, { replace: true });
  }, [engine, profile.id, workspace.id, target, navigate, template]);

  return <FullPageMessage title="Opening your daily note…" busy />;
}
