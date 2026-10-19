"use client";

// Foli AI for a mind map (convex/mindmapAi.ts): make a map from a prompt, the note, selected text or a PDF
// attached to the note; then grow the selected idea, sum the map up into the note, turn branches into tasks
// (to-dos in the note) or tidy the whole map. The server returns checked block data or short lists; the
// canvas applies each result as one change (⌘Z undoes it). Shown only while Foli AI is on (useAiEnabled);
// in the iPhone app the panel is one of the app's sheets.
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, ListChecks, NotebookText, TextSelect, WandSparkles, X, Network, ScrollText, PenLine } from "lucide-react";
import type { MindmapLayout } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useIphoneApp } from "@/lib/iphone";
import { useNoteAi } from "@/components/ai/useAi";
import { AiIcon } from "@/components/ai/AiIcon";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { Sheet } from "@/components/iphone/Sheet";
import { tasksMarkdown } from "./noteConvert";

export type MapSource = "prompt" | "note" | "text" | "file";

/** How the panel opens: on a tab, with a source picked, and whether to start straight away. */
export interface AiStart {
  tab?: "map" | "new";
  source?: MapSource;
  /** Text to map (selected in the note, or the blocks the block menu was opened on). */
  text?: string;
  auto?: boolean;
}

/** The actions, in the scope of the note the block is in. */
export function useMindmapAi() {
  const { scope } = useAppState();
  const documentId = useNoteAi()?.home?.id;
  const gen = useAction(api.mindmapAi.generate);
  const exp = useAction(api.mindmapAi.expand);
  const sum = useAction(api.mindmapAi.summarize);
  const tsk = useAction(api.mindmapAi.tasks);
  const tdy = useAction(api.mindmapAi.tidy);
  return {
    documentId,
    generate: useCallback((a: { source: MapSource; instruction?: string; text?: string; fileId?: string; layout?: MindmapLayout }) => gen({ scope, documentId, ...a }), [gen, scope, documentId]),
    expand: useCallback((data: string, nodeId: string) => exp({ scope, documentId, data, nodeId }), [exp, scope, documentId]),
    summarize: useCallback((data: string) => sum({ scope, documentId, data }), [sum, scope, documentId]),
    tasks: useCallback((data: string, nodeIds: string[]) => tsk({ scope, documentId, data, nodeIds }), [tsk, scope, documentId]),
    tidy: useCallback((data: string) => tdy({ scope, documentId, data }), [tdy, scope, documentId]),
  };
}

const PROMPT_IDEAS = ["Plan a product launch", "Ideas for a team offsite", "What to learn to become a data analyst"];

const SOURCES: { id: MapSource; label: string; icon: React.ReactNode }[] = [
  { id: "prompt", label: "A prompt", icon: <PenLine size={14} aria-hidden /> },
  { id: "note", label: "This note", icon: <NotebookText size={14} aria-hidden /> },
  { id: "text", label: "Selected text", icon: <TextSelect size={14} aria-hidden /> },
  { id: "file", label: "A PDF", icon: <FileText size={14} aria-hidden /> },
];

