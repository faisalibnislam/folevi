"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowUp, Loader2 } from "lucide-react";
import { ulid } from "@folevi/editor-schema";
import { api, type Id } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { errorMessage } from "@/components/ui/Toast";
import { AiIcon } from "../AiIcon";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "../AiCredits";
import { AssistantMessage, UserMessage, type Citation } from "./ChatMessage";
import { ContextChips } from "./ContextChips";
import { citationHref, WHOLE_SCOPE, type ChatContext } from "./chatText";
import type { ActionsOutcome, AiAction } from "./ActionsCard";
import type { RunActivity } from "./AgentRunCard";

export const SUGGESTIONS = ["What am I working on this week?", "Summarize my notes about travel", "Which tasks are still open?", "What ideas have I written down recently?"];
const FOLDER_SUGGESTIONS = ["Summarize this folder", "What are the open questions here?", "What decisions have been made?", "What should I do next?"];
const NOTE_SUGGESTIONS = ["Summarize this", "What are the action items?", "What questions are still open?", "Explain it simply"];
const AGENT_SUGGESTIONS = ["Put my notes about travel in a Travel folder", "Turn the open questions in my notes into tasks", "Find notes that look like duplicates", "Tag my recent notes by topic"];
const AGENT_NOTE_SUGGESTIONS = ["Turn the action items into tasks with dates", "Tidy up the headings", "Add a short summary at the top", "Suggest a better title"];

/** Chat ("ask") answers from your notes; Agent can also propose changes to them (nothing changes until you approve). */
export type ChatMode = "ask" | "agent";
const IDLE: RunActivity = { busy: null, error: null };

/** Focus the chat's box (⌘J on the AI page). */
export const AI_FOCUS_EVENT = "folevi:ai-focus";

/**
 * One AI conversation: its messages (answers stream in, with sources, follow-ups and proposed changes),
 * what it's about (context chips) and the box to ask in. Shared by the AI page and the floating chat.
 * A new conversation gets its id on the first question (`onConversation`).
 */
