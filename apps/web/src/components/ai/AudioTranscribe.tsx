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
// can be summarized, and goes into the note only with Insert below (one undo step). Long recordings are
// paid in AI credits by the minute: the button's tooltip says about how many, and a recording over 10
// minutes shows the cost and asks before anything is sent (aiAttachments.transcribeEstimate).

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

/** "about 1 AI credit", "about 94 AI credits". */
export const aboutCredits = (n: number) => `about ${n.toLocaleString("en-US")} AI credit${n === 1 ? "" : "s"}`;

/** The Transcribe button for an audio block's controls (its tooltip says what it costs, once known). */
export function TranscribeButton({ onClick, busy, title = "Transcribe with Foli AI" }: { onClick: () => void; busy: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} aria-label="Transcribe" title={title} className="grid size-8 flex-none place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading disabled:opacity-40">
      <Captions size={15} aria-hidden />
    </button>
  );
}

type State = { phase: "idle" } | { phase: "confirm" } | { phase: "working" } | { phase: "ready"; transcript: string; summary: string | null; meeting: string | null; view: TranscriptView } | { phase: "error"; problem: AiProblem };

/**
 * Asks before a long recording is transcribed: its length and about what it costs, with Transcribe and
 * Cancel. Nothing is sent until Transcribe.
 */
export function TranscribeConfirm({ minutes, credits, onConfirm, onCancel }: { minutes: number; credits: number; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="region" aria-label="Transcribe this recording" className="ui-card ui-app-colors mt-1.5 overflow-hidden rounded-panel text-ink" contentEditable={false}>
      <p className="px-4 pb-1 pt-3.5 text-[13.5px] leading-[1.5]">
        Transcribing this {minutes}-minute recording uses {aboutCredits(credits)}.
      </p>
      <p className="px-4 text-[12px] text-muted">Long recordings take a few minutes. The transcript shows here before anything goes into the note.</p>
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        <button type="button" onClick={onConfirm} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
          <Captions size={14} aria-hidden /> Transcribe
        </button>
        <button type="button" onClick={onCancel} className="ui-btn ui-btn-ghost h-8 px-2.5 text-[12.5px]">
          Cancel
        </button>
      </div>
      <p className="border-t border-line/60 px-3.5 py-1.5 text-[11px] text-faint">The recording is sent to Google Gemini.</p>
    </div>
  );
}

/**
 * An audio block's transcription: Transcribe (the button), and the preview under the block while there's
 * something to show. A recording over 10 minutes asks first, with what it costs. Insert below puts what's
 * shown (the transcript or its summary) after the block.
 */
export function useTranscription({ fileId, editor, getPos, node, editable, enabled = true }: { fileId: string | null; editor: Editor; getPos: () => number | undefined; node: PmNode; editable: boolean; enabled?: boolean }) {
  const { scope } = useAppState();
  const note = useNoteAi();
  const transcribe = useAction(api.aiAttachments.transcribe);
  const write = useAction(api.ai.write);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [summarizing, setSummarizing] = useState(false);
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const documentId = note?.home?.id;
  // What transcribing would cost (null when it can't be: Transcribe then says why).
  const estimate = useQuery(api.aiAttachments.transcribeEstimate, enabled && fileId && documentId ? { documentId, fileId } : "skip");
  const title = estimate ? `Transcribe with Foli AI (${aboutCredits(estimate.credits)})` : "Transcribe with Foli AI";

  const ask = () => {
    if (state.phase === "working") return;
    if (estimate?.confirm) {
      setProblem(null);
      setState({ phase: "confirm" });
    } else void start();
  };

  const start = async () => {
    if (!fileId || !documentId || state.phase === "working") return;
    setProblem(null);
    setState({ phase: "working" });
    try {
      const { text } = await transcribe({ scope, documentId, fileId });
      setState({ phase: "ready", transcript: text, summary: null, meeting: null, view: "transcript" });
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

  // A meeting summary of the transcript (lib/ai/writing.ts "meetingSummary"): decisions, action items as to-dos…
  const meetingSummary = async () => {
    if (state.phase !== "ready" || !documentId) return;
    setMeetingBusy(true);
    setProblem(null);
    try {
      const { text } = await write({ scope, task: "meetingSummary", documentId, text: state.transcript });
      setState((s) => (s.phase === "ready" ? { ...s, meeting: text, view: "meeting" } : s));
    } catch (e) {
      setProblem(aiProblem(e));
    } finally {
      setMeetingBusy(false);
    }
  };
  // Owners named in a meeting summary become mentions (and to-do assignees) when they can be mentioned here.
  const people = useQuery(api.comments.mentionable, state.phase === "ready" && state.meeting && documentId ? { documentId } : "skip");

  const insert = () => {
    if (state.phase !== "ready" || !editor.isEditable) return;
    const at = getPos();
    if (typeof at !== "number") return;
    const text = state.view === "summary" && state.summary ? state.summary : state.view === "meeting" && state.meeting ? state.meeting : state.transcript;
    insertAiMarkdown(editor, text, { kind: "after", pos: at + node.nodeSize, depth: Number(node.attrs.depth ?? 0) }, { people: state.view === "meeting" ? people : undefined });
    setState({ phase: "idle" });
  };

  const preview =
    state.phase === "idle" ? null : state.phase === "confirm" ? (
      estimate ? (
        <TranscribeConfirm minutes={estimate.minutes} credits={estimate.credits} onConfirm={() => void start()} onCancel={() => setState({ phase: "idle" })} />
      ) : null
    ) : (
      <TranscriptPreview
        working={state.phase === "working"}
        workingNote={state.phase === "working" && estimate?.confirm ? "Long recordings take a few minutes." : undefined}
        transcript={state.phase === "ready" ? state.transcript : ""}
        summary={state.phase === "ready" ? state.summary : null}
        summarizing={summarizing}
        meeting={state.phase === "ready" ? state.meeting : null}
        meetingBusy={meetingBusy}
        view={state.phase === "ready" ? state.view : "transcript"}
        onView={(view) => setState((s) => (s.phase === "ready" ? { ...s, view } : s))}
        problem={state.phase === "error" ? state.problem : problem}
        canInsert={editable}
        onInsert={insert}
        onSummarize={() => void summarize()}
        onMeeting={() => void meetingSummary()}
        onDiscard={() => {
          setState({ phase: "idle" });
          setProblem(null);
        }}
      />
    );

  return { start: ask, busy: state.phase === "working", preview, title };
}
