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
import { AiIntroBody, type AiIntroPlace } from "../AiIntro";
import { AiCreditsNote, AiProblemNotice, aiProblem, useAiCredits, type AiProblem } from "../AiCredits";
import { useAiAccess } from "../useAi";
import { AssistantMessage, UserMessage, type Citation } from "./ChatMessage";
import { ContextChips } from "./ContextChips";
import { citationHref, WHOLE_SCOPE, type ChatContext } from "./chatText";
import type { ActionsOutcome, AiAction } from "./ActionsCard";
import type { RunActivity } from "./AgentRunCard";
import { WebToggle } from "./WebToggle";
import { AttachControl, AttachmentChips, AttachmentProblems, useChatAttachments, type PendingFile } from "./Attachments";
import type { ResearchHandlers } from "./ResearchCard";
import { useChatMode } from "./mode";
import { asksToChange, FIX_IN_NOTE } from "../editIntent";
import { AiAnnouncer, useDoneAnnouncement } from "../announce";

export const SUGGESTIONS = ["What am I working on this week?", "Summarize my notes about travel", "Which tasks are still open?", "What ideas have I written down recently?"];
const FOLDER_SUGGESTIONS = ["Summarize this folder", "What are the open questions here?", "What decisions have been made?", "What should I do next?"];
const NOTE_SUGGESTIONS = ["Summarize this", "What are the action items?", "What questions are still open?", "Explain it simply"];
const AGENT_SUGGESTIONS = ["Put my notes about travel in a Travel folder", "Turn the open questions in my notes into tasks", "Find notes that look like duplicates", "Tag my recent notes by topic"];
const AGENT_NOTE_SUGGESTIONS = ["Turn the action items into tasks with dates", "Tidy up the headings", "Add a short summary at the top", "Suggest a better title"];
const RESEARCH_SUGGESTIONS = ["Compare the best note-taking methods", "What changed in remote work rules this year?", "How do heat pumps compare with gas boilers?", "What are good habits for deep work?"];

/**
 * Chat ("ask") answers from your notes (and the web with the Web switch); Agent can also propose changes to
 * them (nothing changes until you approve); Research writes a cited report from the web and your notes,
 * in the background. Research and the Web switch show only when web research is on in Settings.
 */
