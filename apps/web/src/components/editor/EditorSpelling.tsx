"use client";
// What the note editor's spelling and prediction need from the app around them (docs/SPELLING_PLAN.md): which
// note this is (its own spell check switch, and whether it's end-to-end encrypted), and whether Foli AI may be
// asked for longer next words here. Foli AI is asked only with an account, with Foli AI on for the person, and
// never for an encrypted note (its text never leaves the device). Also draws the bubble under a clicked
// misspelt word (SpellingBubble.tsx).
import { useEffect, useRef } from "react";
import { useAction } from "convex/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useAiEnabled } from "@/components/ai/useAi";
import { api } from "@/lib/convex/api";
import { isSealedDocument } from "@/lib/e2ee/router/hooks";
import { useBackendMode } from "@/lib/mode";
import { useMaybeAppState } from "@/lib/app/state";
import { LANGUAGES } from "@/lib/spelling/languages";
import type { CloudComplete, PredictStorage } from "./predict";
import type { SpellcheckStorage } from "./spellcheck";
import { SpellingBubble } from "./SpellingBubble";

export function EditorSpelling({ editor, documentId, editable }: { editor: TiptapEditor; documentId: string; editable: boolean }) {
  const aiOn = useAiEnabled();
  const account = useBackendMode() !== "local";
  const scope = useMaybeAppState()?.scope ?? null;
  const complete = useAction(api.aiComplete.complete);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    const storage = editor.storage as { spellcheck?: SpellcheckStorage };
    if (!storage.spellcheck) return;
    // (Read by the underlines' first pass, which comes a moment after the editor mounts.)
    storage.spellcheck.documentId = documentId;
  }, [editor, documentId]);

  useEffect(() => {
    const storage = (editor.storage as { predict?: PredictStorage }).predict;
    if (!storage) return;
    const cloud: CloudComplete | null =
      aiOn && account && editable && scopeRef.current
        ? async (before, after, lang) => {
            if (isSealedDocument(documentId)) return null;
            const scope = scopeRef.current;
            if (!scope) return null;
            const r = await complete({ scope, documentId, before, after, language: LANGUAGES[lang].name });
            return r.text || null;
          }
        : null;
    storage.cloud = cloud;
    return () => {
      if (storage.cloud === cloud) storage.cloud = null;
    };
  }, [editor, documentId, aiOn, account, editable, complete]);

  return <SpellingBubble editor={editor} />;
}
