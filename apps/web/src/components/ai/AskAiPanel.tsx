"use client";
// Foli AI's floating chat, loaded on first use (docs/MAC_WEBKIT_PLAN.md "Memory", step 4).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { History, Maximize2, MoreHorizontal, Plus, X } from "lucide-react";
import { useIphoneApp } from "@/lib/iphone";
import { SHEET_BUTTON, Sheet } from "@/components/iphone/Sheet";
import { api } from "@/lib/convex/api";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { AskAiLauncher, type AskAiProps } from "./AskAiChat";
import { ChatThread } from "./chat/ChatThread";
import { SealedChatThread, useEncryptedChatSpace } from "./chat/SealedChat";
import { useConversationActions } from "./chat/ConversationActions";
import { MenuButton } from "@/components/ui/Menu";
import type { ChatContext } from "./chat/chatText";

const HEADER_BUTTON = "grid h-8 w-8 place-items-center rounded-chip text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading";

/**
 * Ask AI (⌘J)'s chat (AskAiChat.tsx, which loads this the first time it's asked for): a chat with your notes that
 * pops out from the floating button in the bottom-right corner. It isn't modal: you can keep reading and writing
 * while it's open. It shows the current conversation (saved like any other: the AI page lists it), and "Open in
 * full view" moves it to the AI page. With history off, closing it deletes the conversation.
 */
export function AskAiPanel({ open, onOpen, onClose, initial, folder, hideLauncher }: AskAiProps) {
  const [mounted, setMounted] = useState(false);
  const { route, navigate } = useAppRouter();
  // Where focus was when it opened (⌘J, the command palette): it goes back there on close.
  const returnTo = useRef<HTMLElement | null>(null);
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
  // An end-to-end encrypted place: its chat is kept sealed on this person's devices (chat/SealedChat.tsx).
  const sealedSpace = useEncryptedChatSpace();
  const convo = useQuery(api.aiChat.get, conversationId && !sealedSpace ? { conversationId } : "skip");
  const discard = useMutation(api.aiChat.discard);
  // Share with the workspace, copy, download or save as a note (once there's a conversation).
  const current = convo?.conversation;
  const actions = useConversationActions(current ? { id: current.id, title: current.title, shared: current.shared, workspace: current.scope.kind === "workspace", ephemeral: current.ephemeral } : null);
  useEffect(() => setMounted(true), []);
  const iphone = useIphoneApp();
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement && active !== document.body && !active.closest(".ai-chat") ? active : null;
  }, [open]);
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
    // Back to the floating button, or (on a note, where there's none) to where you were.
    const back = launcherRef.current ?? (returnTo.current?.isConnected ? returnTo.current : null);
    requestAnimationFrame(() => back?.focus());
  };

  // The iPhone app: a sheet from the bottom (half the screen, pulled up to all of it). The conversations
  // button opens the Foli AI page with every conversation.
  if (iphone) {
    const sheetButton = SHEET_BUTTON;
    return (
      <>
        <Sheet
          open={open}
          onClose={close}
          size="medium"
          title={current?.title || "New chat"}
          bodyClassName="ai-chat flex flex-col"
          leading={
            <button
              type="button"
              aria-label="Conversations"
              onClick={() => {
                onClose();
                navigate(conversationId && convo ? `/ai/${conversationId}` : "/ai");
              }}
              className={sheetButton}
            >
              <History size={15} strokeWidth={2.4} aria-hidden />
            </button>
          }
          trailing={
            <>
              {actions.items.length ? <MenuButton label="Conversation options" triggerClassName={sheetButton} trigger={<MoreHorizontal size={15} strokeWidth={2.4} aria-hidden />} items={actions.items} /> : null}
              {conversationId ? (
                <button type="button" aria-label="New chat" onClick={startOver} className={sheetButton}>
                  <Plus size={16} strokeWidth={2.4} aria-hidden />
                </button>
              ) : null}
            </>
          }
        >
          {sealedSpace ? (
            <SealedChatThread key={thread} space={sealedSpace} chatId={conversationId} onChat={setConversationId} initialDraft={initial} autoFocus={open} />
          ) : (
            <ChatThread key={thread} variant="floating" conversationId={conversationId} onConversation={setConversationId} initialContext={folderContext} initialNames={folderNames} initialDraft={initial} autoFocus={open} onNavigate={close} />
          )}
        </Sheet>
        {actions.dialog}
      </>
    );
  }

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
        className={`ui-pop ui-fab-panel fixed bottom-[104px] right-9 z-[70] flex h-[min(640px,calc(100dvh-136px))] w-[min(420px,calc(100vw-2.5rem))] origin-bottom-right flex-col overflow-hidden !rounded-container animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none max-sm:bottom-[84px] max-sm:right-3 max-sm:w-[calc(100vw-1.5rem)]`}
      >
        <header className="flex flex-none items-center gap-1 border-b border-line/70 py-3 pl-4 pr-3">
          <AiIcon size={20} aria-hidden className="mr-1.5 flex-none" />
          <h2 id={`${uid}-title`} className="flex-1 text-[14.5px] font-semibold text-heading">
            Foli AI
          </h2>
          {actions.items.length ? <MenuButton label="Conversation options" triggerClassName={HEADER_BUTTON} trigger={<MoreHorizontal size={16} aria-hidden />} items={actions.items} /> : null}
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
        {sealedSpace ? (
          <SealedChatThread key={thread} space={sealedSpace} chatId={conversationId} onChat={setConversationId} initialDraft={initial} autoFocus={open} />
        ) : (
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
        )}
      </section>
      {/* Outside the chat, so Escape in it doesn't close the chat too. */}
      {actions.dialog}
      {/* On a note the floating bar's AI button opens it; elsewhere this floating button does. */}
      {onNote || hideLauncher ? null : <AskAiLauncher ref={launcherRef} open={open} onClick={() => (open ? close() : onOpen())} />}
    </div>,
    document.body,
  );
}