export function ChatThread({
  conversationId,
  onConversation,
  initialContext,
  initialNames,
  initialDraft,
  onNavigate,
  variant,
  autoFocus,
  initialMode,
}: {
  conversationId: string | null;
  onConversation: (id: string) => void;
  /** What a new conversation is about (a folder, a note); the whole scope by default. */
  initialContext?: ChatContext;
  /** Names for the notes or folder in `initialContext`. */
  initialNames?: Record<string, string>;
  initialDraft?: string;
  /** Called before leaving for a note or folder (the floating chat closes). */
  onNavigate?: () => void;
  variant: "page" | "floating" | "panel";
  autoFocus?: boolean;
  /** Start in Agent mode (the note's AI sidebar does). */
  initialMode?: ChatMode;
}) {
  const { scope } = useAppState();
  const { navigate } = useAppRouter();
  const data = useQuery(api.aiChat.get, conversationId ? { conversationId } : "skip");
  const sendAction = useAction(api.aiChat.send);
  const regenerateAction = useAction(api.aiChat.regenerate);
  const editAction = useAction(api.aiChat.edit);
  const stop = useMutation(api.aiChat.stop);
  const setContextMutation = useMutation(api.aiChat.setContext);
  const applyActions = useMutation(api.aiActions.apply);
  const setOutcome = useMutation(api.aiChat.setActionsOutcome);
  const agentSend = useAction(api.aiAgent.send);
  const agentRegenerate = useAction(api.aiAgent.regenerate);
  const agentEdit = useAction(api.aiAgent.edit);
  const approveRun = useAction(api.aiAgent.approve);
  const undoRun = useAction(api.aiAgent.undo);
  const discardRun = useMutation(api.aiAgent.discard);
  const [mode, setMode] = useState<ChatMode>(initialMode ?? "ask");
  const [runs, setRuns] = useState<Record<string, RunActivity>>({});

  const [draft, setDraft] = useState(initialDraft ?? "");
  const [newContext, setNewContext] = useState<ChatContext>(initialContext ?? WHOLE_SCOPE);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ text: string; after: number } | null>(null);
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const [applying, setApplying] = useState<Record<string, ActionsOutcome>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);
  useEffect(() => {
    setNewContext(initialContext ?? WHOLE_SCOPE);
  }, [initialContext]);
  useEffect(() => {
    setProblem(null);
    setPending(null);
  }, [conversationId]);
  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => inputRef.current?.focus());
  }, [autoFocus, conversationId]);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(AI_FOCUS_EVENT, focus);
    return () => window.removeEventListener(AI_FOCUS_EVENT, focus);
  }, []);

  const messages = data?.messages ?? [];
  const conversation = data?.conversation ?? null;
  // The question just sent, until the server has it.
  const showPending = pending && messages.length <= pending.after ? pending.text : null;
  const streaming = messages.some((m) => m.status === "streaming");
  const working = busy || streaming;
  const context: ChatContext = conversation ? { kind: conversation.context.kind, ids: conversation.context.items.map((i) => i.id) } : newContext;
  const names: Record<string, string> = { ...initialNames, ...Object.fromEntries((conversation?.context.items ?? []).map((i) => [i.id, i.name])) };
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const answering = Boolean(messages[messages.length - 1]?.text);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, showPending, answering]);

  // The box grows with what's typed, from two lines up to about six (then it scrolls).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !el.getClientRects().length) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 21;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = "auto";
    const max = line * 6 + pad;
    el.style.height = `${Math.max(line * 2 + pad, Math.min(el.scrollHeight, max))}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(aiProblem(e));
    } finally {
      setBusy(false);
      setPending(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const send = (text: string) => {
    const q = text.trim();
    if (!q || working) return;
    let id = conversationId;
    // What it's about goes with the first question (a conversation that's still loading keeps its own).
    const isNew = !id || data === null;
    if (!id) {
      id = ulid();
      onConversation(id);
    }
    setDraft("");
    setPending({ text: q, after: messages.length });
    const target = id;
    const sendIt = mode === "agent" ? agentSend : sendAction;
    void run(() => sendIt({ scope: conversation?.scope ?? scope, conversationId: target, text: q, context: isNew ? newContext : undefined }));
  };

  const changeContext = (next: ChatContext) => {
    if (!conversation || !conversationId) return setNewContext(next);
    void setContextMutation({ conversationId, context: next }).catch((e) => setProblem(aiProblem(e)));
  };

  const open = (href: string) => {
    onNavigate?.();
    navigate(href);
  };
  const cite = (c: Citation) => {
    open(citationHref(c));
    // The note may already be open: it listens for this to scroll to the block.
    if (c.blockId) setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 0);
  };

  const apply = async (messageId: Id<"aiMessages">, actions: AiAction[]) => {
    if (!conversation) return;
    setApplying((a) => ({ ...a, [messageId]: "applying" }));
    try {
      const result = await applyActions({ scope: conversation.scope, actions });
      await setOutcome({ messageId, outcome: { kind: "applied", ...result } });
      setApplying((a) => ({ ...a, [messageId]: undefined }));
    } catch (e) {
      setApplying((a) => ({ ...a, [messageId]: { error: errorMessage(e) } }));
    }
  };

  /** Runs an action on an agent's proposed changes, showing it on the card while it's on its way. */
  const onRun = async (runId: string, busy: NonNullable<RunActivity["busy"]>, work: () => Promise<unknown>) => {
    setRuns((r) => ({ ...r, [runId]: { busy, error: null } }));
    try {
      await work();
      setRuns((r) => ({ ...r, [runId]: IDLE }));
    } catch (e) {
      setRuns((r) => ({ ...r, [runId]: { busy: null, error: errorMessage(e) } }));
    }
  };
  const runHandlers = (runId: string) => ({
    activity: runs[runId] ?? IDLE,
    onApprove: (operationIds: string[]) => void onRun(runId, "approving", () => approveRun({ runId, operationIds })),
    onDiscard: () => void onRun(runId, "discarding", () => discardRun({ runId })),
    onUndo: (changed?: "all" | "rest") => void onRun(runId, "undoing", () => undoRun({ runId, ...(changed ? { changed } : {}) })),
  });

  const empty = !messages.length && !showPending;
  const aboutNotes = context.kind === "note" || context.kind === "notes";
  const suggestions = mode === "agent" ? (aboutNotes ? AGENT_NOTE_SUGGESTIONS : AGENT_SUGGESTIONS) : context.kind === "folder" ? FOLDER_SUGGESTIONS : aboutNotes ? NOTE_SUGGESTIONS : SUGGESTIONS;
  const page = variant === "page";
  const loading = Boolean(conversationId && data === undefined);

  let intro: ReactNode = null;
  if (empty && !loading) {
    intro = page ? (
      <div className="mx-auto flex max-w-xl flex-col items-center pt-[12vh] text-center">
        <AiIcon size={28} aria-hidden />
        <h2 className="ui-display mt-4 text-[28px] leading-tight text-heading">What can I help you with?</h2>
        <p className="mt-2 text-[14px] text-muted">{mode === "agent" ? "Ask it to organize, edit or create notes. It shows every change first, and nothing happens until you approve." : "Ask about your notes, get a summary, or have it draft something. Answers link to the notes they come from."}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-full bg-[var(--glass-hover)] px-3.5 py-2 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
              {s}
            </button>
          ))}
        </div>
      </div>
    ) : (
      <div>
        <p className="text-[13.5px] text-muted">{mode === "agent" ? "The agent can read your notes and propose changes: new notes, edits, folders, tags and tasks. Nothing changes until you approve it." : context.kind === "folder" ? "Answers come from the notes in this folder, with links to the notes used." : context.kind === "workspace" ? "Answers come from your notes, with links to the notes used." : "Answers come from the notes below, with links to what they used."}</p>
        <p className="mb-2.5 mt-5 flex items-center gap-2 text-[12.5px] font-medium text-muted">
          <AiIcon size={13} aria-hidden /> Try asking
        </p>
        <div className="flex flex-col items-start gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-full bg-[var(--glass-hover)] px-3 py-1.5 text-left text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`min-h-0 flex-1 overflow-y-auto ${page ? "px-4 py-6 sm:px-8" : variant === "panel" ? "px-0.5 py-2" : "px-4 py-4"}`} aria-live="polite">
        <div className={`space-y-5 ${page ? "mx-auto max-w-3xl" : ""}`}>
          {loading ? (
            <p className="flex items-center gap-2 px-1 text-[13px] text-muted">
              <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> Loading the conversation…
            </p>
          ) : null}
          {conversationId && data === null ? <p className="px-1 text-[13.5px] text-muted">This conversation isn&apos;t here anymore. Ask something to start a new one.</p> : null}
          {intro}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={m.id} text={m.text} disabled={working} onEdit={i === lastUser && conversationId ? (text) => void run(() => (mode === "agent" ? agentEdit : editAction)({ conversationId, messageId: m.id, text })) : undefined} />
            ) : m.role === "assistant" ? (
              <AssistantMessage
                key={m.id}
                message={m}
                last={i === messages.length - 1}
                busy={working}
                outcome={applying[m.id] ?? (m.actionsOutcome?.kind === "applied" ? m.actionsOutcome : m.actionsOutcome?.kind === "dismissed" ? "dismissed" : undefined)}
                onCite={cite}
                onStop={() => void stop({ messageId: m.id })}
                onRegenerate={() => {
                  if (conversationId) void run(() => (m.agent ? agentRegenerate : regenerateAction)({ conversationId }));
                }}
                onSuggestion={send}
                onApply={() => void apply(m.id, (m.actions ?? []) as AiAction[])}
                onDismiss={() => void setOutcome({ messageId: m.id, outcome: { kind: "dismissed" } })}
                onOpen={open}
                run={m.agent?.run ? runHandlers(m.agent.run.id) : undefined}
              />
            ) : null,
          )}
          {showPending ? (
            <>
              <UserMessage text={showPending} />
              <p role="status" className="flex items-center gap-2 px-1 text-[13px] text-muted">
                <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> Thinking…
              </p>
            </>
          ) : null}
          {problem ? <AiProblemNotice problem={problem} className={problem.kind === "other" ? "rounded-[12px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger" : undefined} /> : null}
          <div ref={endRef} />
        </div>
      </div>

      <div className={`flex-none ${page ? "px-4 pb-4 pt-2 sm:px-8" : variant === "panel" ? "border-t border-line/70 pt-2.5" : "border-t border-line/70 px-3 pb-3 pt-2.5"}`}>
        <div className={page ? "mx-auto max-w-3xl" : ""}>
          <AiCreditsNote className="mb-2" />
          <div className="mb-2 flex flex-wrap items-center gap-2 px-0.5">
            <div className="ui-seg ui-well" role="group" aria-label="How the AI helps">
              <button type="button" aria-pressed={mode === "ask"} onClick={() => setMode("ask")} title="Answers from your notes">
                Chat
              </button>
              <button type="button" aria-pressed={mode === "agent"} onClick={() => setMode("agent")} title="Can propose changes to your notes. Nothing changes until you approve.">
                Agent
              </button>
            </div>
            <ContextChips context={context} names={names} onChange={changeContext} disabled={working} />
          </div>
          <div className="relative w-full rounded-[14px] bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)] focus-within:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_22%,transparent)]">
            <label htmlFor={`${uid}-q`} className="sr-only">
              {mode === "agent" ? "Tell the AI what to change in your notes" : "Ask a question about your notes"}
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
                  send(draft);
                }
              }}
              maxLength={4000}
              placeholder={mode === "agent" ? "Ask the AI to organize, edit or create notes…" : messages.length ? "Ask a follow-up…" : "Ask anything about your notes…"}
              className="block min-h-[4.25rem] w-full resize-none bg-transparent px-3.5 pb-2.5 pr-12 pt-3 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-faint"
            />
            <button type="button" aria-label="Ask" disabled={!draft.trim() || working} onClick={() => send(draft)} className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-full bg-heading text-canvas transition-opacity disabled:opacity-30">
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
          <p className="mt-2 px-1 text-[11px] text-faint">
            AI can make mistakes. Questions and the notes they need go to Google Gemini.
            {conversation?.ephemeral ? " History is off: this conversation is deleted when you close it." : ""}
          </p>
        </div>
      </div>
    </>
  );
}
