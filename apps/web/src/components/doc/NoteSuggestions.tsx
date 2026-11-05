"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAiFeature } from "@/lib/mode";
import type { FunctionReturnType } from "convex/server";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Copy, HelpCircle, Link2, ListChecks, ListTodo, X } from "lucide-react";
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useAppState } from "@/lib/app/state";
import { useEngineSelector } from "@/lib/hooks/useEngine";
import { patternItems, patternSuggestions, suggestionLines, type PatternHit } from "@/lib/suggestions";

type Data = FunctionReturnType<typeof api.aiSuggestions.forNote>;
export type NoteSuggestion = Data["items"][number];

const KIND: Record<NoteSuggestion["kind"], { label: string; icon: React.ReactNode }> = {
  question: { label: "Open question", icon: <HelpCircle size={13} aria-hidden /> },
  action: { label: "Action item", icon: <ListTodo size={13} aria-hidden /> },
  connection: { label: "Related", icon: <Link2 size={13} aria-hidden /> },
  duplicate: { label: "Possible duplicate", icon: <Copy size={13} aria-hidden /> },
};

/**
 * One chip per suggestion, except that a note suggested for two reasons (related and a possible duplicate) is
 * one chip naming both, not the same title twice told apart only by icons (QA audit F24). The first suggestion
 * (in the order given) leads the chip; the others ride along, so dismissing the chip dismisses them all.
 */
export interface SuggestionChip {
  lead: NoteSuggestion;
  all: NoteSuggestion[];
  /** The reason in words, shown on the chip for a suggested note ("Related", "Possible duplicate", or both). */
  reason: string;
}

const NOTE_KINDS = new Set<NoteSuggestion["kind"]>(["connection", "duplicate"]);

/** A note's reasons in words: the stronger one first ("Possible duplicate, also related"). */
function reasonOf(kinds: NoteSuggestion["kind"][]): string {
  const dup = kinds.includes("duplicate");
  const rel = kinds.includes("connection");
  if (dup && rel) return "Possible duplicate, also related";
  return KIND[kinds[0]!].label;
}

export function groupSuggestions(items: NoteSuggestion[]): SuggestionChip[] {
  const out: SuggestionChip[] = [];
  const byNote = new Map<string, NoteSuggestion[]>();
  for (const s of items) {
    const noteId = NOTE_KINDS.has(s.kind) && "noteId" in s ? s.noteId : undefined;
    if (!noteId) {
      out.push({ lead: s, all: [s], reason: KIND[s.kind].label });
      continue;
    }
    const group = byNote.get(noteId);
    if (group) {
      group.push(s);
      continue;
    }
    const all = [s];
    byNote.set(noteId, all);
    out.push({ lead: s, all, reason: "" });
  }
  // A duplicate leads its chip (its link action is the same; its reason is the one to read first).
  return out.map((c) => {
    if (c.all.length === 1 && c.reason) return c;
    const lead = c.all.find((x) => x.kind === "duplicate") ?? c.all[0]!;
    return { lead, all: c.all, reason: reasonOf(c.all.map((x) => x.kind)) };
  });
}

const CHIP_BUTTON =
  "grid h-6 w-6 flex-none place-items-center rounded-chip text-muted transition-colors hover:bg-[var(--glass-active)] hover:text-heading";
