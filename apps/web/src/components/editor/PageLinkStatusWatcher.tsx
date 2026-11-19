"use client";
// Looks up the pages a note's [[ links point to and hands their state to the PageLinkStatus plugin
// (kept apart so the editor's extensions don't pull in the app's data layer). It sits next to the editor, and
// is also where the note's file addresses are asked for in one question (NoteFileUrls in NodeViews.tsx): both
// are what the server knows about the things this note points at.
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { NoteFileUrls } from "./NodeViews";
import { pageLinkStatusKey as key, touchesPageLinks, type Status } from "./pageLinkStatus";

/** The server answers for this many pages in one question (convex/documents.ts titles). */
export const PAGES_PER_QUESTION = 200;

type Titles = Record<string, { inTrash?: boolean } | undefined>;
/** One question's answer: the pages asked about, and what came back for them. */
export interface PageAnswer {
  ids: readonly string[];
  titles: Titles;
}

function linkedIds(editor: Editor): string {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "pageLink" && node.attrs.documentId) ids.add(String(node.attrs.documentId));
  });
  return [...ids].sort().join(",");
}

/** A note's linked pages in groups the server answers whole. */
export function pageQuestions(ids: readonly string[], size = PAGES_PER_QUESTION): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * The links to cross out. A page is "missing" only when it was asked about and the answer came back without
 * it; one that wasn't in any answered question yet says nothing. (All of a note's links once went in a single
 * question, the server answered for the first 200, and every link past them was drawn as unavailable.)
 */
export function pageLinkStatuses(answers: readonly PageAnswer[], creating: ReadonlySet<string>): Record<string, Status> {
  const next: Record<string, Status> = {};
  for (const { ids, titles } of answers) {
    for (const id of ids) {
      const info = titles[id];
      if (info?.inTrash) next[id] = "trash";
      // A page made here and not yet sent isn't gone.
      else if (!info && !creating.has(id)) next[id] = "missing";
    }
  }
  return next;
}

/** One group's answer as a short string, a letter per page in the group's order: "t" in Trash, "m" not there, "" there. */
function summarize(ids: readonly string[], titles: Titles): string {
  return ids.map((id) => (titles[id]?.inTrash ? "t" : titles[id] ? "" : "m")).join(",");
}

/** The answer a summary stands for. */
function answerOf(group: string, summary: string): PageAnswer {
  const ids = group.split(",");
  const marks = summary.split(",");
  return { ids, titles: Object.fromEntries(ids.flatMap((id, i) => (marks[i] === "m" ? [] : [[id, { inTrash: marks[i] === "t" }]]))) };
}

function PagesQuestion({ ids, onAnswer }: { ids: string[]; onAnswer: (group: string, summary: string) => void }) {
  const titles = useQuery(api.documents.titles, { documentIds: ids });
  const group = ids.join(",");
  // (As a string: the same answer arriving again as a new object changes nothing, and asks for no redraw.)
  const summary = titles ? summarize(ids, titles) : null;
  useEffect(() => {
    if (summary !== null) onAnswer(group, summary);
  }, [group, summary, onAnswer]);
  return null;
}

/** A question the server refused throws while it draws: the links simply stay as they are. */
class Quietly extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Looks up the pages the note's [[ links point to and marks the ones that are gone. */
export function PageLinkStatusWatcher({ editor }: { editor: Editor }) {
  const { engine } = useAppState();
  const [ids, setIds] = useState(() => linkedIds(editor));
  useEffect(() => {
    // The note is only walked again when an edit adds, removes or changes a link (not on every key).
    const update = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
      if (touchesPageLinks(transaction) || appendedTransactions.some(touchesPageLinks)) setIds(linkedIds(editor));
    };
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  // Each group's latest answer, by the group's ids (a group that changes asks again and answers under its new ids).
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const onAnswer = useCallback((group: string, summary: string) => setAnswers((had) => (had[group] === summary ? had : { ...had, [group]: summary })), []);
  const groups = pageQuestions(ids ? ids.split(",") : []);
  // Answers for groups the note no longer has are let go (each edit that changes a link makes a new group).
  useEffect(() => {
    const live = new Set(pageQuestions(ids ? ids.split(",") : []).map((group) => group.join(",")));
    setAnswers((had) => (Object.keys(had).every((group) => live.has(group)) ? had : Object.fromEntries(Object.entries(had).filter(([group]) => live.has(group)))));
  }, [ids]);
  useEffect(() => {
    if (editor.isDestroyed) return;
    const creating = new Set(
      engine ? [...engine.state.pending, ...engine.state.inflight].flatMap((op) => (op.kind === "document.create" ? [op.document.id] : [])) : [],
    );
    // Only the groups the note has now (an answer for links since removed says nothing about this note).
    const live = pageQuestions(ids ? ids.split(",") : []).flatMap((ask) => {
      const group = ask.join(",");
      const summary = answers[group];
      return summary === undefined ? [] : [answerOf(group, summary)];
    });
    const next = pageLinkStatuses(live, creating);
    const now = key.getState(editor.state)?.statuses ?? {};
    if (JSON.stringify(now) === JSON.stringify(next)) return;
    editor.view.dispatch(editor.state.tr.setMeta(key, next).setMeta("addToHistory", false));
  }, [answers, ids, editor, engine]);
  return (
    <>
      <Quietly key={ids}>
        {groups.map((group) => (
          <PagesQuestion key={group[0]} ids={group} onAnswer={onAnswer} />
        ))}
      </Quietly>
      <NoteFileUrls editor={editor} />
    </>
  );
}
