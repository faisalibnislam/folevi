"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { createPortal } from "react-dom";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowRight, ArrowUp, Check, Copy, FileText, Folder, FolderPlus, Loader2, RotateCcw, X } from "lucide-react";
import { useAppRouter } from "@/lib/app/router";
import { modKey } from "@/lib/hooks/useEngine";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { useAiStream } from "./useAiStream";
import { markdownToPlain } from "./plainText";
import { useAi, type AskTurn } from "./useAi";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { errorMessage } from "@/components/ui/Toast";

/** A change Ask AI proposes (convex/lib/aiActions.ts); nothing happens until the person applies it. */
type AiAction =
  | { type: "createFolder"; name: string }
  | { type: "createNote"; title: string; markdown: string; folderId?: string; folderName?: string }
  | { type: "moveNote"; noteId: string; noteTitle: string; folderId?: string; folderName?: string };

interface Applied {
  folders: { id: string; name: string }[];
  notes: { id: string; title: string }[];
  moved: number;
}

interface Turn {
  question: string;
  answer?: string;
  sources?: { id: string; title: string }[];
  actions?: AiAction[];
  /** "applying", the result, "dismissed", or an error message. */
  outcome?: "applying" | "dismissed" | Applied | { error: string };
  error?: AiProblem;
}

const SUGGESTIONS = ["What am I working on this week?", "Summarize my notes about travel", "Which tasks are still open?", "What ideas have I written down recently?"];
const FOLDER_SUGGESTIONS = ["Summarize this folder", "What are the open questions here?", "What decisions have been made?", "What should I do next?"];

/** The launcher's shadow: soft black at 10%. */
const SHADOW = "shadow-[0_8px_24px_rgb(0_0_0/0.1),0_2px_6px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(255_255_255/0.12)]";

/**
 * Ask AI (⌘J): a chat with your notes that pops out from a floating button in the bottom-right corner.
 * It isn't modal: you can keep reading and writing while it's open. Each answer cites the notes it used;
 * follow-ups keep the conversation. Also opened from the command palette, a folder's menu and the note's
 * AI panel. Shown only where AI is included and turned on (never on Core). When credits run low it says
 * so, and a refused request (out of credits) says what helps.
 */
export function AskAiChat({
  open,
  onOpen,
  onClose,
  initial,
  folder,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  initial?: string;
  /** Only this folder's notes. */
  folder?: { id: string; name: string };
}) {
  const [mounted, setMounted] = useState(false);
  const { route } = useAppRouter();
  // Notes have their own AI tab in the page dock, so the floating button stays out of the way there
  // (⌘J and the dock still open this chat).
  const onNote = route.name === "doc";
  const launcherRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const close = () => {
    onClose();
    requestAnimationFrame(() => launcherRef.current?.focus());
  };

  return createPortal(
    <div className="ai-chat">
      {/* Kept mounted while closed so the conversation survives closing and reopening. */}
      <section
          hidden={!open}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${uid}-title`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
          className={`ui-pop fixed ${onNote ? "bottom-9" : "bottom-[104px]"} right-9 z-[70] flex h-[min(640px,calc(100dvh-136px))] w-[min(420px,calc(100vw-2.5rem))] origin-bottom-right flex-col overflow-hidden !rounded-[18px] animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none max-sm:bottom-[84px] max-sm:right-3 max-sm:w-[calc(100vw-1.5rem)]`}
        >
          <header className="flex flex-none items-center gap-2.5 border-b border-line/70 px-4 py-3">
            <AiIcon size={20} aria-hidden className="flex-none" />
            <h2 id={`${uid}-title`} className="flex-1 text-[14.5px] font-semibold text-heading">
              Ask AI
            </h2>
            <button type="button" aria-label="Close chat" onClick={close} className="grid h-8 w-8 place-items-center rounded-[8px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
              <X size={16} aria-hidden />
            </button>
          </header>
          <Conversation open={open} initial={initial} folder={folder} onNavigate={close} />
      </section>
      {onNote ? null : (
      <button
        ref={launcherRef}
        type="button"
        aria-expanded={open}
        aria-keyshortcuts="Meta+J"
        title={open ? "Close AI Assistant" : `AI Assistant (${modKey()}J)`}
        onClick={() => (open ? close() : onOpen())}
        className={`fixed bottom-9 right-9 z-[70] inline-flex h-12 items-center gap-2.5 rounded-[14px] bg-black pl-4 pr-5 text-[15px] font-medium text-white ${SHADOW} transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#1c1c1f] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black max-sm:bottom-3 max-sm:right-3`}
      >
        {open ? <X size={18} aria-hidden /> : <AiIcon size={17} />}
        <span>AI Assistant</span>
      </button>
      )}
    </div>,
    document.body,
  );
}

