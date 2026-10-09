"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PmNode } from "@tiptap/pm/model";
import { useAction, useQuery } from "convex/react";
import { Captions } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useEditorEnvironment } from "@/components/editor/environment";
import { aiProblem, type AiProblem } from "./AiCredits";
import { insertAiMarkdown } from "./insert";
import { TranscriptPreview, type TranscriptView } from "./TranscriptPreview";
import { useAiAccess, useNoteAi } from "./useAi";

// Transcribe on an audio block (docs/AI_ASSISTANT.md, "Attachments"): never automatic. The recording goes
// to the AI only when the person presses Transcribe; the transcript shows in a preview under the block,
// can be summarized, and goes into the note only with Insert below (one undo step).

/**
 * Whether an audio block can offer Transcribe: an uploaded recording in a note, AI on where the note
 * lives, Settings > AI allowing recordings to be read, and a model that listens. The server checks again.
 */
export function useCanTranscribe(fileId: string | null): boolean {
  const env = useEditorEnvironment();
  const ai = useAiAccess();
  const note = useNoteAi();
  const { profile } = useAppState();
  const prefsOn = (profile as { aiPrefs?: { attachments?: boolean } }).aiPrefs?.attachments !== false;
  const caps = useQuery(api.aiChat.capabilities, ai.on && prefsOn && !env.demo ? {} : "skip");
  return Boolean(fileId && note?.home?.id && !env.demo && ai.on && prefsOn && caps?.audioIn);
}

/** The Transcribe button for an audio block's controls. */
export function TranscribeButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} aria-label="Transcribe" title="Transcribe with AI" className="grid size-8 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading disabled:opacity-40">
      <Captions size={15} aria-hidden />
    </button>
  );
}

type State = { phase: "idle" } | { phase: "working" } | { phase: "ready"; transcript: string; summary: string | null; view: TranscriptView } | { phase: "error"; problem: AiProblem };

/**
 * An audio block's transcription: Transcribe (the button), and the preview under the block while there's
 * something to show. Insert below puts what's shown (the transcript or its summary) after the block.
 */
export function useTranscription({ fileId, editor, getPos, node, editable }: { fileId: string | null; editor: Editor; getPos: () => number | undefined; node: PmNode; editable: boolean }) {
  const { scope } = useAppState();
  const note = useNoteAi();
  const transcribe = useAction(api.aiAttachments.transcribe);
  const write = useAction(api.ai.write);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [summarizing, setSummarizing] = useState(false);
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const documentId = note?.home?.id;

  const start = async () => {
    if (!fileId || !documentId || state.phase === "working") return;
    setProblem(null);
    setState({ phase: "working" });
    try {
      const { text } = await transcribe({ scope, documentId, fileId });
      setState({ phase: "ready", transcript: text, summary: null, view: "transcript" });
    } catch (e) {
      setState({ phase: "error", problem: aiProblem(e) });
    }
  };

  const summarize = async () => {
    if (state.phase !== "ready" || !documentId) return;
    setSummarizing(true);
    setProblem(null);
    try {
      const { text } = await write({ scope, task: "summarizeText", documentId, text: state.transcript });
      setState((s) => (s.phase === "ready" ? { ...s, summary: text, view: "summary" } : s));
    } catch (e) {
      setProblem(aiProblem(e));
    } finally {
      setSummarizing(false);
    }
  };

  const insert = () => {
    if (state.phase !== "ready" || !editor.isEditable) return;
    const at = getPos();
    if (typeof at !== "number") return;
    const text = state.view === "summary" && state.summary ? state.summary : state.transcript;
    insertAiMarkdown(editor, text, { kind: "after", pos: at + node.nodeSize, depth: Number(node.attrs.depth ?? 0) });
    setState({ phase: "idle" });
  };

  const preview =
    state.phase === "idle" ? null : (
      <TranscriptPreview
        working={state.phase === "working"}
        transcript={state.phase === "ready" ? state.transcript : ""}
        summary={state.phase === "ready" ? state.summary : null}
        summarizing={summarizing}
        view={state.phase === "ready" ? state.view : "transcript"}
        onView={(view) => setState((s) => (s.phase === "ready" ? { ...s, view } : s))}
        problem={state.phase === "error" ? state.problem : problem}
        canInsert={editable}
        onInsert={insert}
        onSummarize={() => void summarize()}
        onDiscard={() => {
          setState({ phase: "idle" });
          setProblem(null);
        }}
      />
    );

  return { start: () => void start(), busy: state.phase === "working", preview };
}
