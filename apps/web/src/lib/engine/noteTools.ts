"use client";

// The note page's own sidebar for the native apps (bridge revision 14): what components/doc/DocumentSidebar.tsx
// shows (where the note lives, the Table of contents, the note's comments, tasks, attachments and links, its page
// tree), sent as `note.tools` when the note opens and whenever any of it changes. Native draws the sidebar and
// sends its clicks back as editor commands (lib/engine/editorCommands.ts: block.jump, task.toggle, thread.open,
// find). Imported only by the note page.
import { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { flattenTree, plainText, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useCapabilities } from "@/lib/mode";
import { useDocumentBlocks } from "@/lib/hooks/useEngine";
import { useCommentThreads, type CommentThread } from "@/components/doc/Comments";
import { useCurrentHeading } from "@/components/doc/Outline";
import { nativeChrome } from "@/lib/nativeApp";
import { bridgeListening, emitNoteEvent } from "./noteHost";
import type { NoteOutlineItem, NoteToolsAttachment, NoteToolsComments, NoteToolsCrumb, NoteToolsEvent, NoteToolsLink, NoteToolsPage, NoteToolsTask, NoteToolsThread } from "./protocol";

/** Headings and nested pages, in the note's order (the web's Outline). */
export function outlineOf(blocks: WireBlock[]): NoteOutlineItem[] {
  return blocks
    .filter((b) => b.type === "heading" || b.type === "page")
    .map((b) => {
      const p = b.props as { level?: number; documentId?: string; titleCache?: string };
      if (b.type === "page") return { kind: "page" as const, id: b.id, text: p.titleCache || "Nested page", level: 0, documentId: p.documentId ?? null };
      return { kind: "heading" as const, id: b.id, text: plainText(b.text), level: Math.min(3, Math.max(1, Number(p.level ?? 1))), documentId: null };
    });
}

export function tasksOf(blocks: WireBlock[]): NoteToolsTask[] {
  return blocks.filter((b) => b.type === "todo").map((b) => ({ id: b.id, text: plainText(b.text) || "Untitled task", checked: Boolean((b.props as { checked?: boolean }).checked) }));
}

export function attachmentsOf(blocks: WireBlock[]): NoteToolsAttachment[] {
  return blocks
    .filter((b) => b.type === "image" || b.type === "file" || b.type === "audio")
    .map((b) => {
      const p = b.props as { name?: string; alt?: string; caption?: string; fileId?: string };
      const named = b.type === "file" || b.type === "audio";
      return { id: b.id, kind: b.type, name: named ? p.name || (b.type === "audio" ? "Audio recording" : "File") : p.caption || p.alt || "Image", uploading: !p.fileId && named };
    });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function linksOf(blocks: WireBlock[]): NoteToolsLink[] {
  const links: NoteToolsLink[] = [];
  for (const b of blocks) {
    const p = b.props as { url?: string; title?: string };
    if (b.type === "embed" && p.url) links.push({ key: `${b.id}-embed`, blockId: b.id, label: hostOf(p.url), href: p.url, internal: false });
    if (b.type === "bookmark" && p.url) links.push({ key: `${b.id}-bm`, blockId: b.id, label: p.title || hostOf(p.url), href: p.url, internal: false });
    ((b.text ?? []) as InlineNode[]).forEach((n, i) => {
      if (n.type === "pageLink") links.push({ key: `${b.id}-${i}`, blockId: b.id, label: n.label || "Untitled", href: `/d/${n.documentId}`, internal: true });
      else if (n.type === "text") {
        const link = n.marks?.find((m) => m.type === "link") as { href?: string } | undefined;
        if (link?.href && /^https?:/i.test(link.href)) links.push({ key: `${b.id}-${i}`, blockId: b.id, label: n.text, href: link.href, internal: false });
      }
    });
  }
  return links;
}

function anchorOf(t: CommentThread): string {
  if (t.blockExists === false) return "On a deleted block";
  if (t.blockText) return `“${t.blockText}”`;
  if (t.blockId) return "On a block";
  return "On the whole note";
}

export function threadOf(t: CommentThread): NoteToolsThread {
  const first = t.comments.find((c) => !c.deleted) ?? t.comments[0];
  const body = (first?.body ?? []) as { type: string; text?: string; label?: string }[];
  return {
    id: t.id,
    blockId: t.blockId && t.blockExists !== false ? t.blockId : null,
    anchor: anchorOf(t),
    author: first?.authorName ?? "",
    avatarUrl: first?.authorAvatarUrl ?? null,
    text: body.map((n) => (n.type === "mention" ? `@${n.label ?? ""}` : (n.text ?? ""))).join(""),
    deleted: Boolean(first?.deleted),
    replies: Math.max(0, t.comments.length - 1),
    status: t.status,
    resolvedBy: t.resolvedBy ?? null,
    unread: Boolean(t.unread),
    lastActivityAt: t.lastActivityAt,
    waiting: t.waiting ?? null,
  };
}

/** DocumentView in native chrome mode: keeps native told what the note's sidebar shows. */
export function useNativeNoteTools(o: { documentId: string; title: string; trail: NoteToolsCrumb[]; readOnly: boolean; /** Joined notes: only the one with focus sends its tools. */ primary?: boolean }): void {
  const on = typeof window !== "undefined" && nativeChrome() !== null;
  const { engine } = useAppState();
  const raw = useDocumentBlocks(engine, o.documentId);
  const blocks = useMemo(() => flattenTree(raw).map(({ block }) => block), [raw]);
  const commentsOn = useCapabilities().comments;
  const threads = useCommentThreads(o.documentId, !on);
  const tree = useQuery(api.documents.pageTree, on ? { documentId: o.documentId } : "skip");
  const outline = useMemo(() => outlineOf(blocks), [blocks]);
  const headingIds = useMemo(() => outline.filter((i) => i.kind === "heading").map((i) => i.id), [outline]);
  const current = useCurrentHeading(on ? headingIds : []);
  const trailKey = JSON.stringify(o.trail.map((c) => [c.href, c.label]));

  const event = useMemo<NoteToolsEvent>(() => {
    const comments: NoteToolsComments = {
      available: commentsOn,
      loaded: !commentsOn || threads !== undefined,
      canComment: Boolean(threads?.canComment),
      threads: (threads?.threads ?? []).map(threadOf),
    };
    const pages: NoteToolsPage[] = tree && tree.pages.length >= 2 ? tree.pages.map((p) => ({ id: p.id, title: p.title || "Untitled", depth: p.depth })) : [];
    return {
      noteId: o.documentId,
      title: o.title || "Untitled",
      trail: JSON.parse(trailKey).map(([href, label]: [string, string]) => ({ href, label })),
      outline,
      current,
      tasks: tasksOf(blocks),
      attachments: attachmentsOf(blocks),
      links: linksOf(blocks),
      comments,
      pages,
      pagesTruncated: Boolean(tree && pages.length && tree.truncated),
      readOnly: o.readOnly,
    };
  }, [o.documentId, o.title, trailKey, outline, current, blocks, commentsOn, threads, tree, o.readOnly]);

  // Sent at most once a frame, only when it changed.
  useEffect(() => {
    if (!on || o.primary === false || !bridgeListening()) return;
    const frame = requestAnimationFrame(() => emitNoteEvent("note.tools", event));
    return () => cancelAnimationFrame(frame);
  }, [on, o.primary, event]);
}
