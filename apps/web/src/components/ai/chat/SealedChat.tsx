"use client";
// Foli AI chat in an end-to-end encrypted space (docs/E2EE_DESIGN.md §7.2, WP8). The stored chat functions
// keep conversations as server rows, so they're not for encrypted spaces: here a turn goes through
// aiChat.sendSealed with the notes this device found for the question (asked first with "Ask me each time"),
// and the conversation is kept as this person's sealed `aiChat` record. Nothing about it is stored on the
// server in a readable form. Standard spaces keep ChatThread exactly as it is.
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { AiMarkdown } from "@/components/ai/AiMarkdown";
import { Checkbox } from "@/components/ui/Checkbox";
import { useAppState } from "@/lib/app/state";
import { activeRouter, onActiveRouter } from "@/lib/e2ee/router/active";
import { useE2eeSpaceStatus } from "@/lib/e2ee/router/hooks";
import type { E2eeSpace } from "@/lib/e2ee/router/deps";
import { copy } from "@/lib/e2ee/copy";
import type { ConsentRequest, SealedChat } from "@/lib/e2ee/features/ai";

/** The features module (and the local backend under it) loads only when an encrypted chat is used. */
const features = () => import("@/lib/e2ee/features/ai");

/** The current place, when it is end-to-end encrypted (its chat is the sealed one), else null. */
export function useEncryptedChatSpace(): E2eeSpace | null {
  const { scope } = useAppState();
  const status = useE2eeSpaceStatus(scope);
  if (status.level === "standard") return null;
  return activeRouter()?.spaces.get(scope) ?? null;
}

function storeOf(scope: WireScope) {
  return activeRouter()?.replicas.hostedStore?.(scope) ?? null;
}

/** Calls back whenever the space's replica changes (the pull delivered a chat written on another device). */
function useReplicaVersion(scope: WireScope): number {
  const version = useRef(0);
  const subscribe = useCallback(
    (cb: () => void) => {
      let off: (() => void) | null = null;
      const bind = () => {
        off?.();
        const store = storeOf(scope);
        off = store
          ? store.subscribe(() => {
              version.current++;
              cb();
            })
          : null;
      };
      bind();
      const offActive = onActiveRouter(() => {
        bind();
        version.current++;
        cb();
      });
      return () => {
        off?.();
        offActive();
      };
    },
    [scope],
  );
  return useSyncExternalStore(subscribe, () => version.current, () => 0);
}

/** This person's chats in an encrypted space, newest first. */
export function useSealedChats(space: E2eeSpace): SealedChat[] | undefined {
  const version = useReplicaVersion(space.scope);
  const [chats, setChats] = useState<SealedChat[] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const store = storeOf(space.scope);
    if (!store) return;
    void features()
      .then((f) => f.sealedChats(store))
      .then((list) => alive && setChats(list));
    return () => {
      alive = false;
    };
  }, [space.scope, version]);
  return chats;
}

