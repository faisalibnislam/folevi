"use client";

import type { Editor } from "@tiptap/react";
import { useAction } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import type { SyncEngine } from "@/lib/sync/engine";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { DateField, TimeField } from "@/components/ui/DateField";
import { useToast } from "@/components/ui/Toast";
import { naturalDateLabel } from "@/lib/nlDate";
import { ownerHint, proposalsFrom, todoBlocksFor, wallClockNow, type ProposedTodo } from "@/lib/ai/actionItems";
import { AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { insertAiBlocks } from "./insert";

/** Opens "Find to-dos" in this editor, on a range of text (a selection) or the whole note. */
export const FIND_TODOS_EVENT = "folevi:ai-find-todos";
export interface FindTodosOpen {
  target: { from: number; to: number; text: string } | null;
}
export function openFindTodos(editorDom: Element, detail: FindTodosOpen): void {
  editorDom.dispatchEvent(new CustomEvent<FindTodosOpen>(FIND_TODOS_EVENT, { detail }));
}

/** Listens for FIND_TODOS_EVENT on the editor and shows the proposal (the "/" menu, the composer, the AI panel). */
export function FindTodosHost({ editor, documentId, enabled }: { editor: Editor; documentId: string; enabled: boolean }) {
  const [open, setOpen] = useState<(FindTodosOpen & { id: number }) | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const dom = editor.view.dom as HTMLElement;
    const on = (e: Event) => setOpen({ id: Date.now(), ...(e as CustomEvent<FindTodosOpen>).detail });
    dom.addEventListener(FIND_TODOS_EVENT, on);
    return () => dom.removeEventListener(FIND_TODOS_EVENT, on);
  }, [editor, enabled]);
  if (!enabled || !open) return null;
  return <FindTodosDialog key={open.id} editor={editor} documentId={documentId} target={open.target} onClose={() => setOpen(null)} />;
}

/**
 * Resolves once this note's edits made on this device have reached the server (Foli AI reads the server's
 * copy, and a brand-new note has to exist there), or after `ms` either way. The editor hands its last
 * keystrokes to the sync queue within a second of typing (Editor.tsx), so this waits a moment first.
 */
function whenSaved(engine: SyncEngine | null, documentId: string, ms = 10_000): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (!engine || !engine.hasLocalWork(documentId)) return resolve();
      let unsubscribe = () => {};
      const finish = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(finish, ms);
      unsubscribe = engine.subscribe(() => {
        if (!engine.hasLocalWork(documentId)) finish();
      });
      engine.scheduleFlush(0);
    }, 300);
  });
}

type Person = { profileId: string; displayName: string; isYou: boolean };
type Phase = { kind: "busy" } | { kind: "error"; problem: AiProblem } | { kind: "ready"; rows: ProposedTodo[]; people: Person[] };

/**
 * "Find to-dos": Foli AI lists the note's action items (or the selection's) as proposed to-dos, each checked,
 * with the due date it read from the note's words (worked out here, from the person's today), the person it
 * goes to, and the sentence it came from, so a wrong date or owner shows before anything is made. "Add"
 * inserts the checked ones as to-dos (one undo step): below the selection, or under a "To-dos" heading at
 * the end of the note. They become tasks like any typed to-do, so they show in Calendar and the feed.
 */
