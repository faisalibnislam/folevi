"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowUp, Check, Copy, CornerDownLeft, FileText, Lightbulb, ListChecks, ListTree, Loader2, PenLine, RotateCcw, Type, X } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { useShell } from "@/components/app/Shell";
import { Select } from "@/components/ui/Select";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { useAiStream } from "./useAiStream";
import { insertAiMarkdown, type AiPlacement } from "./insert";
import { markdownToPlain } from "./plainText";
import { REWRITE_TASKS, SELECTION_ACTIONS, useAi, type AiRunDetail, type AiTask } from "./useAi";
import { AI_LANGUAGES } from "./languages";
import { aiDiff } from "./aiDiff";
import { AiDiffLegend, AiDiffView } from "./AiDiffView";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { ChatThread } from "./chat/ChatThread";

const NOTE_ACTIONS: { task: AiTask; label: string; icon: React.ReactNode }[] = [
  { task: "summarize", label: "Summarize", icon: <FileText size={15} /> },
  { task: "continue", label: "Continue writing", icon: <PenLine size={15} /> },
  { task: "actions", label: "Action items", icon: <ListChecks size={15} /> },
  { task: "outline", label: "Outline", icon: <ListTree size={15} /> },
  { task: "brainstorm", label: "Brainstorm ideas", icon: <Lightbulb size={15} /> },
  { task: "title", label: "Suggest a title", icon: <Type size={15} /> },
];

const labelFor = (task: AiTask) => (task === "refine" ? "Revised" : null) ?? SELECTION_ACTIONS.find((a) => a.task === task)?.label.replace("…", "") ?? NOTE_ACTIONS.find((a) => a.task === task)?.label ?? (task === "draft" ? "Written for you" : "Answer");

type Result =
  | { kind: "write"; task: AiTask; text: string; placement: AiPlacement; request: Request }
  | { kind: "ask"; question: string; text: string; sources: { id: string; title: string }[] };
interface Request {
  task: AiTask;
  text?: string;
  instruction?: string;
  language?: string;
  placement: AiPlacement;
}

/**
 * The note's AI panel (dock → AI): one-click writing help for the note, a prompt that writes or answers,
 * and a result you can insert, use to replace the selection, copy, retry or discard.
 */
