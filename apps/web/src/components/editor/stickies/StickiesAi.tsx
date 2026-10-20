"use client";

// Foli AI on a sticky notes board (convex/stickiesAi.ts): group by theme, summarise, suggest ideas, read a
// photo of paper notes, turn notes into to-dos, and write the board up in the note. Each action is one
// request with AI credits like any Foli AI help; the board changes only through `onApply` (one undo step),
// the note only through `onInsert*`. Shown only while Foli AI is on (StickiesView checks useAiEnabled).
import { useAction } from "convex/react";
import { useRef, useState } from "react";
import { Camera, FileText, ImageUp, LayoutGrid, Lightbulb, ListTodo, ScrollText } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { inIosApp } from "@/lib/nativeApp";
import { useAiFeature } from "@/lib/mode";
import { AiIcon } from "@/components/ai/AiIcon";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import type { StickyColor } from "@folevi/editor-schema";
import { Panel } from "./StickiesChrome";
import { photoForAi } from "./photo";

export type StickiesAiResult =
  | { kind: "cluster"; groups: { label: string; ids: string[] }[] }
  | { kind: "ideas"; ideas: { text: string; color: StickyColor }[] }
  | { kind: "photo"; notes: { text: string; color: StickyColor }[] }
  | { kind: "tasks"; tasks: { noteId: string; text: string; owner: string | null }[] };

type Busy = "cluster" | "summary" | "ideas" | "photo" | "tasks" | "writeUp" | null;

const BUSY_TEXT: Record<Exclude<Busy, null>, string> = {
  cluster: "Grouping the notes by theme…",
  summary: "Summarising the board…",
  ideas: "Thinking of ideas…",
  photo: "Reading the photo…",
  tasks: "Turning notes into to-dos…",
  writeUp: "Writing the board up…",
};