export function MindmapAi({
  hasMap,
  selected,
  layout,
  start,
  current,
  onMap,
  onIdeas,
  onInsert,
  onClose,
}: {
  hasMap: boolean;
  /** The selected idea (Expand and Tasks work on it). */
  selected: { id: string; text: string; isRoot: boolean } | null;
  layout: MindmapLayout;
  start: AiStart;
  /** The map's data now. */
  current: () => string;
  /** A whole new map (or the tidied one), as block data. */
  onMap: (data: string, why: "new" | "tidy") => void;
  onIdeas: (parentId: string, ideas: { text: string; children?: { text: string }[] }[]) => void;
  /** Markdown for the note, below the block. */
  onInsert: (markdown: string, what: "summary" | "tasks") => void;
  onClose: () => void;
}) {
  const ai = useMindmapAi();
  const iphone = useIphoneApp();
  const [tab, setTab] = useState<"map" | "new">(start.tab ?? (hasMap ? "map" : "new"));
  const [source, setSource] = useState<MapSource>(start.source ?? "prompt");
  const [text, setText] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const files = useQuery(api.aiAttachments.noteFiles, ai.documentId && tab === "new" ? { documentIds: [ai.documentId] } : "skip");
  const pdfs = (files ?? []).filter((f) => f.kind === "pdf" && f.supported);
  const sources = SOURCES.filter((s) => (s.id === "note" ? Boolean(ai.documentId) : s.id === "text" ? Boolean(start.text) : s.id === "file" ? pdfs.length > 0 : true));
  const pickedFile = fileId && pdfs.some((p) => p.id === fileId) ? fileId : (pdfs[0]?.id ?? null);

  const run = useCallback(
    async (label: string, work: () => Promise<void>) => {
      if (busy) return;
      setBusy(label);
      setError(null);
      setDone(null);
      try {
        await work();
      } catch (e) {
        setError(aiProblem(e));
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const create = () =>
    run(source === "prompt" ? "Making your mind map…" : "Reading and mapping…", async () => {
      const r = await ai.generate({ source, instruction: text.trim() || undefined, text: source === "text" ? start.text : undefined, fileId: source === "file" ? (pickedFile ?? undefined) : undefined, layout });
      onMap(r.data, "new");
    });

  // Opened from the note (the block menu's "Mind map with Foli AI"): start at once.
  const started = useRef(false);
  useEffect(() => {
    if (!start.auto || started.current) return;
    started.current = true;
    void create();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCreate = !busy && (source !== "prompt" || text.trim().length > 0) && (source !== "file" || Boolean(pickedFile));
  const target = selected && !selected.isRoot ? `“${clip(selected.text) || "this idea"}”` : "the map";

  const body = (
    <div
      className={iphone ? "mm-ai mm-ai-sheet" : "mm-ai ui-pop"}
      role={iphone ? undefined : "dialog"}
      aria-label={iphone ? undefined : "Foli AI for this mind map"}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mm-ai-head">
        <AiIcon size={15} />
        {hasMap ? (
          <div className="mm-seg" role="group" aria-label="What Foli AI should do">
            <button type="button" aria-pressed={tab === "map"} onClick={() => setTab("map")}>
              This map
            </button>
            <button type="button" aria-pressed={tab === "new"} onClick={() => setTab("new")}>
              New map
            </button>
          </div>
        ) : (
          <span className="mm-ai-title">Make a mind map with Foli AI</span>
        )}
        {iphone ? null : (
          <button type="button" className="fb-vc-btn mm-ai-close" aria-label="Close Foli AI" title="Close (Esc)" onClick={onClose}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      {tab === "new" ? (
        <div className="mm-ai-new">
          {sources.length > 1 ? (
            <div className="mm-chips" role="group" aria-label="Make it from">
              {sources.map((s) => (
                <button key={s.id} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)}>
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          {source === "file" && pdfs.length > 1 ? (
            <div className="mm-chips" role="group" aria-label="Which PDF">
              {pdfs.map((p) => (
                <button key={p.id} type="button" aria-pressed={pickedFile === p.id} onClick={() => setFileId(p.id)}>
                  <FileText size={13} aria-hidden />
                  {clip(p.name, 28)}
                </button>
              ))}
            </div>
          ) : source === "file" && pdfs[0] ? (
            <p className="mm-ai-note">From {pdfs[0].name}</p>
          ) : source === "text" && start.text ? (
            <p className="mm-ai-note">From the selected text ({start.text.length.toLocaleString()} characters)</p>
          ) : null}
          <form
            className="mm-ai-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canCreate) void create();
            }}
          >
            <textarea
              autoFocus={!start.auto}
              rows={2}
              value={text}
              disabled={Boolean(busy)}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canCreate) void create();
                }
              }}
              aria-label={source === "prompt" ? "What should the mind map be about?" : "Anything to focus on (optional)"}
              placeholder={source === "prompt" ? "What should the mind map be about?" : "Anything to focus on? (optional)"}
            />
            <button type="submit" className="mm-ai-send" aria-label="Create mind map" disabled={!canCreate}>
              <ArrowUp size={15} aria-hidden />
            </button>
          </form>
          {source === "prompt" && !busy && !error ? (
            <ul className="mm-ai-ideas" aria-label="Ideas">
              {PROMPT_IDEAS.map((idea) => (
                <li key={idea}>
                  <button type="button" onClick={() => setText(idea)}>
                    {idea}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {hasMap ? <p className="mm-ai-note">Replaces this map. Undo with ⌘Z.</p> : null}
        </div>
      ) : (
        <div className="mm-ai-actions" role="group" aria-label="Foli AI actions">
          <Action
            icon={<Network size={15} aria-hidden />}
            label={selected ? `Expand ${selected.isRoot ? "the central idea" : target}` : "Expand an idea"}
            detail={selected ? "3 to 6 new ideas inside it. Ask again for more." : "Select an idea first."}
            disabled={!selected || Boolean(busy)}
            onClick={() =>
              selected &&
              run("Thinking of ideas…", async () => {
                const r = await ai.expand(current(), selected.id);
                onIdeas(selected.id, r.ideas);
                setDone(`Added ${r.ideas.length} idea${r.ideas.length === 1 ? "" : "s"}.`);
              })
            }
          />
          <Action
            icon={<ScrollText size={15} aria-hidden />}
            label="Summarise into the note"
            detail="A short write-up below the map."
            disabled={Boolean(busy)}
            onClick={() =>
              run("Summarising…", async () => {
                const r = await ai.summarize(current());
                onInsert(r.markdown, "summary");
                setDone("The summary is in the note, below the map.");
              })
            }
          />
          <Action
            icon={<ListChecks size={15} aria-hidden />}
            label={`Turn ${target} into tasks`}
            detail="Next steps as to-dos in the note."
            disabled={Boolean(busy)}
            onClick={() =>
              run("Finding the next steps…", async () => {
                const r = await ai.tasks(current(), selected && !selected.isRoot ? [selected.id] : []);
                onInsert(tasksMarkdown(r.tasks), "tasks");
                setDone(`Added ${r.tasks.length} task${r.tasks.length === 1 ? "" : "s"} to the note.`);
              })
            }
          />
          <Action
            icon={<WandSparkles size={15} aria-hidden />}
            label="Tidy with Foli AI"
            detail="Groups, merges and rewords ideas. Undo with ⌘Z."
            disabled={Boolean(busy)}
            onClick={() =>
              run("Tidying the map…", async () => {
                const r = await ai.tidy(current());
                onMap(r.data, "tidy");
                setDone("Tidied. Undo with ⌘Z.");
              })
            }
          />
        </div>
      )}
      {busy ? (
        <p className="mm-ai-status" role="status">
          {busy}
        </p>
      ) : error ? (
        <AiProblemNotice problem={error} className={error.kind === "other" ? "mm-ai-error" : "mx-3 mb-2"} />
      ) : done ? (
        <p className="mm-ai-status" role="status">
          {done}
        </p>
      ) : (
        <AiCreditsNote documentId={ai.documentId} className="mx-3 mb-2" />
      )}
      <p className="mm-ai-foot">Foli AI can make mistakes. Uses AI credits; sent to Google Gemini.</p>
    </div>
  );

  if (iphone)
    return (
      <Sheet open onClose={onClose} label="Foli AI for this mind map" size="medium">
        {body}
      </Sheet>
    );
  return body;
}

function Action({ icon, label, detail, disabled, onClick }: { icon: React.ReactNode; label: string; detail: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="mm-ai-action" disabled={disabled} onClick={onClick}>
      <span className="mm-ai-action-icon">{icon}</span>
      <span className="mm-ai-action-text">
        <span>{label}</span>
        <span className="mm-ai-action-detail">{detail}</span>
      </span>
    </button>
  );
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

