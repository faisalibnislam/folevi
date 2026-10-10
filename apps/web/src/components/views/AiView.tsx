"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { MessagesSquare, MoreHorizontal, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { ViewChrome } from "@/components/app/Shell";
import { useAiAccess } from "@/components/ai/useAi";
import { ChatThread } from "@/components/ai/chat/ChatThread";
import { AiUnavailable } from "@/components/ai/AiUnavailable";
import { ConversationList } from "@/components/ai/chat/ConversationList";
import { ResearchList } from "@/components/ai/chat/ResearchList";
import { SharedThread } from "@/components/ai/chat/SharedThread";
import { useConversationActions } from "@/components/ai/chat/ConversationActions";
import { citationHref } from "@/components/ai/chat/chatText";
import { MenuButton } from "@/components/ui/Menu";

/** The conversation list as a drawer (phones): Escape or the scrim closes it. */
function ListDrawer({ activeId, onClose }: { activeId: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>("a, button, input")?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conversations"
      className="fixed inset-0 z-40 flex"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div ref={ref} className="ui-pop relative h-full w-[min(86vw,320px)] animate-[folio-settle_200ms_var(--ease-folio)] rounded-none motion-reduce:animate-none">
        <button type="button" aria-label="Close conversations" onClick={onClose} className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
          <X size={16} aria-hidden />
        </button>
        <div className="flex h-full flex-col pt-8">
          <div className="min-h-0 flex-1">
            <ConversationList activeId={activeId} onNavigate={onClose} />
          </div>
          <ResearchList activeId={activeId} onNavigate={onClose} />
        </div>
      </div>
      <button type="button" aria-label="Close conversations" tabIndex={-1} className="flex-1 bg-[var(--color-scrim)] backdrop-blur-[2px]" onClick={onClose} />
    </div>
  );
}

/**
 * The AI page (/ai, /ai/<conversation>): your conversations and research jobs on the left (a drawer on
 * phones), the chat on the right. A new chat gets its address once you ask the first question. With history off, leaving a
 * conversation deletes it.
 */
export function AiView({ id }: { id: string | null }) {
  const { navigate } = useAppRouter();
  const narrow = useMediaQuery("(max-width: 767px)");
  const ai = useAiAccess();
  const [listOpen, setListOpen] = useState(false);
  const data = useQuery(api.aiChat.get, id && ai.on ? { conversationId: id } : "skip");
  // Not yours: maybe one a member shared with the workspace (read-only, aiSharing.get).
  const shared = useQuery(api.aiSharing.get, id && ai.on && data === null ? { conversationId: id } : "skip");
  const discard = useMutation(api.aiChat.discard);
  const mine = data?.conversation;
  const actions = useConversationActions(mine ? { id: mine.id, title: mine.title, shared: mine.shared, workspace: mine.scope.kind === "workspace", ephemeral: mine.ephemeral } : null);

  // History off: a conversation is deleted when you leave it (another one, a new chat, or another page).
  const leaving = useRef<string | null>(null);
  useEffect(() => {
    leaving.current = id && data?.conversation.ephemeral ? id : null;
  }, [id, data?.conversation.ephemeral]);
  useEffect(
    () => () => {
      if (leaving.current) void discard({ conversationId: leaving.current });
      leaving.current = null;
    },
    [id, discard],
  );

  // The chat keeps its place when its new conversation gets an address; another conversation starts afresh.
  const created = useRef<string | null>(null);
  const threadKey = id && id === created.current ? "new" : (id ?? "new");

  const title = data?.conversation.title ?? shared?.conversation.title ?? (id ? "" : "New chat");

  if (!ai.on) {
    return (
      <ViewChrome title="AI" tabTitle="AI">
        {/* Turned off: how to turn it on. Not on the plan: what it includes, and Upgrade. */}
        <AiUnavailable ai={ai} headingLevel={1} />
      </ViewChrome>
    );
  }

  return (
    <ViewChrome title="Foli" tabTitle={title || "Foli"}>
      <div className="flex h-full min-h-0">
        {narrow ? null : (
          <aside className="flex w-[264px] flex-none flex-col border-r border-line/70">
            <div className="min-h-0 flex-1">
              <ConversationList activeId={id} />
            </div>
            <ResearchList activeId={id} />
          </aside>
        )}
        <section aria-label={title || "Conversation"} className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 flex-none items-center gap-2 px-4 sm:px-8">
            {narrow ? (
              <button type="button" onClick={() => setListOpen(true)} aria-haspopup="dialog" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
                <MessagesSquare size={15} aria-hidden /> Conversations
              </button>
            ) : null}
            <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-heading">{title}</h1>
            {actions.items.length ? (
              <MenuButton label="Conversation options" triggerClassName="grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading" trigger={<MoreHorizontal size={16} aria-hidden />} items={actions.items} />
            ) : null}
            {actions.dialog}
          </div>
          {data === null && shared ? (
            <SharedThread data={shared} onOpen={navigate} onCite={(c) => navigate(citationHref(c))} />
          ) : data === null && shared === undefined ? (
            <div className="min-h-0 flex-1" aria-busy="true" />
          ) : (
            <ChatThread
              key={threadKey}
              variant="page"
              conversationId={id}
              autoFocus
              onConversation={(next) => {
                created.current = next;
                navigate(`/ai/${next}`, { replace: true });
              }}
            />
          )}
        </section>
      </div>
      {narrow && listOpen ? <ListDrawer activeId={id} onClose={() => setListOpen(false)} /> : null}
    </ViewChrome>
  );
}