export function AiPanel({
  documentId,
  editor,
  readOnly,
  run,
  onTitle,
}: {
  documentId: string;
  editor: Editor | null;
  readOnly: boolean;
  /** A request from the editor (a selection rewrite); runs when it changes. */
  run: (AiRunDetail & { id: number }) | null;
  onTitle: (title: string) => void;
}) {
  const { ask, write } = useAi();
  const stream = useAiStream();
  const { openAsk } = useShell();
  const [mode, setMode] = useState<"write" | "ask" | "agent">("write");
  /** The Agent tab's conversation (about this note), once it has one. */
  const [agentConversation, setAgentConversation] = useState<string | null>(null);
  // The Agent tab is about the note it's open on (one object while the note stays, so the chat keeps it).
  const agentContext = useMemo(() => ({ kind: "note" as const, ids: [documentId] }), [documentId]);
  useEffect(() => setAgentConversation(null), [documentId]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRun = useRef<number | null>(null);
  const uid = useId();

  const doWrite = async (req: Request) => {
    setBusy(labelFor(req.task));
    setError(null);
    setNotice(null);
    try {
      const streamId = await stream.begin().catch(() => undefined);
      const { text } = await write(req.task, { documentId, text: req.text, instruction: req.instruction, language: req.language, streamId });
      await stream.finish(text);
      if (text.trim()) setResult({ kind: "write", task: req.task, text, placement: req.placement, request: req });
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      stream.end();
      setBusy(null);
    }
  };

  const doAsk = async (question: string) => {
    setBusy("Reading your notes");
    setError(null);
    setNotice(null);
    try {
      const streamId = await stream.begin().catch(() => undefined);
      const { answer, sources } = await ask(question, { documentId, streamId });
      await stream.finish(answer);
      if (answer.trim()) setResult({ kind: "ask", question, text: answer, sources });
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      stream.end();
      setBusy(null);
    }
  };

  // Ready to type as soon as the panel opens (unless it opened to run a rewrite).
  useEffect(() => {
    if (!run) requestAnimationFrame(() => inputRef.current?.focus());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A rewrite requested from the editor's selection toolbar.
  useEffect(() => {
    if (!run || lastRun.current === run.id) return;
    lastRun.current = run.id;
    void doWrite({ task: run.task, text: run.text, language: run.language, placement: { kind: "replace", from: run.from, to: run.to, original: run.text } });
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectionText = () => {
    if (!editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) return null;
    const text = editor.state.doc.textBetween(from, to, "\n");
    return text.trim() ? { from, to, text } : null;
  };

  const submit = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (mode === "ask") return void doAsk(text);
    const sel = selectionText();
    void doWrite({ task: "draft", instruction: text, text: sel?.text, placement: { kind: "cursor" } });
  };

  const apply = (placement: AiPlacement) => {
    if (!editor || !result) return;
    if (!insertAiMarkdown(editor, result.text, placement)) {
      // The selection changed since it was sent: don't overwrite anything, put the result below instead.
      insertAiMarkdown(editor, result.text, { kind: "cursor" });
      setNotice("The selected text changed, so the result was inserted below it.");
    }
    setResult(null);
  };

  // A rewrite that keeps most of the text shows as changes (a translation or a table reads better whole).
  const changes =
    result?.kind === "write" && result.placement.kind === "replace" && REWRITE_TASKS.has(result.task) && result.task !== "translate" && result.task !== "toTable"
      ? (() => {
          const d = aiDiff((result.placement as { original: string }).original, result.text);
          return d.kept >= 0.3 && !d.same ? d : null;
        })()
      : null;

  const copy = () => {
    if (!result) return;
    void navigator.clipboard.writeText(markdownToPlain(result.text)).then(() => setNotice("Copied"));
  };

  const modes = (
    <div className="ui-seg ui-well mb-2" role="group" aria-label="What the AI should do">
      <button type="button" aria-pressed={mode === "write"} onClick={() => setMode("write")}>
        Write
      </button>
      <button type="button" aria-pressed={mode === "ask"} onClick={() => setMode("ask")}>
        Ask
      </button>
      <button type="button" aria-pressed={mode === "agent"} onClick={() => setMode("agent")} title="Can propose changes to this note and your others. Nothing changes until you approve.">
        Agent
      </button>
    </div>
  );

  // Agent: a conversation about this note that can propose changes (previewed, approved, undoable).
  if (mode === "agent") {
    return (
      <div className="text-sm">
        {modes}
        <div className="flex h-[min(70vh,640px)] flex-col">
          <ChatThread conversationId={agentConversation} onConversation={setAgentConversation} initialContext={agentContext} variant="panel" initialMode="agent" autoFocus />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Prompt */}
      <section aria-label="Ask AI">
        {modes}
        <div className="relative rounded-[10px] bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)] focus-within:shadow-[inset_0_0_0_1.5px_var(--color-focus)]">
          <label htmlFor={`${uid}-prompt`} className="sr-only">
            {mode === "write" ? "Tell the AI what to write" : "Ask about this note and your other notes"}
          </label>
          <textarea
            id={`${uid}-prompt`}
            ref={inputRef}
            rows={2}
            value={prompt}
            disabled={mode === "write" && readOnly}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={mode === "write" ? "Write a friendly intro paragraph…" : "What did we decide about…?"}
            className="block w-full resize-none bg-transparent px-3 pb-9 pt-2.5 text-[13.5px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            aria-label={mode === "write" ? "Write" : "Ask"}
            disabled={!prompt.trim() || Boolean(busy) || (mode === "write" && readOnly)}
            onClick={submit}
            className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-heading text-canvas transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={15} aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11.5px] text-faint">
          {mode === "write" ? "Uses this note (and any selected text) as context. ↵ to send." : "Answers from this note and your other notes, with sources."}
        </p>
        {/* Writing uses the note's own scope; asking searches where you are. */}
        <AiCreditsNote documentId={mode === "write" ? documentId : undefined} className="mt-2" />
      </section>

      {/* Quick actions */}
      {mode === "write" ? (
        <section aria-labelledby={`${uid}-quick`}>
          <h3 id={`${uid}-quick`} className="ui-caps mb-2 px-1">
            For this note
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {NOTE_ACTIONS.map((a) => (
              <button
                key={a.task}
                type="button"
                disabled={Boolean(busy) || (readOnly && a.task !== "summarize")}
                onClick={() => void doWrite({ task: a.task, placement: a.task === "summarize" ? { kind: "cursor" } : a.task === "continue" ? { kind: "end" } : { kind: "cursor" } })}
                className="flex h-10 items-center gap-2 rounded-[8px] bg-[var(--glass-hover)] px-2.5 text-left text-[13px] text-ink transition-colors hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-40"
              >
                <span aria-hidden className="text-muted">
                  {a.icon}
                </span>
                {a.label}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => openAsk(prompt)} className="px-1 text-[12.5px] text-muted underline-offset-2 hover:text-heading hover:underline">
          Open the full Ask AI window (⌘J)
        </button>
      )}

      {/* Status */}
      <div aria-live="polite" className="empty:hidden">
        {busy && stream.text ? (
          <div className="rounded-[12px] bg-[var(--glass-active)] p-3 shadow-[var(--glass-edge)]" aria-busy="true">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
              <AiIcon size={13} aria-hidden className="animate-pulse motion-reduce:animate-none" /> {busy}…
            </p>
            <div className="max-h-[320px] overflow-y-auto pr-1">
              <StreamingText text={stream.text} />
            </div>
            <button type="button" onClick={() => stream.stop()} className="mt-1 inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" /> Stop
            </button>
          </div>
        ) : busy ? (
          <p className="flex items-center gap-2 rounded-[10px] bg-[var(--glass-hover)] px-3 py-3 text-muted">
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> {busy}…
          </p>
        ) : null}
        {error ? <AiProblemNotice problem={error} /> : null}
        {notice ? <p className="px-1 text-[12.5px] text-muted">{notice}</p> : null}
      </div>

      {/* Result */}
      {result && !busy ? (
        <section aria-label="AI result" className="rounded-[12px] bg-[var(--glass-active)] p-3 shadow-[var(--glass-edge)]">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
            <AiIcon size={13} aria-hidden /> {result.kind === "ask" ? result.question : labelFor(result.task)}
            {result.kind === "write" && result.task === "translate" ? (
              <Select
                aria-label="Language"
                value={result.request.language ?? "English"}
                onChange={(e) => void doWrite({ ...result.request, language: e.target.value })}
                className="ml-auto h-7 rounded-[6px] bg-[var(--glass-hover)] px-2 text-[12px] font-medium text-ink"
              >
                {AI_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          {result.kind === "write" && result.task === "title" ? (
            <p className="font-serif text-[18px] font-semibold text-heading">{result.text}</p>
          ) : changes ? (
            // A rewrite of the selection: what it would remove and add, before anything changes.
            <div className="max-h-[320px] overflow-y-auto pr-1">
              <AiDiffView parts={changes.parts} />
              <AiDiffLegend />
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto pr-1">
              <AiMarkdown markdown={result.text} />
            </div>
          )}
          {result.kind === "ask" && result.sources.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.sources.map((s, i) => (
                <AppLink key={s.id} href={`/d/${s.id}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--glass-hover)] px-2 py-0.5 text-[11.5px] text-ink hover:text-heading">
                  <span className="font-semibold text-muted">{i + 1}</span>
                  <span className="truncate">{s.title}</span>
                </AppLink>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {result.kind === "write" && result.task === "title" ? (
              <button type="button" disabled={readOnly} onClick={() => (onTitle(result.text), setResult(null))} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                <Check size={14} aria-hidden /> Use as title
              </button>
            ) : result.kind === "write" && result.placement.kind === "replace" && REWRITE_TASKS.has(result.task) ? (
              <>
                <button type="button" disabled={readOnly} onClick={() => apply(result.placement)} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                  <Check size={14} aria-hidden /> Replace selection
                </button>
                <button type="button" disabled={readOnly} onClick={() => apply({ kind: "cursor" })} className="ui-btn ui-btn-secondary h-8 px-3 text-[12.5px]">
                  <CornerDownLeft size={14} aria-hidden /> Insert below
                </button>
              </>
            ) : (
              <button type="button" disabled={readOnly} onClick={() => apply(result.kind === "write" && result.placement.kind === "end" ? { kind: "end" } : { kind: "cursor" })} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                <CornerDownLeft size={14} aria-hidden /> {result.kind === "write" && result.placement.kind === "end" ? "Add to the end" : "Insert into note"}
              </button>
            )}
            <button type="button" onClick={copy} aria-label="Copy" title="Copy" className="ui-btn ui-btn-ghost h-8 w-8 px-0">
              <Copy size={14} aria-hidden />
            </button>
            {result.kind === "write" ? (
              <button type="button" onClick={() => void doWrite(result.request)} aria-label="Try again" title="Try again" className="ui-btn ui-btn-ghost h-8 w-8 px-0">
                <RotateCcw size={14} aria-hidden />
              </button>
            ) : null}
            <button type="button" onClick={() => setResult(null)} aria-label="Discard" title="Discard" className="ui-btn ui-btn-ghost ml-auto h-8 w-8 px-0">
              <X size={14} aria-hidden />
            </button>
          </div>
          {result.kind === "write" && result.task !== "title" ? (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick changes">
              {["Shorter", "Longer", "Simpler", "More formal", "More casual"].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void doWrite({ task: "refine", text: result.text, instruction: r, placement: result.placement })}
                  className="rounded-full bg-[var(--glass-hover)] px-2.5 py-1 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading"
                >
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="px-1 text-[11px] leading-snug text-faint">AI can make mistakes, so check what it writes. Your request and the notes it needs are sent to Google Gemini.</p>
    </div>
  );
}
