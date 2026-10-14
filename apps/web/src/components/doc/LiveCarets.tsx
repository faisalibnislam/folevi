"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { api } from "@/lib/convex/api";
import { throttle } from "@/lib/throttle";
import { sameCursor, selectionToCursor, setRemoteCarets, type CursorSpec } from "@/components/editor/remoteCarets";

/** How often a moving caret is sent, at most. */
export const CARET_SEND_MS = 250;

/**
 * Live carets for a note, while someone else is in it: sends this editor's selection (throttled) and shows
 * the others' carets in the editor. Draws nothing itself; a remote caret moving re-renders only this.
 */
export function LiveCarets({ editor, documentId, sessionId, present }: { editor: TiptapEditor | null; documentId: string; sessionId: string; present: readonly string[] }) {
  const active = present.length > 0;
  const setCursor = useMutation(api.presence.setCursor);

  // Ours: on every selection change (and edits that move it), at most every CARET_SEND_MS.
  useEffect(() => {
    if (!editor || !active) return;
    let sent: CursorSpec | null = null;
    const send = throttle((cursor: CursorSpec | null) => {
      void setCursor({ documentId, sessionId, cursor }).catch(() => undefined);
    }, CARET_SEND_MS);
    const update = () => {
      if (editor.isDestroyed) return;
      const cursor = selectionToCursor(editor.state);
      if (sameCursor(cursor, sent)) return;
      sent = cursor;
      send(cursor);
    };
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
      // (Leaving the note removes our caret: a send still waiting would bring it back.)
      send.cancel();
    };
  }, [editor, active, documentId, sessionId, setCursor]);

  // Theirs: only for the people the presence list says are here.
  const cursors = useQuery(api.presence.cursors, active && editor ? { documentId } : "skip");
  const presentKey = present.join(",");
  const here = useMemo(() => new Set(presentKey ? presentKey.split(",") : []), [presentKey]);
  const shownRef = useRef(false);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const list = active ? (cursors ?? []).filter((c) => here.has(c.profileId)) : [];
    if (!list.length && !shownRef.current) return;
    shownRef.current = list.length > 0;
    setRemoteCarets(editor.view, list);
  }, [editor, active, cursors, here]);

  return null;
}