/** The conversation list of an encrypted space (the AI page's left column). */
export function SealedChatList({ space, activeId, onOpen }: { space: E2eeSpace; activeId: string | null; onOpen: (id: string | null) => void }) {
  const chats = useSealedChats(space);
  return (
    <nav aria-label="Conversations" className="flex h-full flex-col overflow-y-auto p-2">
      <button type="button" onClick={() => onOpen(null)} className="mb-1 h-9 rounded-control px-3 text-left text-subheadline font-medium text-heading hover:bg-[var(--glass-hover)]">
        New chat
      </button>
      {chats?.length ? (
        <ul className="space-y-0.5">
          {chats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-current={c.id === activeId ? "page" : undefined}
                onClick={() => onOpen(c.id)}
                className="block w-full truncate rounded-chip px-3 py-1.5 text-left text-subheadline text-muted hover:bg-[var(--glass-hover)] hover:text-heading aria-[current=page]:bg-[var(--glass-hover)] aria-[current=page]:text-heading"
              >
                {c.title || "Untitled chat"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-footnote text-faint">{chats ? "No chats yet." : ""}</p>
      )}
    </nav>
  );
}

/** One chat in an encrypted space: the turns, the consent question when it's asked, and the composer. */
export function SealedChatThread({
  space,
  chatId,
  onChat,
  initialDraft,
  autoFocus,
  variant = "floating",
}: {
  space: E2eeSpace;
  chatId: string | null;
  onChat?: (id: string) => void;
  initialDraft?: string;
  autoFocus?: boolean;
  variant?: "floating" | "page";
}) {
  const uid = useId();
  const version = useReplicaVersion(space.scope);
  const [chat, setChat] = useState<SealedChat | null>(null);
  const rev = useRef(0);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ request: ConsentRequest; resolve: (ok: boolean) => void } | null>(null);
  const [remember, setRemember] = useState(false);
  const working = pendingText !== null;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The chat as its record holds it (and again when another device of this person added to it).
  useEffect(() => {
    let alive = true;
    const store = storeOf(space.scope);
    if (!chatId || !store) {
      if (!chatId) setChat(null);
      return;
    }
    void features()
      .then((f) => f.sealedChatById(store, chatId))
      .then((found) => {
        if (!alive || !found || working) return;
        if (found.rev >= rev.current) {
          setChat(found.chat);
          rev.current = found.rev;
        }
      });
    return () => {
      alive = false;
    };
  }, [space.scope, chatId, version, working]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const send = async (text: string) => {
    const q = text.trim();
    const router = activeRouter();
    if (!q || working || !router) return;
    setError(null);
    setPendingText(q);
    setDraft("");
    try {
      const f = await features();
      const confirm = (request: ConsentRequest) =>
        f.consentRemembered(request)
          ? Promise.resolve(true)
          : new Promise<boolean>((resolve) => {
              setRemember(false);
              setConsent({ request, resolve });
            });
      const r = await f.sealedChat(router.env, space, chat, q, { baseRev: rev.current, confirm });
      rev.current = r.rev;
      setChat(r.chat);
      onChat?.(r.chat.id);
      const answer = r.answer as { status?: string; error?: { message?: string } | null };
      if (answer.status === "error") setError(answer.error?.message ?? "Foli AI couldn't answer. Try again.");
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      if (code === "e2ee_consent_declined") setDraft(q);
      setError(code === "e2ee_consent_declined" ? "Nothing was sent to Foli AI." : code === "e2ee_conflict" ? "This chat changed on another device. Ask again." : ((e as { data?: { message?: string } }).data?.message ?? "Foli AI couldn't answer. Try again."));
    } finally {
      setPendingText(null);
    }
  };

  const answerConsent = (ok: boolean) => {
    if (!consent) return;
    if (ok && remember) void features().then((f) => f.rememberConsent(consent.request));
    consent.resolve(ok);
    setConsent(null);
  };

  const turns = chat?.turns ?? [];
  const pad = variant === "page" ? "px-4 sm:px-8" : "px-4";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto py-4 ${pad}`} aria-live="polite">
        {turns.length === 0 && !working ? <p className="text-subheadline text-muted">Ask about the notes in this space. Foli AI reads only what this device sends it for each question.</p> : null}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-panel bg-[var(--glass-hover)] px-3 py-2 text-body text-ink">
              {t.text}
            </p>
          ) : (
            <AiMarkdown key={i} markdown={t.text} className="text-body" />
          ),
        )}
        {pendingText ? (
          <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-panel bg-[var(--glass-hover)] px-3 py-2 text-body text-ink">{pendingText}</p>
        ) : null}
        {working && !consent ? (
          <p className="text-subheadline text-muted" aria-busy="true">
            Thinking…
          </p>
        ) : null}
        {consent ? (
          <section aria-labelledby={`${uid}-consent`} className="ui-card rounded-panel border border-line p-4">
            <h3 id={`${uid}-consent`} className="text-body font-semibold text-heading">
              {copy.consent.title}
            </h3>
            <p className="mt-1 text-subheadline text-muted">{copy.consent.body}</p>
            <ul className="mt-2 space-y-0.5 text-subheadline text-ink">
              {consent.request.notes.map((n) => (
                <li key={n.id} className="flex justify-between gap-3">
                  <span className="truncate">{n.title || copy.consent.untitled}</span>
                  <span className="flex-none text-faint">{copy.consent.chars(n.chars)}</span>
                </li>
              ))}
            </ul>
            <Checkbox checked={remember} onChange={setRemember} className="mt-3 text-subheadline">
              {copy.consent.remember}
            </Checkbox>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => answerConsent(false)} className="h-9 rounded-control px-3 text-callout text-heading ui-btn">
                {copy.consent.dontSend}
              </button>
              <button type="button" onClick={() => answerConsent(true)} className="h-9 rounded-control px-3 text-callout font-medium ui-btn ui-btn-primary">
                {copy.consent.send}
              </button>
            </div>
            <p className="mt-2 text-footnote text-faint">{copy.consent.settingsHint}</p>
          </section>
        ) : null}
        {error ? (
          <p role="alert" className="text-subheadline text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className={`flex-none pb-3 ${pad}`}>
        <div className="ui-input rounded-control">
          <label htmlFor={`${uid}-q`} className="sr-only">
            Ask about your notes
          </label>
          <textarea
            id={`${uid}-q`}
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask about your notes…"}
            className="block min-h-[3rem] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-body leading-[1.5] text-ink outline-none placeholder:text-faint"
          />
          <div className="flex justify-end px-1 pb-1">
            <button type="button" aria-label="Ask" title="Ask (Enter)" disabled={!draft.trim() || working} onClick={() => void send(draft)} className="grid h-9 w-9 place-items-center rounded-control bg-heading text-canvas transition-opacity disabled:opacity-30">
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
        </div>
        <p className="mt-2 px-1 text-footnote text-faint">Foli AI can make mistakes. This space is end-to-end encrypted: the chat is kept encrypted, and nothing about it stays on our servers.</p>
      </div>
    </div>
  );
}
