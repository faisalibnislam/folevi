"use client";

import type { FunctionReturnType } from "convex/server";
import { Users } from "lucide-react";
import type { api } from "@/lib/convex/api";
import { AssistantMessage, UserMessage, type ChatMessageData, type Citation } from "./ChatMessage";

export type SharedConversation = NonNullable<FunctionReturnType<typeof api.aiSharing.get>>;

const noop = () => {};

/**
 * A conversation someone shared with the workspace, read-only (aiSharing.get): who shared it, then its
 * messages as they were written, with sources and what agent runs did, and nothing to ask, approve or undo.
 * Uploads its person sent show only as "File not shared".
 */
export function SharedThread({ data, onCite, onOpen }: { data: SharedConversation; onCite: (c: Citation) => void; onOpen: (href: string) => void }) {
  const { conversation, messages } = data;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <p role="note" className="flex items-start gap-2 rounded-control bg-[var(--glass-hover)] px-3 py-2.5 text-[13px] text-muted shadow-[inset_0_0_0_1px_var(--glass-border)]">
          <Users size={14} aria-hidden className="mt-[3px] flex-none" />
          <span>
            Shared by <span className="font-medium text-heading">{conversation.by}</span>. You can read it, but only they can ask in it.
          </span>
        </p>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <UserMessage key={m.id} text={m.text} attachments={m.attachments as Parameters<typeof UserMessage>[0]["attachments"]} />
          ) : m.role === "assistant" ? (
            <AssistantMessage
              key={m.id}
              message={m as unknown as ChatMessageData}
              last={i === messages.length - 1}
              busy={false}
              outcome={m.actionsOutcome?.kind === "applied" ? m.actionsOutcome : m.actionsOutcome?.kind === "dismissed" ? "dismissed" : undefined}
              onCite={onCite}
              onStop={noop}
              onRegenerate={noop}
              onSuggestion={noop}
              onApply={noop}
              onDismiss={noop}
              onOpen={onOpen}
              readOnly
            />
          ) : null,
        )}
        {!messages.length ? <p className="text-[13.5px] text-muted">Nothing here yet.</p> : null}
      </div>
    </div>
  );
}