/** On the note's paper (the iPhone): finger-sized, in the theme's colours. */
const PAPER_BUTTON =
  "grid h-8 w-8 flex-none place-items-center rounded-chip text-muted active:bg-[color-mix(in_oklab,var(--color-heading)_10%,transparent)]";

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
  paper = false,
}: {
  items: NoteSuggestion[];
  canEdit: boolean;
  onOpen: (s: NoteSuggestion) => void;
  onLink: (s: NoteSuggestion) => void;
  onTask: (s: NoteSuggestion) => void;
  onDismiss: (s: NoteSuggestion) => void;
  /** Drawn on the note's own paper (the iPhone's note foot) instead of a frosted card under it. */
  paper?: boolean;
}) {
  if (!items.length) return null;
  const button = paper ? PAPER_BUTTON : CHIP_BUTTON;
  const icon = paper ? 15 : 13;
  return (
    // A frosted card under the note, so it reads on any theme's background (light or dark). 8px inside its
    // 14px corners, so the 6px chips run parallel.
    <section
      aria-label="Suggestions"
      className={paper ? "relative mt-10 w-full" : "relative mx-auto mt-4 w-full"}
      style={paper ? undefined : { maxWidth: "calc(var(--editor-width) + 8rem)" }}
    >
      <div className={paper ? "" : "ui-pop p-2"}>
        <h2 className={paper ? "ui-caps pb-2.5 text-muted" : "ui-caps px-1.5 pb-1.5 pt-1"}>Suggestions</h2>
        <ul className="flex flex-wrap gap-1.5">
          {groupSuggestions(items).map((chip) => {
            const s = chip.lead;
            const kind = KIND[s.kind];
            // A suggested note names its reason on the chip (two notes with the same title, or one note for
            // two reasons, read apart before either is opened).
            const aboutNote = NOTE_KINDS.has(s.kind);
            return (
              <li
                key={s.key}
                aria-label={`${chip.reason}: ${s.label}`}
                className={
                  paper
                    ? "flex max-w-full items-center gap-0.5 rounded-control bg-[color-mix(in_oklab,var(--color-heading)_7%,transparent)] py-0.5 pl-3 pr-0.5 text-subheadline text-ink"
                    : "flex max-w-full items-center gap-0.5 rounded-chip bg-[var(--glass-hover)] py-0.5 pl-2.5 pr-1 text-subheadline text-ink"
                }
              >
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  title={chip.all.map((x) => ("reason" in x && x.reason) || "").find(Boolean) ?? chip.reason}
                  className="flex min-w-0 items-center gap-1.5 rounded-chip py-0.5 pr-1 text-left hover:text-heading"
                >
                  <span className="flex-none text-muted">{kind.icon}</span>
                  {aboutNote ? null : <span className="sr-only">{chip.reason}: </span>}
                  <span className="truncate">{s.label}</span>
                  {aboutNote ? <span className="flex-none text-footnote text-muted">{chip.reason}</span> : null}
                </button>
                {canEdit && (s.kind === "connection" || s.kind === "duplicate") ? (
                  <button
                    type="button"
                    aria-label="Link it here"
                    title="Link it here"
                    onClick={() => onLink(s)}
                    className={button}
                  >
                    <Link2 size={icon} aria-hidden />
                  </button>
                ) : null}
                {canEdit && s.kind === "action" ? (
                  <button
                    type="button"
                    aria-label="Turn into a task"
                    title="Turn into a task"
                    onClick={() => onTask(s)}
                    className={button}
                  >
                    <ListChecks size={icon} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Dismiss"
                  title="Dismiss"
                  onClick={() => chip.all.forEach((x) => onDismiss(x))}
                  className={button}
                >
                  <X size={icon} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
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
  tr.setNodeMarkup(at.pos, todo, {
    id: at.node.attrs.id,
    depth: at.node.attrs.depth ?? 0,
    checked: false,
  });
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
  const line = paragraph.create({ id: ulid(), depth: 0 }, [
    link.create({ documentId, label: title || "Untitled" }),
  ]);
  editor.view.dispatch(
    closeHistory(editor.state.tr.insert(editor.state.doc.content.size, line).scrollIntoView()),
  );
  return true;
}

const sameHits = (a: PatternHit[], b: PatternHit[]) => a.length === b.length && a.every((h, i) => JSON.stringify(h) === JSON.stringify(b[i]));

/** The suggestions under a note (nothing while they're off, or there are none). */
export function NoteSuggestions({
  documentId,
  editor,
  readOnly,
  onJump,
  paper = false,
}: {
  documentId: string;
  editor: Editor | null;
  readOnly: boolean;
  onJump: (blockId: string) => void;
  paper?: boolean;
}) {
  // The graph's suggestions come from the server; questions and action items are found here, in the note as
  // this device holds it, so the server query doesn't re-read the note on every save.
  // Suggestions come from Folevi's servers: not in local mode (WP11), where `data` stays undefined.
  const suggestions = useAiFeature("suggestions");
  const data = useQuery(api.aiSuggestions.forNote, suggestions ? { documentId, lines: false } : "skip");
  const { engine } = useAppState();
  const hits = useEngineSelector(
    engine,
    useCallback(() => (engine ? patternSuggestions(suggestionLines(engine.documentBlocks(documentId))) : []), [engine, documentId]),
    sameHits,
  );
  // A note already listed under the note (Linked from, Mentioned in) isn't suggested again (the same subscription
  // as Backlinks', so no second read).
  const links = useQuery(api.documents.backlinks, { documentId });
  const dismiss = useMutation(api.aiSuggestions.dismiss);
  const { navigate } = useAppRouter();
  const toast = useToast();
  // Hidden at once while the dismissal saves.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  if (!data?.on) return null;
  const dismissed = new Set(data.dismissed);
  const listed = new Set([...(links?.linked ?? []), ...(links?.unlinked ?? [])].map((l) => l.id));
  const items = [...data.items, ...patternItems(hits, dismissed)].filter((s) => !gone.has(s.key) && !("noteId" in s && s.noteId && listed.has(s.noteId)));
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
      onOpen={(s) =>
        s.blockId ? onJump(s.blockId) : s.noteId ? navigate(`/d/${s.noteId}`) : undefined
      }
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
      paper={paper}
    />
  );
}
