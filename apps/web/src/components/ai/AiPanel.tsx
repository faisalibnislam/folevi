"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowDownToLine, ArrowUp, Check, Copy, CornerDownLeft, FilePlus2, FileText, Lightbulb, ListChecks, ListTree, Loader2, PenLine, RotateCcw, Type, Users, X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { AppLink } from "@/lib/app/router";
import { useShell } from "@/components/app/Shell";
import { Select } from "@/components/ui/Select";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { useAiStream } from "./useAiStream";
import { insertAiMarkdown, type AiPlacement } from "./insert";
import { markdownToPlain } from "./plainText";
import { AI_TOOLS, REWRITE_TASKS, SELECTION_ACTIONS, TOOL_TASKS, useAi, type AiRunDetail, type AiTask } from "./useAi";
import { StudyMode } from "./StudyMode";
import { TranslateNote } from "./TranslateNote";
import { TOOL_ICONS } from "./toolIcons";
import { AI_LANGUAGES } from "./languages";
import { aiDiff } from "./aiDiff";
import { AiDiffLegend, AiDiffView } from "./AiDiffView";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { ChatThread } from "./chat/ChatThread";
import { AiAnnouncer, useDoneAnnouncement } from "./announce";

const NOTE_ACTIONS: { task: AiTask; label: string; icon: React.ReactNode }[] = [
  { task: "summarize", label: "Summarize", icon: <FileText size={15} /> },
  { task: "continue", label: "Continue", icon: <PenLine size={15} /> },
  { task: "actions", label: "Action items", icon: <ListChecks size={15} /> },
  { task: "outline", label: "Outline", icon: <ListTree size={15} /> },
  { task: "brainstorm", label: "Brainstorm", icon: <Lightbulb size={15} /> },
  { task: "title", label: "Title", icon: <Type size={15} /> },
  { task: "meetingSummary", label: "Meeting", icon: <Users size={15} /> },
  { task: "flashcards", label: "Flashcards", icon: TOOL_ICONS.flashcards },
  { task: "quiz", label: "Quiz", icon: TOOL_ICONS.quiz },
];
/** Questions about this note, offered in Ask while nothing has been asked yet. */
const ASK_NOTE = ["Sum up this note in three lines", "Who is mentioned, and why?", "What should happen next?"];
/** "Think it through": the decision and brainstorming frameworks. */
const THINK = AI_TOOLS.filter((t) => t.group === "decide" || t.group === "ideas");
const THINK_GROUPS = [
  { group: "decide", label: "Decide" },
  { group: "ideas", label: "Explore ideas" },
] as const;
/** One line on what each framework gives you (full names, never cut off). */
const THINK_HINTS: Partial<Record<AiTask, string>> = {
  prosCons: "Both sides, side by side",
  decisionMatrix: "Score options against what matters",
  swot: "Strengths, weaknesses, opportunities, threats",
  risks: "What could go wrong, and what to do",
  premortem: "Imagine it failed, then find out why",
  mindMap: "Branch out from the main idea",
  howMightWe: "Turn problems into questions",
  scamper: "Seven prompts to change an idea",
  sixHats: "Look at it from six angles",
};