export type ChatMode = "ask" | "agent" | "research";
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
  autoSend,
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
  /** Sent as soon as the thread opens (the note panel hands an edit request to the agent this way). */
  autoSend?: string;
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
  const researchStart = useAction(api.aiResearch.start);
  const researchRegenerate = useAction(api.aiResearch.regenerate);
  const cancelResearch = useMutation(api.aiResearch.cancel);
  const saveResearch = useMutation(api.aiResearch.saveAsNote);
  const jobs = useQuery(api.aiResearch.forConversation, conversationId ? { conversationId } : "skip");
  const caps = useQuery(api.aiChat.capabilities, {});
  const ai = useAiAccess();
  // The web (the Web switch, Research) only when Settings > AI allows it, the plan has AI and the model can search.
  const webAvailable = Boolean(ai.on && caps?.prefs.webResearch && caps.searchGrounding);
  // The last mode this person picked (the floating chat and the AI page), unless the surface sets one.
  const [mode, setMode] = useChatMode(initialMode);
  const [web, setWeb] = useState(false);
  const webOn = web && webAvailable && mode === "ask";
  const [runs, setRuns] = useState<Record<string, RunActivity>>({});
  const [saving, setSaving] = useState<Record<string, ResearchHandlers["saving"]>>({});

  const [draft, setDraft] = useState(initialDraft ?? "");
  const [newContext, setNewContext] = useState<ChatContext>(initialContext ?? WHOLE_SCOPE);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ text: string; after: number; files?: PendingFile[] } | null>(null);
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const [applying, setApplying] = useState<Record<string, ActionsOutcome>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);
  useEffect(() => {
    // Once the settings are known: Research needs the web (the remembered pick stays for when it's back).
    if (caps !== undefined && !webAvailable && mode === "research") setMode("ask", { remember: false });
  }, [caps, webAvailable, mode, setMode]);
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
  // Said once when an answer has finished (the streaming text itself isn't announced word by word).
  const lastMessage = messages[messages.length - 1];
  const announce = useDoneAnnouncement(working, lastMessage?.role !== "assistant" || lastMessage.status === "error" ? "" : lastMessage.status === "stopped" ? "Stopped." : "Answer ready.");
  const context: ChatContext = conversation ? { kind: conversation.context.kind, ids: conversation.context.items.map((i) => i.id) } : newContext;
  const names: Record<string, string> = { ...initialNames, ...Object.fromEntries((conversation?.context.items ?? []).map((i) => [i.id, i.name])) };
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  // The answer has started (its text streams separately, aiChat.streamText, so `live` says so first).
  const answering = Boolean(messages[messages.length - 1]?.text || messages[messages.length - 1]?.live);
  // Files for the next message (the Attach control): only when Settings > AI allows reading them, not for Research.
  const attachAvailable = Boolean(ai.on && caps && caps.prefs.attachments !== false) && mode !== "research";
  const attachments = useChatAttachments({ scope: conversation?.scope ?? scope, caps: caps ? { vision: caps.vision, audioIn: caps.audioIn } : undefined });
  const contextNotes = context.kind === "note" || context.kind === "notes" ? context.ids : [];
  const noteFiles = useQuery(api.aiAttachments.noteFiles, attachAvailable && contextNotes.length ? { documentIds: contextNotes } : "skip");
  const clearAttachments = attachments.clear;
  // Another conversation: what was attached for this one doesn't go with it.
  useEffect(() => clearAttachments(), [conversationId, clearAttachments]);

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

  const send = (text: string, as: ChatMode = mode) => {
    const q = text.trim();
    if (!q || working || attachments.uploading) return;
    let id = conversationId;
    // What it's about goes with the first question (a conversation that's still loading keeps its own).
    const isNew = !id || data === null;
    if (!id) {
      id = ulid();
      onConversation(id);
    }
    setDraft("");
    const fileIds = attachAvailable ? attachments.fileIds : [];
    setPending({ text: q, after: messages.length, files: fileIds.length ? attachments.files : undefined });
    attachments.clear();
    const target = id;
    const args = { scope: conversation?.scope ?? scope, conversationId: target, text: q, context: isNew ? newContext : undefined, ...(fileIds.length ? { attachments: fileIds } : {}) };
    if (as === "research") void run(() => researchStart(args));
    else if (as === "agent") void run(() => agentSend(args));
    else void run(() => sendAction({ ...args, ...(webOn ? { web: true } : {}) }));
  };

  // A request handed over by the note panel: sent once, when the thread opens.
  const autoSent = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSend || autoSent.current === autoSend || conversationId) return;
    autoSent.current = autoSend;
    send(autoSend);
  });

  /**
   * "Fix in note": an answer to a request to change the note becomes the agent's job. It edits the note's
   * own blocks in place (previewed, approved, one Undo) instead of the answer being pasted in as a copy.
   */
  const fixInNote = () => {
    setMode("agent", { remember: false });
    send(FIX_IN_NOTE, "agent");
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
  const jobFor = (messageId: string) => jobs?.find((j) => j.messageId === messageId);
  const researchHandlers = (job: NonNullable<ReturnType<typeof jobFor>>): ResearchHandlers => ({
    job,
    saving: saving[job.id] ?? null,
    onCancel: () => void cancelResearch({ researchId: job.id }).catch((e) => setProblem(aiProblem(e))),
    onSave: () => {
      setSaving((s) => ({ ...s, [job.id]: "saving" }));
      void saveResearch({ researchId: job.id }).then(
        () => setSaving((s) => ({ ...s, [job.id]: null })),
        (e) => setSaving((s) => ({ ...s, [job.id]: { error: errorMessage(e) } })),
      );
    },
  });
  const runHandlers = (runId: string) => ({
    activity: runs[runId] ?? IDLE,
    onApprove: (operationIds: string[]) => void onRun(runId, "approving", () => approveRun({ runId, operationIds })),
    onDiscard: () => void onRun(runId, "discarding", () => discardRun({ runId })),
    onUndo: (changed?: "all" | "rest") => void onRun(runId, "undoing", () => undoRun({ runId, ...(changed ? { changed } : {}) })),
  });

  const empty = !messages.length && !showPending;
  const aboutNotes = context.kind === "note" || context.kind === "notes";
  const suggestions = mode === "research" ? RESEARCH_SUGGESTIONS : mode === "agent" ? (aboutNotes ? AGENT_NOTE_SUGGESTIONS : AGENT_SUGGESTIONS) : context.kind === "folder" ? FOLDER_SUGGESTIONS : aboutNotes ? NOTE_SUGGESTIONS : SUGGESTIONS;
  const page = variant === "page";
  const loading = Boolean(conversationId && data === undefined);

  const modeLine = mode === "research" ? "Research searches the web and your notes, then writes a report with sources. It takes a few minutes." : mode === "agent" ? "The agent can read your notes and propose changes: new notes, edits, folders, tags and tasks. Nothing changes until you approve it." : context.kind === "folder" ? "Answers come from the notes in this folder, with links to the notes used." : context.kind === "workspace" ? "Answers come from your notes, with links to the notes used." : "Answers come from the notes below, with links to what they used.";
  const introPlace: AiIntroPlace = context.kind === "folder" ? "folder" : ai.context === "workspace" ? "workspace" : "personal";

  const footNotes = [
    webOn || mode === "research" ? "Web searches go through Google Search." : "",
    attachAvailable && attachments.files.length ? "Attached files go to Google Gemini too." : "",
    conversation?.ephemeral ? "History is off: this conversation is deleted when you close it." : "",
  ].filter(Boolean);
  const introCredits = useAiCredits({ skip: variant === "panel" || !empty });

  let intro: ReactNode = null;
  if (empty && !loading) {
    intro = page ? (
      // Meet Foli: what it does, that it shows changes first, where requests go and what they cost.
      <div className="mx-auto max-w-2xl pt-[8vh]">
        <AiIcon size={28} aria-hidden />
        <h2 className="ui-display mt-4 text-[28px] leading-tight text-heading">Meet Foli</h2>
        <AiIntroBody place={introPlace} credits={introCredits?.aiIncluded ? introCredits.available : null} size="md" />
        {mode !== "ask" ? <p className="mt-3 text-[13.5px] text-muted">{modeLine}</p> : null}
        <p className="mb-2.5 mt-6 flex items-center gap-2 text-[12.5px] font-medium text-muted">
          <AiIcon size={13} aria-hidden /> Try asking
        </p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-control bg-[var(--glass-hover)] px-3.5 py-2 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
              {s}
            </button>
          ))}
        </div>
      </div>
    ) : (
      <div>
        {variant === "floating" ? (
          // Meet Foli: what it does here, that it shows changes first, where requests go and what they cost.
          <>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-heading">
              <AiIcon size={16} aria-hidden /> Meet Foli
            </h3>
            <AiIntroBody place={introPlace} credits={introCredits?.aiIncluded ? introCredits.available : null} size="md" />
            {mode !== "ask" ? <p className="mt-3 text-[13.5px] text-muted">{modeLine}</p> : null}
          </>
        ) : null}
        <p className="mb-2.5 mt-5 flex items-center gap-2 text-[12.5px] font-medium text-muted">
          <AiIcon size={13} aria-hidden /> Try asking
        </p>
        <div className="flex flex-col items-start gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-control bg-[var(--glass-hover)] px-3 py-1.5 text-left text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`min-h-0 flex-1 overflow-y-auto ${page ? "px-4 py-6 sm:px-8" : variant === "panel" ? "px-0.5 py-2" : "px-4 py-4"}`}>
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
              <UserMessage key={m.id} text={m.text} attachments={m.attachments} disabled={working} onEdit={i === lastUser && conversationId ? (text) => void run(() => (mode === "agent" ? agentEdit({ conversationId, messageId: m.id, text }) : editAction({ conversationId, messageId: m.id, text, ...(webOn ? { web: true } : {}) }))) : undefined} />
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
                  if (!conversationId) return;
                  if (jobFor(m.id)) void run(() => researchRegenerate({ conversationId }));
                  else if (m.agent) void run(() => agentRegenerate({ conversationId }));
                  else void run(() => regenerateAction({ conversationId, ...(webOn || m.webCitations.length ? { web: true } : {}) }));
                }}
                onSuggestion={(text) => send(text)}
                onFix={
                  i === messages.length - 1 && !m.agent && !jobFor(m.id) && m.status === "done" && contextNotes.length && asksToChange(messages[i - 1]?.role === "user" ? messages[i - 1]!.text : "") ? fixInNote : undefined
                }
                onApply={() => void apply(m.id, (m.actions ?? []) as AiAction[])}
                onDismiss={() => void setOutcome({ messageId: m.id, outcome: { kind: "dismissed" } })}
                onOpen={open}
                run={m.agent?.run ? runHandlers(m.agent.run.id) : undefined}
                conversation={conversation ? { id: conversation.id, title: conversation.title } : undefined}
                research={(() => {
                  const job = jobFor(m.id);
                  return job ? researchHandlers(job) : undefined;
                })()}
              />
            ) : null,
          )}
          {showPending ? (
            <>
              <UserMessage text={showPending} attachments={pending?.files} />
              <p role="status" className="flex items-center gap-2 px-1 text-[13px] text-muted">
                <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> Thinking…
              </p>
            </>
          ) : null}
          {problem ? <AiProblemNotice problem={problem} className={problem.kind === "other" ? "rounded-panel bg-danger-soft px-3 py-2.5 text-[13px] text-danger" : undefined} /> : null}
          <AiAnnouncer text={announce} />
          <div ref={endRef} />
        </div>
      </div>

      <div className={`flex-none ${page ? "px-4 pb-4 pt-2 sm:px-8" : variant === "panel" ? "border-t border-line/70 pt-2.5" : "border-t border-line/70 px-3 pb-3 pt-2.5"}`}>
        <div className={page ? "mx-auto max-w-3xl" : ""}>
          <AiCreditsNote className="mb-2" />
          <div className="mb-2 flex flex-wrap items-center gap-2 px-0.5">
            <ContextChips context={context} names={names} onChange={changeContext} disabled={working} />
            {webAvailable && mode === "ask" ? <WebToggle on={web} onChange={setWeb} disabled={working} /> : null}
          </div>
          {attachAvailable && attachments.problems.length ? (
            <div className="mb-2">
              <AttachmentProblems problems={attachments.problems} onDismiss={attachments.dismiss} />
            </div>
          ) : null}
          <div className="relative w-full rounded-panel bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)] focus-within:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_22%,transparent)]">
            {attachAvailable ? <AttachmentChips files={attachments.files} onRemove={attachments.remove} disabled={working} className="px-3 pt-2.5" /> : null}
            <label htmlFor={`${uid}-q`} className="sr-only">
              {mode === "research" ? "What should Foli research?" : mode === "agent" ? "Tell Foli what to change in your notes" : "Ask a question about your notes"}
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
              placeholder={mode === "research" ? "What should I research?" : mode === "agent" ? "Ask Foli to organize, edit or create notes…" : webOn ? "Ask anything. Answers use your notes and the web…" : messages.length ? "Ask a follow-up…" : "Ask anything about your notes…"}
              className="block min-h-[3rem] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-faint"
            />
            {/* How Foli helps on the left, attach and send on the right, all inside the box. */}
            {/* 4px from the box's edge: the switch and Send are 10px-cornered inside its 14px corners. */}
            <div className="flex items-center gap-2 px-1 pb-1">
                <div className={`ui-seg ui-well min-w-0 shrink ${variant === "panel" ? "[&>*]:px-1.5" : ""}`} role="group" aria-label="How Foli helps">
                  <button type="button" aria-pressed={mode === "ask"} onClick={() => setMode("ask")} title="Answers from your notes">
                    Chat
                  </button>
                  <button type="button" aria-pressed={mode === "agent"} onClick={() => setMode("agent")} title="Can propose changes to your notes. Nothing changes until you approve.">
                    Agent
                  </button>
                  {webAvailable ? (
                    <button type="button" aria-pressed={mode === "research"} onClick={() => setMode("research")} title="Researches the web and your notes, then writes a report with sources">
                      Research
                    </button>
                  ) : null}
                </div>
              <div className="ml-auto flex flex-none items-center gap-1.5">
                {attachAvailable ? <AttachControl noteFiles={noteFiles ?? []} onFiles={attachments.add} onPick={attachments.pick} disabled={working} /> : null}
                <button type="button" aria-label={mode === "research" ? "Start research" : "Ask"} disabled={!draft.trim() || working || attachments.uploading} onClick={() => send(draft)} className="grid h-9 w-9 flex-none place-items-center rounded-control bg-heading text-canvas transition-opacity disabled:opacity-30">
                  <ArrowUp size={16} aria-hidden />
                </button>
              </div>
            </div>
          </div>
          <p className="mt-2 px-1 text-[11px] text-faint">
            Foli is AI and can make mistakes.
            {footNotes.length ? ` ${footNotes.join(" ")}` : ""}
          </p>
        </div>
      </div>
    </>
  );
}