function FindTodosDialog({ editor, documentId, target, onClose }: { editor: Editor; documentId: string; target: FindTodosOpen["target"]; onClose: () => void }) {
  const { scope, today, timeZone, engine } = useAppState();
  const find = useAction(api.aiTodos.find);
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "busy" });
  const seq = useRef(0);
  const uid = useId();

  const run = async () => {
    const mine = ++seq.current;
    setPhase({ kind: "busy" });
    try {
      await whenSaved(engine, documentId);
      if (mine !== seq.current) return;
      const { items, people } = await find({ scope, documentId, text: target?.text });
      if (mine !== seq.current) return;
      setPhase({ kind: "ready", rows: proposalsFrom(items, wallClockNow(timeZone)), people });
    } catch (e) {
      if (mine === seq.current) setPhase({ kind: "error", problem: aiProblem(e) });
    }
  };
  useEffect(() => {
    // Closed while it runs: the answer is dropped.
    const runs = seq;
    void run();
    return () => {
      runs.current++;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = phase.kind === "ready" ? phase.rows : [];
  const chosen = rows.filter((r) => r.checked && r.text.trim()).length;
  const update = (key: string, patch: Partial<ProposedTodo>) => setPhase((p) => (p.kind === "ready" ? { ...p, rows: p.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : p));

  const add = () => {
    if (phase.kind !== "ready" || !chosen) return;
    // Below the text they came from, or at the end of the note under a heading of their own.
    const blocks = todoBlocksFor(phase.rows, target ? {} : { heading: "To-dos" });
    insertAiBlocks(editor, blocks, target ? { kind: "below", at: Math.min(target.to, editor.state.doc.content.size) } : { kind: "end" });
    toast.show(chosen === 1 ? "Added 1 to-do" : `Added ${chosen} to-dos`);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Find to-dos"
      description={target ? "Foli AI found these in the selected text. Check the dates and people, then add the ones you want." : "Foli AI found these in this note. Check the dates and people, then add the ones you want."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={add} disabled={phase.kind !== "ready" || !chosen}>
            {chosen === 1 ? "Add 1 to-do" : `Add ${chosen} to-dos`}
          </Button>
        </>
      }
    >
      {phase.kind === "busy" ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> Finding to-dos…
        </p>
      ) : phase.kind === "error" ? (
        <div className="space-y-3 py-2">
          <AiProblemNotice problem={phase.problem} />
          <Button size="sm" onClick={() => void run()}>
            Try again
          </Button>
        </div>
      ) : !rows.length ? (
        <p className="py-6 text-sm text-muted" role="status">
          No to-dos found. Foli AI looks for things someone agreed or was asked to do.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Proposed to-dos">
          {rows.map((r, i) => {
            const hint = ownerHint(r);
            const label = r.text.trim() || `To-do ${i + 1}`;
            return (
              <li key={r.key} className={`rounded-control bg-[var(--glass-hover)] p-3 transition-opacity ${r.checked ? "" : "opacity-60"}`} data-testid="proposed-todo">
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={r.checked} onChange={(checked) => update(r.key, { checked })} describedBy={`${uid}-${r.key}-from`} className="mt-2">
                    <span className="sr-only">Add “{label}”</span>
                  </Checkbox>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      value={r.text}
                      onChange={(e) => update(r.key, { text: e.target.value })}
                      aria-label={`To-do ${i + 1}`}
                      className="h-9 w-full ui-input rounded-chip px-3 text-[14px] outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <DateField value={r.date} onChange={(date) => update(r.key, date ? { date } : { date: "", time: "" })} aria-label={`Due date for ${label}`} className="w-40" />
                      {r.date ? <TimeField value={r.time} onChange={(time) => update(r.key, { time })} emptyLabel="All day" aria-label={`Due time for ${label}`} className="w-28" /> : null}
                      <Select value={r.assigneeId} onChange={(e) => update(r.key, { assigneeId: e.target.value })} aria-label={`Assignee for ${label}`} className="h-8 ui-input rounded-chip px-3">
                        <option value="">Unassigned</option>
                        {phase.people.map((p) => (
                          <option key={p.profileId} value={p.profileId}>
                            {p.displayName}
                            {p.isYou ? " (you)" : ""}
                          </option>
                        ))}
                      </Select>
                      {hint ? (
                        <span className="text-muted" title={r.match === "ambiguous" ? `More than one person here is called ${r.owner}` : `Nobody here is called ${r.owner}`}>
                          {hint}
                        </span>
                      ) : null}
                    </div>
                    <p id={`${uid}-${r.key}-from`} className="text-[12px] leading-snug text-muted">
                      {r.date ? <>Due {naturalDateLabel({ date: r.date, time: r.time || undefined }, today)}. </> : r.unreadWhen ? <>No date: couldn’t read “{r.when}” as one. </> : null}
                      {r.quote ? <>From: “{r.quote}”</> : r.when ? <>From: “{r.when}”</> : null}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