const labelFor = (task: AiTask) => (task === "refine" ? "Revised" : null) ?? AI_TOOLS.find((a) => a.task === task)?.label ?? SELECTION_ACTIONS.find((a) => a.task === task)?.label.replace("…", "") ?? NOTE_ACTIONS.find((a) => a.task === task)?.label ?? (task === "draft" ? "Written for you" : "Answer");

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
  const { ask, write, saveDraft } = useAi();
  const { navigate } = useAppRouter();
  const meta = useQuery(api.documents.get, { documentId });
  const stream = useAiStream();
  const { openAsk } = useShell();
  const [mode, setMode] = useState<"write" | "ask" | "agent" | "study">("write");
  /** The Agent tab's conversation (about this note), once it has one. */
  const [agentConversation, setAgentConversation] = useState<string | null>(null);
  // The Agent tab is about the note it's open on (one object while the note stays, so the chat keeps it).
  const agentContext = useMemo(() => ({ kind: "note" as const, ids: [documentId] }), [documentId]);
  useEffect(() => setAgentConversation(null), [documentId]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const people = useQuery(api.comments.mentionable, result?.kind === "write" && result.task === "meetingSummary" ? { documentId } : "skip");
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
    // A meeting summary's "@Owner" becomes a mention (and the to-do's assignee) when they can be mentioned here.
    const opts = { people: result.kind === "write" && result.task === "meetingSummary" ? people : undefined };
    if (!insertAiMarkdown(editor, result.text, placement, opts)) {
      // The selection changed since it was sent: don't overwrite anything, put the result below instead.
      insertAiMarkdown(editor, result.text, { kind: "cursor" }, opts);
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

  /** Runs a tool on the selected text (the result goes below it), or on the whole note. */
  const runTool = (task: AiTask) => {
    const sel = selectionText();
    void doWrite({ task, text: sel?.text, placement: sel ? { kind: "below", at: sel.to } : { kind: "cursor" } });
  };

  /** Saves a tool's result as a new note ("Meeting summary: Weekly sync") and opens it. */
  const saveAsNote = async () => {
    if (!result || result.kind !== "write" || busy) return;
    const title = meta?.document.title?.trim();
    setBusy("Saving");
    setError(null);
    try {
      const { id } = await saveDraft("note", title ? `${labelFor(result.task)}: ${title}` : labelFor(result.task), result.text, { people: result.task === "meetingSummary" });
      setResult(null);
      navigate(`/d/${id}`);
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(null);
    }
  };

  // Said once when a result is ready (the streaming text isn't announced word by word).
  const announce = useDoneAnnouncement(Boolean(busy), error ? "" : "Done. The result is below.");


  const modes = (
    <div className="ui-seg ui-well mb-2" role="group" aria-label="What Foli should do">
      <button type="button" aria-pressed={mode === "write"} onClick={() => setMode("write")}>
        Write
      </button>
      <button type="button" aria-pressed={mode === "ask"} onClick={() => setMode("ask")}>
        Ask
      </button>
      <button type="button" aria-pressed={mode === "agent"} onClick={() => setMode("agent")} title="Can propose changes to this note and your others. Nothing changes until you approve.">
        Agent
      </button>
      <button type="button" aria-pressed={mode === "study"} onClick={() => setMode("study")} title="Study this note's flashcards and quiz">
        Study
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

  // Study: the note's flashcards and quiz; making more goes through the usual preview (in Write).
  if (mode === "study") {
    return (
      <div className="text-sm">
        {modes}
        <StudyMode
          editor={editor}
          canMake={!readOnly}
          busy={Boolean(busy)}
          onMake={(task) => {
            setMode("write");
            runTool(task);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Prompt */}
      <section aria-label="Ask Foli">
        {modes}
        <div className="relative rounded-[14px] bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)] focus-within:shadow-[inset_0_0_0_1.5px_var(--color-focus)]">
          <label htmlFor={`${uid}-prompt`} className="sr-only">
            {mode === "write" ? "Tell Foli what to write" : "Ask about this note and your other notes"}
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
            className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-[6px] bg-heading text-canvas transition-opacity disabled:opacity-30"
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
          {/* An empty note: say where to start (most actions need something to work on). */}
          {editor && !editor.state.doc.textContent.trim() ? <p className="mb-2 px-1 text-[12.5px] text-muted">This note is empty. Tell Foli what to write above, or brainstorm ideas to get started.</p> : null}
          <div className="grid grid-cols-2 gap-1.5">
            {NOTE_ACTIONS.map((a) => (
              <button
                key={a.task}
                type="button"
                disabled={Boolean(busy) || (readOnly && a.task !== "summarize" && !TOOL_TASKS.has(a.task))}
                onClick={() => (TOOL_TASKS.has(a.task) ? runTool(a.task) : void doWrite({ task: a.task, placement: a.task === "summarize" ? { kind: "cursor" } : a.task === "continue" ? { kind: "end" } : { kind: "cursor" } }))}
                className="flex h-10 items-center gap-2 rounded-[10px] bg-[var(--glass-hover)] px-2.5 text-left text-[13px] text-ink transition-colors hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-40"
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
        <>
          {/* Nothing asked yet: questions that fit this note. */}
          {!result && !busy ? (
            <section aria-labelledby={`${uid}-ask`}>
              <h3 id={`${uid}-ask`} className="ui-caps mb-2 px-1">
                Ask Foli about this note
              </h3>
              <div className="flex flex-col items-start gap-1.5">
                {ASK_NOTE.map((q) => (
                  <button key={q} type="button" onClick={() => void doAsk(q)} className="rounded-[6px] bg-[var(--glass-hover)] px-2.5 py-1 text-left text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
                    {q}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <button type="button" onClick={() => openAsk(prompt)} className="px-1 text-[12.5px] text-muted underline-offset-2 hover:text-heading hover:underline">
            Open the full Foli chat (⌘J)
          </button>
        </>
      )}

      {/* Status (the streaming text isn't a live region: the announcer says when it's done) */}
      <AiAnnouncer text={announce} />
      <div className="empty:hidden">
        {busy && stream.text ? (
          <div className="rounded-[14px] bg-[var(--glass-active)] p-3 shadow-[var(--glass-edge)]" aria-busy="true">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
              <AiIcon size={13} aria-hidden className="animate-pulse motion-reduce:animate-none" /> {busy}…
            </p>
            <div className="max-h-[320px] overflow-y-auto pr-1">
              <StreamingText text={stream.text} />
            </div>
            <button type="button" onClick={() => stream.stop()} className="mt-1 inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <span aria-hidden className="h-2 w-2 rounded-[4px] bg-current" /> Stop
            </button>
          </div>
        ) : busy ? (
          <p className="flex items-center gap-2 rounded-[10px] bg-[var(--glass-hover)] px-3 py-3 text-muted">
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> {busy}…
          </p>
        ) : null}
        {error ? <AiProblemNotice problem={error} /> : null}
        {notice ? (
          <p role="status" className="px-1 text-[12.5px] text-muted">
            {notice}
          </p>
        ) : null}
      </div>

      {/* Result */}
      {result && !busy ? (
        <section aria-label="AI result" className="rounded-[14px] bg-[var(--glass-active)] p-3 shadow-[var(--glass-edge)]">
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
                <AppLink key={s.id} href={`/d/${s.id}`} className="inline-flex max-w-full items-center gap-1 rounded-[6px] bg-[var(--glass-hover)] px-2 py-0.5 text-[11.5px] text-ink hover:text-heading">
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
            ) : result.kind === "write" && TOOL_TASKS.has(result.task) ? (
              <>
                <button type="button" disabled={readOnly} onClick={() => apply(result.placement)} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                  <CornerDownLeft size={14} aria-hidden /> {result.placement.kind === "below" ? "Insert below" : "Insert into note"}
                </button>
                <button type="button" disabled={readOnly} onClick={() => apply({ kind: "end" })} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
                  <ArrowDownToLine size={14} aria-hidden /> Append
                </button>
                <button type="button" onClick={() => void saveAsNote()} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
                  <FilePlus2 size={14} aria-hidden /> Create note
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
            <button
              type="button"
              onClick={() => {
                setResult(null);
                // The button goes with the result: focus back to the prompt, not lost.
                inputRef.current?.focus();
              }}
              aria-label="Discard"
              title="Discard"
              className="ui-btn ui-btn-ghost ml-auto h-8 w-8 px-0"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          {result.kind === "write" && result.task !== "title" ? (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick changes">
              {["Shorter", "Longer", "Simpler", "More formal", "More casual"].map((r) => (
                <button
                  key={r}
                  type="button"
                  // A tool runs again with the request (its result keeps its shape); anything else is revised.
                  onClick={() => void doWrite(TOOL_TASKS.has(result.task) ? { ...result.request, instruction: r } : { task: "refine", text: result.text, instruction: r, placement: result.placement })}
                  className="rounded-[6px] bg-[var(--glass-hover)] px-2.5 py-1 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading"
                >
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Decision and brainstorming frameworks, then translating the whole note */}
      {mode === "write" ? (
        <>
          <section aria-labelledby={`${uid}-think`} className="space-y-3">
            <h3 id={`${uid}-think`} className="ui-caps px-1">
              Think it through
            </h3>
            {THINK_GROUPS.map((g) => (
              <div key={g.group} role="group" aria-label={g.label}>
                <p className="mb-1.5 px-1 text-[12px] font-medium text-muted">{g.label}</p>
                <ul className="space-y-1">
                  {THINK.filter((a) => a.group === g.group).map((a) => (
                    <li key={a.task}>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => runTool(a.task)}
                        aria-label={a.label}
                        aria-describedby={`${uid}-hint-${a.task}`}
                        className="flex w-full items-start gap-2.5 rounded-[10px] bg-[var(--glass-hover)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-40"
                      >
                        <span aria-hidden className="mt-0.5 flex-none text-muted">
                          {TOOL_ICONS[a.task]}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] leading-snug text-ink">{a.label}</span>
                          <span id={`${uid}-hint-${a.task}`} className="block text-[11.5px] leading-snug text-muted">{THINK_HINTS[a.task]}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <TranslateNote documentId={documentId} editor={editor} readOnly={readOnly} disabled={Boolean(busy)} />
        </>
      ) : null}

      <p className="px-1 text-[11px] leading-snug text-faint">Foli is AI and can make mistakes.</p>
    </div>
  );
}