export function StickiesAi({
  board,
  documentId,
  chosen,
  noteCount,
  onApply,
  onInsertSummary,
  onInsertWriteUp,
  onClose,
}: {
  /** The board as stored (sent with each request). */
  board: () => string;
  documentId?: string;
  /** The chosen notes' ids (to-dos are made from these, or from every note when none are chosen). */
  chosen: string[];
  noteCount: number;
  onApply: (result: StickiesAiResult) => void;
  onInsertSummary: (summary: string) => void;
  onInsertWriteUp: (w: { title: string; summary: string; nextSteps: string[] }) => void;
  onClose: () => void;
}) {
  const { scope } = useAppState();
  const cluster = useAction(api.stickiesAi.cluster);
  const summarize = useAction(api.stickiesAi.summarize);
  const ideas = useAction(api.stickiesAi.ideas);
  const photo = useAction(api.stickiesAi.photo);
  // Reading a photo needs a model that sees images: not in local mode (WP11).
  const photoOn = useAiFeature("stickiesPhoto");
  const tasks = useAction(api.stickiesAi.tasks);
  const writeUp = useAction(api.stickiesAi.writeUp);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [about, setAbout] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const where = { scope, ...(documentId ? { documentId } : {}) };
  const ios = inIosApp();

  const run = async (what: Exclude<Busy, null>, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(null);
    }
  };

  const fromPhoto = (file: File | undefined) => {
    if (!file) return;
    void run("photo", async () => {
      const image = await photoForAi(file).catch((e: Error) => {
        throw new Error(e.message);
      });
      const r = await photo({ ...where, image });
      if (!r.notes.length) throw new Error("Foli AI didn't find any sticky notes in that photo. Try one taken straight on, with the notes in focus.");
      onApply({ kind: "photo", notes: r.notes as { text: string; color: StickyColor }[] });
    });
  };

  const taskIds = chosen.length ? chosen : null;
  const actions: { key: Exclude<Busy, null>; label: string; detail: string; icon: React.ReactNode; disabled?: boolean; onClick: () => void }[] = [
    {
      key: "cluster",
      label: "Group by theme",
      detail: "Sorts the notes into labelled groups",
      icon: <LayoutGrid size={15} aria-hidden />,
      disabled: noteCount < 2,
      onClick: () => void run("cluster", async () => onApply({ kind: "cluster", groups: (await cluster({ ...where, board: board() })).groups })),
    },
    {
      key: "summary",
      label: "Summarise the board",
      detail: "The main themes and what got the most votes",
      icon: <ScrollText size={15} aria-hidden />,
      disabled: !noteCount,
      onClick: () => void run("summary", async () => setSummary((await summarize({ ...where, board: board() })).summary)),
    },
    {
      key: "tasks",
      label: taskIds ? (taskIds.length === 1 ? "Turn the chosen note into a to-do" : `Turn ${taskIds.length} chosen notes into to-dos`) : "Turn the notes into to-dos",
      detail: "Clear to-dos in the note, under the board",
      icon: <ListTodo size={15} aria-hidden />,
      disabled: !noteCount,
      onClick: () =>
        void run("tasks", async () => {
          const r = await tasks({ ...where, board: board(), noteIds: taskIds ?? [] });
          onApply({ kind: "tasks", tasks: r.tasks });
        }),
    },
    {
      key: "writeUp",
      label: "Write the board up in the note",
      detail: "A summary and next steps under the board",
      icon: <FileText size={15} aria-hidden />,
      disabled: !noteCount,
      onClick: () =>
        void run("writeUp", async () => {
          onInsertWriteUp(await writeUp({ ...where, board: board() }));
          onClose();
        }),
    },
  ];

  return (
    <Panel title="Foli AI" onClose={onClose} className="st-ai">
      <div className="st-panel-body">
        {busy ? (
          <p className="st-ai-status" role="status">
            <AiIcon size={14} className="st-ai-mark" /> {BUSY_TEXT[busy]}
          </p>
        ) : error ? (
          <AiProblemNotice problem={error} className={error.kind === "other" ? "st-ai-error" : undefined} />
        ) : (
          <AiCreditsNote documentId={documentId} />
        )}
        {summary !== null ? (
          <div className="st-ai-result">
            <p className="st-ai-summary">{summary}</p>
            <div className="st-panel-actions">
              <button type="button" className="st-btn st-btn-text" onClick={() => setSummary(null)}>
                Back
              </button>
              <button type="button" className="st-btn st-btn-text" onClick={() => void navigator.clipboard?.writeText(summary).catch(() => undefined)}>
                Copy
              </button>
              <button
                type="button"
                className="st-btn st-btn-primary"
                onClick={() => {
                  onInsertSummary(summary);
                  onClose();
                }}
              >
                Insert below the board
              </button>
            </div>
          </div>
        ) : (
          <>
            <form
              className="st-ai-ideas"
              onSubmit={(e) => {
                e.preventDefault();
                void run("ideas", async () => onApply({ kind: "ideas", ideas: (await ideas({ ...where, board: board(), instruction: about.trim() || undefined })).ideas as { text: string; color: StickyColor }[] }));
              }}
            >
              <Lightbulb size={15} aria-hidden className="st-ai-mark" />
              <input className="st-input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={2000} disabled={Boolean(busy)} aria-label="Suggest ideas about" placeholder={noteCount ? "Suggest more ideas (or say about what)" : "Suggest ideas about…"} />
              <button type="submit" className="st-btn st-btn-primary" disabled={Boolean(busy) || (!noteCount && !about.trim())}>
                Suggest
              </button>
            </form>
            <ul className="st-ai-actions" aria-label="Foli AI actions">
              {actions.map((a) => (
                <li key={a.key}>
                  <button type="button" className="st-ai-action" disabled={Boolean(busy) || a.disabled} onClick={a.onClick}>
                    {a.icon}
                    <span>
                      <span className="st-ai-action-label">{a.label}</span>
                      <span className="st-ai-action-detail">{a.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
              {photoOn ? (
              <li>
                <div className="st-ai-action st-ai-photo">
                  <ImageUp size={15} aria-hidden />
                  <span>
                    <span className="st-ai-action-label">Paper notes from a photo</span>
                    <span className="st-ai-action-detail">One note per sticky note, in its colour</span>
                    <span className="st-ai-photo-btns">
                      {ios ? (
                        <button type="button" className="st-btn st-btn-text" disabled={Boolean(busy)} onClick={() => cameraRef.current?.click()}>
                          <Camera size={14} aria-hidden /> Take photo
                        </button>
                      ) : null}
                      <button type="button" className="st-btn st-btn-text" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
                        <ImageUp size={14} aria-hidden /> {ios ? "Choose photo" : "Upload photo"}
                      </button>
                    </span>
                  </span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  hidden
                  onChange={(e) => {
                    fromPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    fromPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </li>
              ) : null}
            </ul>
          </>
        )}
        <p className="st-ai-foot">Foli AI can make mistakes. Sent to Google Gemini. Undo changes to the board with ⌘Z.</p>
      </div>
    </Panel>
  );
}
