"use client";

import { useState, type ReactNode } from "react";
import { useConvex, useMutation } from "convex/react";
import { ClipboardCopy, Download, FilePlus2, Share2, UserX } from "lucide-react";
import { api, type Id } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { MenuEntry } from "@/components/ui/Menu";
import { errorMessage, useToast } from "@/components/ui/Toast";

// Sharing and exporting one conversation (convex/aiSharing.ts, aiChat.exportMarkdown, aiChat.saveAsNote):
// the items its menu offers on the AI page, in the conversation list and in the floating chat.

/** Saves text (or bytes) as a file. */
export function download(content: string | Uint8Array<ArrayBuffer>, filename: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** What a conversation's menu needs to know about it. */
export interface ConversationInfo {
  id: string;
  title: string;
  /** Shared with its workspace right now. */
  shared: boolean;
  /** It lives in a team workspace (Personal conversations can't be shared). */
  workspace: boolean;
  /** History is off: it isn't kept, so it can't be shared. */
  ephemeral?: boolean;
}

export interface ConversationHandlers {
  onShare: () => void;
  onUnshare: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onSaveNote: () => void;
}

/** The share and export items of a conversation's menu. Sharing says plainly when it isn't possible. */
export function shareExportItems(c: ConversationInfo, on: ConversationHandlers): MenuEntry[] {
  const share: MenuEntry = c.shared
    ? { label: "Stop sharing", icon: <UserX size={14} />, onSelect: on.onUnshare }
    : !c.workspace
      ? { label: "Share with workspace", icon: <Share2 size={14} />, disabled: true, description: "Personal conversations can't be shared.", onSelect: () => {} }
      : c.ephemeral
        ? { label: "Share with workspace", icon: <Share2 size={14} />, disabled: true, description: "History is off, so this one isn't kept.", onSelect: () => {} }
        : { label: "Share with workspace…", icon: <Share2 size={14} />, onSelect: on.onShare };
  return [
    share,
    "separator",
    { label: "Copy as Markdown", icon: <ClipboardCopy size={14} />, onSelect: on.onCopy },
    { label: "Download Markdown", icon: <Download size={14} />, onSelect: on.onDownload },
    { label: "Save as note", icon: <FilePlus2 size={14} />, onSelect: on.onSaveNote },
  ];
}

/** Asks before sharing: who will see it, and what stays private. */
export function ShareDialog({ open, title, onCancel, onConfirm }: { open: boolean; title: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Share this Foli conversation?"
      description={`Members of this workspace can read “${title}” but can't change it or ask in it. Someone sees it only if they can open every note it uses. Files you uploaded stay private. You can stop sharing at any time.`}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>
            Share
          </Button>
        </>
      }
    />
  );
}

/** Copies Markdown, and says so. */
export async function copyMarkdown(markdown: string): Promise<void> {
  if (!navigator.clipboard) throw new Error("Copying isn't available here.");
  await navigator.clipboard.writeText(markdown);
}

/**
 * The share and export actions of one conversation (or, with `messageId`, of one answer: copy, download
 * and save it alone). Returns the menu items and the share dialog to render.
 */
export function useConversationActions(c: ConversationInfo | null, opts: { messageId?: Id<"aiMessages"> } = {}): { items: MenuEntry[]; dialog: ReactNode } {
  const convex = useConvex();
  const share = useMutation(api.aiSharing.share);
  const unshare = useMutation(api.aiSharing.unshare);
  const saveAsNote = useMutation(api.aiChat.saveAsNote);
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [asking, setAsking] = useState(false);
  if (!c) return { items: [], dialog: null };
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });
  const markdown = () => convex.query(api.aiChat.exportMarkdown, { conversationId: c.id, ...(opts.messageId ? { messageId: opts.messageId } : {}) });
  const handlers: ConversationHandlers = {
    onShare: () => setAsking(true),
    onUnshare: () => void unshare({ conversationId: c.id }).then(() => toast.show("Stopped sharing"), fail),
    onCopy: () => void markdown().then((r) => copyMarkdown(r.markdown)).then(() => toast.show("Copied as Markdown"), fail),
    onDownload: () => void markdown().then((r) => download(r.markdown, r.filename), fail),
    onSaveNote: () =>
      void saveAsNote({ conversationId: c.id, ...(opts.messageId ? { messageId: opts.messageId } : {}) }).then(
        ({ id }) => toast.show("Saved as a note", { tone: "success", action: { label: "Open", onClick: () => navigate(`/d/${encodeURIComponent(id)}`) } }),
        fail,
      ),
  };
  const all = shareExportItems(c, handlers);
  const items = opts.messageId ? all.filter((e) => typeof e !== "string" && "label" in e && e.label !== "Stop sharing" && !e.label.startsWith("Share")) : all;
  const dialog = (
    <ShareDialog
      open={asking}
      title={c.title}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        void share({ conversationId: c.id }).then(() => toast.show("Shared with the workspace", { tone: "success" }), fail);
      }}
    />
  );
  return { items, dialog };
}
