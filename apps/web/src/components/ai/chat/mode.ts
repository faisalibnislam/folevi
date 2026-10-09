"use client";

import { useCallback, useState } from "react";
import { useAppState } from "@/lib/app/state";
import type { ChatMode } from "./ChatThread";

// The chat's mode (Chat, Agent, Research) is remembered per person on this device, so the floating chat
// and the AI page open the way they were last used. A preference, not data: localStorage is enough, and
// when it can't be read (private windows, blocked storage) the chat simply starts in Chat.

const KEY = "folevi:ai-mode:";
const MODES: readonly ChatMode[] = ["ask", "agent", "research"];

/** The mode this person last picked here, or null. */
export function readChatMode(profileId: string): ChatMode | null {
  try {
    const v = window.localStorage.getItem(KEY + profileId);
    return v && (MODES as readonly string[]).includes(v) ? (v as ChatMode) : null;
  } catch {
    return null;
  }
}

export function writeChatMode(profileId: string, mode: ChatMode): void {
  try {
    window.localStorage.setItem(KEY + profileId, mode);
  } catch {
    /* storage blocked: it just isn't remembered */
  }
}

/**
 * The chat's mode: `fixed` when the surface decides (the note's Agent tab), otherwise the person's last
 * pick. Picking a mode remembers it, unless `remember: false` (the chat falling back on its own, say
 * Research while the web is off).
 */
export function useChatMode(fixed?: ChatMode): [ChatMode, (mode: ChatMode, opts?: { remember?: boolean }) => void] {
  const { profile } = useAppState();
  const [mode, set] = useState<ChatMode>(() => fixed ?? (typeof window === "undefined" ? null : readChatMode(profile.id)) ?? "ask");
  const choose = useCallback(
    (next: ChatMode, opts: { remember?: boolean } = {}) => {
      set(next);
      if (!fixed && opts.remember !== false) writeChatMode(profile.id, next);
    },
    [fixed, profile.id],
  );
  return [mode, choose];
}
