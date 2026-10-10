"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Copy, HelpCircle, Link2, ListChecks, ListTodo, X } from "lucide-react";
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useToast, errorMessage } from "@/components/ui/Toast";

type Data = FunctionReturnType<typeof api.aiSuggestions.forNote>;
export type NoteSuggestion = Data["items"][number];

const KIND: Record<NoteSuggestion["kind"], { label: string; icon: React.ReactNode }> = {
  question: { label: "Open question", icon: <HelpCircle size={13} aria-hidden /> },
  action: { label: "Action item", icon: <ListTodo size={13} aria-hidden /> },
  connection: { label: "Related", icon: <Link2 size={13} aria-hidden /> },
  duplicate: { label: "Possible duplicate", icon: <Copy size={13} aria-hidden /> },
};

const CHIP_BUTTON = "grid h-6 w-6 flex-none place-items-center rounded-chip text-muted transition-colors hover:bg-[var(--glass-active)] hover:text-heading";

/**
 * A note's suggestions as quiet chips (data in, actions out), so they can be shown and tested without a
 * server: open (the line, or the other note), link the other note here, turn a line into a task, dismiss.
 * Changing the note needs `canEdit`.
 */
export function SuggestionChips({
  items,
  canEdit,
  onOpen,
  onLink,
  onTask,
  onDismiss,
}: {
  items: NoteSuggestion[];
  canEdit: boolean;
  onOpen: (s: NoteSuggestion) => void;
  onLink: (s: NoteSuggestion) => void;
  onTask: (s: NoteSuggestion) => void;
  onDismiss: (s: NoteSuggestion) => void;
}) {
  if (!items.length) return null;
  return (
    <section aria-label="Suggestions" className="relative mx-auto mt-4 px-5 sm:px-16" style={{ maxWidth: "calc(var(--editor-width) + 8rem)" }}>
      <h2 className="ui-caps mb-1.5">Suggestions</h2>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((s) => {
          const kind = KIND[s.kind];
          return (
            <li key={s.key} aria-label={`${kind.label}: ${s.label}`} className="flex max-w-full items-center gap-0.5 rounded-chip bg-[var(--glass-hover)] py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)]">
              <button type="button" onClick={() => onOpen(s)} title={s.reason ?? kind.label} className="flex min-w-0 items-center gap-1.5 rounded-chip py-0.5 pr-1 text-left hover:text-heading">
                <span className="flex-none text-muted">{kind.icon}</span>
                <span className="sr-only">{kind.label}: </span>
                <span className="truncate">{s.label}</span>
              </button>
              {canEdit && (s.kind === "connection" || s.kind === "duplicate") ? (
                <button type="button" aria-label="Link it here" title="Link it here" onClick={() => onLink(s)} className={CHIP_BUTTON}>
                  <Link2 size={13} aria-hidden />
                </button>
              ) : null}
              {canEdit && s.kind === "action" ? (
                <button type="button" aria-label="Turn into a task" title="Turn into a task" onClick={() => onTask(s)} className={CHIP_BUTTON}>
                  <ListChecks size={13} aria-hidden />
                </button>
              ) : null}
              <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => onDismiss(s)} className={CHIP_BUTTON}>
                <X size={13} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The top-level block with this id, and where it starts. */
function blockById(editor: Editor, blockId: string): { pos: number; node: PMNode } | null {
  const { doc } = editor.state;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.attrs.id === blockId) return { pos, node };
    pos += node.nodeSize;
  }
  return null;
}

/**
 * Turns a line into an unchecked to-do (one undo step), leaving out a leading marker like "TODO:" (`strip`
 * characters). False when the line isn't there or isn't text.
 */
export function lineToTask(editor: Editor, blockId: string, strip = 0): boolean {
  const at = blockById(editor, blockId);
  const todo = editor.state.schema.nodes.todo;
  if (!at || !todo || !at.node.isTextblock || at.node.type.name === "todo") return false;
  const tr = editor.state.tr;
  tr.setNodeMarkup(at.pos, todo, { id: at.node.attrs.id, depth: at.node.attrs.depth ?? 0, checked: false });
  const leading = at.node.textContent.slice(0, strip);
  if (strip > 0 && leading.length === strip) tr.delete(at.pos + 1, at.pos + 1 + strip);
  editor.view.dispatch(closeHistory(tr));
  return true;
}

/** Adds a line at the end of the note with a [[ link to another note (one undo step). */
export function appendPageLink(editor: Editor, documentId: string, title: string): boolean {
  const { schema } = editor.state;
  const paragraph = schema.nodes.paragraph;
  const link = schema.nodes.pageLink;
  if (!paragraph || !link) return false;
  const line = paragraph.create({ id: ulid(), depth: 0 }, [link.create({ documentId, label: title || "Untitled" })]);
  editor.view.dispatch(closeHistory(editor.state.tr.insert(editor.state.doc.content.size, line).scrollIntoView()));
  return true;
}

/** The suggestions under a note (nothing while they're off, or there are none). */
export function NoteSuggestions({ documentId, editor, readOnly, onJump }: { documentId: string; editor: Editor | null; readOnly: boolean; onJump: (blockId: string) => void }) {
  const data = useQuery(api.aiSuggestions.forNote, { documentId });
  const dismiss = useMutation(api.aiSuggestions.dismiss);
  const { navigate } = useAppRouter();
  const toast = useToast();
  // Hidden at once while the dismissal saves.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  if (!data?.on) return null;
  const items = data.items.filter((s) => !gone.has(s.key));
  const drop = (s: NoteSuggestion) => {
    setGone((g) => new Set(g).add(s.key));
    void dismiss({ documentId, key: s.key }).catch((e) => {
      setGone((g) => {
        const next = new Set(g);
        next.delete(s.key);
        return next;
      });
      toast.show(errorMessage(e), { tone: "error" });
    });
  };
  return (
    <SuggestionChips
      items={items}
      canEdit={data.canEdit && !readOnly && Boolean(editor)}
      onOpen={(s) => (s.blockId ? onJump(s.blockId) : s.noteId ? navigate(`/d/${s.noteId}`) : undefined)}
      onLink={(s) => {
        if (editor && s.noteId && appendPageLink(editor, s.noteId, s.label)) {
          toast.show("Linked");
          drop(s);
        }
      }}
      onTask={(s) => {
        if (editor && s.blockId && lineToTask(editor, s.blockId, s.strip ?? 0)) {
          toast.show("Turned into a task");
          setGone((g) => new Set(g).add(s.key));
        }
      }}
      onDismiss={drop}
    />
  );
}
