"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { Maximize2, Plus, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { modKey } from "@/lib/hooks/useEngine";
import { ChatThread } from "./chat/ChatThread";
import type { ChatContext } from "./chat/chatText";

/** The launcher's shadow: soft black at 10%. */
const SHADOW = "shadow-[0_8px_24px_rgb(0_0_0/0.1),0_2px_6px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(255_255_255/0.12)]";
const HEADER_BUTTON = "grid h-8 w-8 place-items-center rounded-[8px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading";

/**
 * Ask AI (⌘J): a chat with your notes that pops out from a floating button in the bottom-right corner.
 * It isn't modal: you can keep reading and writing while it's open. It shows the current conversation
 * (saved like any other: the AI page lists it), and "Open in full view" moves it to the AI page. Also
 * opened from the command palette, a folder's menu and the note's AI panel. Shown only where AI is
 * included and turned on (never on Core), and not on the AI page itself. With history off, closing it
 * deletes the conversation.
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
  const { route, navigate } = useAppRouter();
  const { scopeKey } = useAppState();
  // On a note, AI lives in the note's right sidebar (its "AI" tool), so the floating button stays off notes.
  const onNote = route.name === "doc";
  // The AI page is the chat: nothing floats over it.
  const onAiPage = route.name === "ai";
  const launcherRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const [conversationId, setConversationId] = useState<string | null>(null);
  // A new chat (New chat, a folder, another place) starts a fresh thread; the first question only names it.
  const [thread, setThread] = useState(0);
  const startOver = () => {
    setConversationId(null);
    setThread((n) => n + 1);
  };
  const convo = useQuery(api.aiChat.get, conversationId ? { conversationId } : "skip");
  const discard = useMutation(api.aiChat.discard);
  useEffect(() => setMounted(true), []);
  // A conversation belongs to the place it started in: switching Personal or workspace starts afresh.
  useEffect(() => {
    setConversationId(null);
    setThread((n) => n + 1);
  }, [scopeKey]);
  // Asked about a folder: a new conversation about it.
  const folderContext = useMemo<ChatContext | undefined>(() => (folder ? { kind: "folder", ids: [folder.id] } : undefined), [folder]);
  const folderNames = useMemo(() => (folder ? { [folder.id]: folder.name } : undefined), [folder]);
  useEffect(() => {
    if (!open || !folder) return;
    setConversationId(null);
    setThread((n) => n + 1);
  }, [open, folder]);

  if (!mounted || onAiPage) return null;

  const close = () => {
    // History off: the conversation goes when the chat closes.
    if (conversationId && convo?.conversation.ephemeral) {
      void discard({ conversationId });
      startOver();
    }
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
        className={`ui-pop fixed bottom-[104px] right-9 z-[70] flex h-[min(640px,calc(100dvh-136px))] w-[min(420px,calc(100vw-2.5rem))] origin-bottom-right flex-col overflow-hidden !rounded-[18px] animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none max-sm:bottom-[84px] max-sm:right-3 max-sm:w-[calc(100vw-1.5rem)]`}
      >
        <header className="flex flex-none items-center gap-1 border-b border-line/70 py-3 pl-4 pr-3">
          <AiIcon size={20} aria-hidden className="mr-1.5 flex-none" />
          <h2 id={`${uid}-title`} className="flex-1 text-[14.5px] font-semibold text-heading">
            Ask AI
          </h2>
          <button type="button" aria-label="New chat" title="New chat" onClick={startOver} className={HEADER_BUTTON}>
            <Plus size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Open in full view"
            title="Open in full view"
            onClick={() => {
              onClose();
              navigate(conversationId && convo ? `/ai/${conversationId}` : "/ai");
            }}
            className={HEADER_BUTTON}
          >
            <Maximize2 size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Close chat" onClick={close} className={HEADER_BUTTON}>
            <X size={16} aria-hidden />
          </button>
        </header>
        <ChatThread
          key={thread}
          variant="floating"
          conversationId={conversationId}
          onConversation={setConversationId}
          initialContext={folderContext}
          initialNames={folderNames}
          initialDraft={initial}
          autoFocus={open}
          onNavigate={close}
        />
      </section>
      {/* On a note the floating bar's AI button opens it; elsewhere this floating button does. */}
      {onNote ? null : (
        <button
          ref={launcherRef}
          type="button"
          aria-expanded={open}
          aria-keyshortcuts="Meta+J"
          title={open ? "Close AI Assistant" : `AI Assistant (${modKey()}J)`}
          onClick={() => (open ? close() : onOpen())}
          className={`fixed bottom-9 right-[calc(2.25rem+var(--tools-panel,0px))] z-[70] inline-flex h-12 items-center gap-2.5 rounded-[14px] bg-black pl-4 pr-5 text-[15px] font-medium text-white ${SHADOW} transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#1c1c1f] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black max-sm:bottom-3 max-sm:right-3`}
        >
          {open ? <X size={18} aria-hidden /> : <AiIcon size={17} />}
          <span>AI Assistant</span>
        </button>
      )}
    </div>,
    document.body,
  );
}