function Conversation({ open, initial, folder, onNavigate }: { open: boolean; initial?: string; folder?: { id: string; name: string }; onNavigate: () => void }) {
  const { ask } = useAi();
  const stream = useAiStream();
  const { navigate } = useAppRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  useEffect(() => {
    if (!open) return;
    if (initial) setDraft(initial);
    setScope(folder ?? null);
    if (folder) setTurns([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, initial, folder]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, busy]);

  const applyActions = useMutation(api.aiActions.apply);
  const { scope: appScope } = useAppState();
  const apply = async (index: number) => {
    const turn = turns[index];
    if (!turn?.actions || turn.outcome) return;
    setTurns((ts) => ts.map((t, i) => (i === index ? { ...t, outcome: "applying" } : t)));
    try {
      const result = await applyActions({ scope: appScope, actions: turn.actions });
      setTurns((ts) => ts.map((t, i) => (i === index ? { ...t, outcome: result } : t)));
    } catch (e) {
      setTurns((ts) => ts.map((t, i) => (i === index ? { ...t, outcome: { error: errorMessage(e) } } : t)));
    }
  };
  // The box grows with what's typed, from two lines up to about six (then it scrolls). Measured only while
  // the chat is showing (closed, it has no size), and again whenever it opens.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !open || !el.getClientRects().length) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 21;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = "auto";
    const max = line * 6 + pad;
    el.style.height = `${Math.max(line * 2 + pad, Math.min(el.scrollHeight, max))}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft, open]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: AskTurn[] = turns.flatMap((t) => (t.answer ? [{ role: "user" as const, text: t.question }, { role: "assistant" as const, text: t.answer }] : []));
    setTurns((ts) => [...ts, { question: q }]);
    setDraft("");
    setBusy(true);
    try {
      const streamId = await stream.begin().catch(() => undefined);
      const { answer, sources, actions } = await ask(q, { history, folderId: scope?.id, streamId });
      await stream.finish(answer);
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, answer: answer || "(stopped)", sources, actions: actions?.length ? actions : undefined } : t)));
    } catch (e) {
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: aiProblem(e) } : t)));
    } finally {
      stream.end();
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4" aria-live="polite">
        {!turns.length ? (
          <div>
            <p className="text-[13.5px] text-muted">{scope ? `Answers come from the notes in “${scope.name}”, with links to the notes used.` : "Answers come from your notes, with links to the notes used."}</p>
            <p className="mb-2.5 mt-5 flex items-center gap-2 text-[12.5px] font-medium text-muted">
              <AiIcon size={13} aria-hidden /> Try asking
            </p>
            <div className="flex flex-col items-start gap-2">
              {(scope ? FOLDER_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full bg-[var(--glass-hover)] px-3 py-1.5 text-left text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-heading px-3.5 py-2 text-[14px] text-canvas">{t.question}</p>
            {t.answer ? (
              <div className="rounded-[14px] rounded-bl-[4px] bg-[var(--glass-active)] px-4 py-3 shadow-[var(--glass-edge)]">
                <AiMarkdown markdown={t.answer} />
                {t.actions ? <ActionsCard actions={t.actions} outcome={t.outcome} onApply={() => void apply(i)} onDismiss={() => setTurns((ts) => ts.map((x, k) => (k === i ? { ...x, outcome: "dismissed" } : x)))} onOpen={(href) => { onNavigate(); navigate(href); }} /> : null}
                {t.sources?.length ? (
                  <div className="mt-3 border-t border-line/70 pt-2.5">
                    <p className="ui-caps mb-1.5">Sources</p>
                    <div className="flex flex-wrap gap-1.5">
                      {t.sources.map((s, n) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onNavigate();
                            navigate(`/d/${s.id}`);
                          }}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-hover)] px-2.5 py-1 text-[12.5px] text-ink hover:bg-[var(--glass-active)] hover:text-heading"
                        >
                          <span className="font-semibold text-muted">{n + 1}</span>
                          <FileText size={12} aria-hidden className="flex-none text-muted" />
                          <span className="truncate">{s.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <button type="button" onClick={() => void navigator.clipboard.writeText(markdownToPlain(t.answer!))} className="mt-2 inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
                  <Copy size={12} aria-hidden /> Copy
                </button>
              </div>
            ) : t.error ? (
              <AiProblemNotice problem={t.error} className={t.error.kind === "other" ? "rounded-[12px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger" : undefined} />
            ) : stream.text ? (
              <div className="rounded-[14px] rounded-bl-[4px] bg-[var(--glass-active)] px-4 py-3 shadow-[var(--glass-edge)]" aria-busy="true">
                <StreamingText text={stream.text} />
                <button type="button" onClick={() => stream.stop()} className="mt-1 inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
                  <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" /> Stop
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-2 px-1 text-[13px] text-muted">
                <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> Reading your notes…
              </p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex-none border-t border-line/70 px-3 pb-3 pt-2.5">
        <AiCreditsNote className="mb-2" />
        {scope ? (
          <p className="mb-2 flex flex-wrap items-center gap-1.5 px-1 text-[12.5px] text-muted">
            <Folder size={13} aria-hidden /> In folder <span className="font-semibold text-heading">{scope.name}</span>
            <button type="button" onClick={() => setScope(null)} className="rounded-[6px] px-1.5 py-0.5 text-muted underline-offset-2 hover:bg-[var(--glass-hover)] hover:text-heading">
              Search all notes instead
            </button>
          </p>
        ) : null}
        <div className="relative w-full rounded-[14px] bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)] focus-within:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_22%,transparent)]">
          <label htmlFor={`${uid}-q`} className="sr-only">
            Ask a question about your notes
          </label>
          <textarea
            id={`${uid}-q`}
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask anything about your notes…"}
            className="block min-h-[4.25rem] w-full resize-none bg-transparent px-3.5 pb-2.5 pr-12 pt-3 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-faint"
          />
          <button type="button" aria-label="Ask" disabled={!draft.trim() || busy} onClick={() => void send(draft)} className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-full bg-heading text-canvas transition-opacity disabled:opacity-30">
            <ArrowUp size={16} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[11px] text-faint">
          <span>AI can make mistakes. Questions and the notes they need go to Google Gemini.</span>
          {turns.length ? (
            <button type="button" onClick={() => setTurns([])} className="inline-flex flex-none items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <RotateCcw size={12} aria-hidden /> New chat
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** The changes Ask AI proposes, to check and apply (or not). After applying, links to what was made. */
function ActionsCard({ actions, outcome, onApply, onDismiss, onOpen }: { actions: AiAction[]; outcome: Turn["outcome"]; onApply: () => void; onDismiss: () => void; onOpen: (href: string) => void }) {
  const where = (a: { folderId?: string; folderName?: string }) => (a.folderName ? ` in ${a.folderName}` : "");
  const applied = outcome && typeof outcome === "object" && "notes" in outcome ? outcome : null;
  return (
    <div className="mt-3 rounded-[12px] bg-[var(--glass-hover)] p-3 shadow-[inset_0_0_0_1px_var(--glass-border)]">
      <p className="ui-caps mb-2">{applied ? "Done" : "Changes to make"}</p>
      <ul className="space-y-1.5 text-[13px] text-ink">
        {actions.map((a, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 flex-none text-muted" aria-hidden>
              {applied ? <Check size={14} /> : a.type === "createFolder" ? <FolderPlus size={14} /> : a.type === "createNote" ? <FileText size={14} /> : <ArrowRight size={14} />}
            </span>
            <span className="min-w-0">
              {a.type === "createFolder" ? (
                <>New folder <strong className="font-semibold text-heading">{a.name}</strong></>
              ) : a.type === "createNote" ? (
                <>New note <strong className="font-semibold text-heading">{a.title}</strong>{where(a)}</>
              ) : (
                <>Move <strong className="font-semibold text-heading">{a.noteTitle}</strong> to {a.folderName ?? "the folder"}</>
              )}
            </span>
          </li>
        ))}
      </ul>
      {applied ? (
        applied.notes.length || applied.folders.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {applied.folders.map((f) => (
              <button key={f.id} type="button" onClick={() => onOpen(`/folders/${f.id}`)} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-active)] px-2.5 py-1 text-[12.5px] text-ink hover:text-heading">
                <Folder size={12} aria-hidden className="flex-none text-muted" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
            {applied.notes.map((n) => (
              <button key={n.id} type="button" onClick={() => onOpen(`/d/${n.id}`)} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-active)] px-2.5 py-1 text-[12.5px] text-ink hover:text-heading">
                <FileText size={12} aria-hidden className="flex-none text-muted" />
                <span className="truncate">{n.title}</span>
              </button>
            ))}
          </div>
        ) : null
      ) : outcome === "dismissed" ? (
        <p className="mt-2 text-[12.5px] text-muted">Not applied.</p>
      ) : (
        <>
          {outcome && typeof outcome === "object" && "error" in outcome ? (
            <p role="alert" className="mt-2 text-[12.5px] text-danger">
              {outcome.error}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onApply} disabled={outcome === "applying"} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-heading px-3 text-[13px] font-medium text-canvas disabled:opacity-60">
              {outcome === "applying" ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check size={14} aria-hidden />}
              {outcome === "applying" ? "Applying…" : "Apply changes"}
            </button>
            <button type="button" onClick={onDismiss} disabled={outcome === "applying"} className="h-8 rounded-[8px] px-3 text-[13px] text-muted hover:bg-[var(--glass-active)] hover:text-heading">
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
