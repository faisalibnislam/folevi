"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppRouter } from "@/lib/app/router";
import { AiIcon } from "./AiIcon";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { useAiStream } from "./useAiStream";
import { useAi } from "./useAi";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { AiAnnouncer, useDoneAnnouncement } from "./announce";

const EXAMPLES: Record<"template" | "note", string[]> = {
  template: ["Weekly team meeting", "Project kickoff", "Book notes", "Trip planner"],
  note: ["A packing list for a weekend hike", "A plan to learn Spanish in three months", "Notes for a product launch"],
};

/**
 * Generates a template (or a note) from a description, where you are: the AI writes it, you see it with
 * its name, and only "Save template" (or "Create note") makes it. A saved template is a regular one: it's
 * in Templates and the template picker like any other.
 */
export function AiGenerateDialog({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: "template" | "note" }) {
  const { write, saveDraft } = useAi();
  const stream = useAiStream();
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);
  const [draft, setDraft] = useState<{ title: string; text: string; prompt: string } | null>(null);
  const runSeq = useRef(0);
  const uid = useId();
  const noun = kind === "template" ? "template" : "note";
  // Said once when the draft is ready; then focus moves to its name (the prompt box was disabled while writing).
  const announce = useDoneAnnouncement(busy, draft ? `The ${noun} is ready. Check it, then save it.` : "");
  const nameRef = useRef<HTMLInputElement>(null);
  const shown = Boolean(draft && !busy);
  useEffect(() => {
    if (shown) nameRef.current?.focus();
  }, [shown]);

  useEffect(() => {
    if (open) return;
    runSeq.current++;
    setPrompt("");
    setDraft(null);
    setError(null);
    setBusy(false);
  }, [open]);

  const generate = async (description: string) => {
    const text = description.trim();
    if (!text || busy) return;
    const seq = ++runSeq.current;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const streamId = await stream.begin().catch(() => undefined);
      const out = await write(kind === "template" ? "template" : "page", { instruction: text, streamId });
      if (seq !== runSeq.current) return;
      await stream.finish(out.text);
      if (seq !== runSeq.current) return;
      if (out.text.trim()) setDraft({ title: out.title || text.slice(0, 80), text: out.text, prompt: text });
    } catch (e) {
      if (seq === runSeq.current) setError(aiProblem(e));
    } finally {
      if (seq === runSeq.current) {
        stream.end();
        setBusy(false);
      }
    }
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { id } = await saveDraft(kind, draft.title, draft.text);
      onClose();
      if (kind === "note") navigate(`/d/${id}`);
      else toast.show("Saved to Templates", { action: { label: "Open", onClick: () => navigate(`/d/${id}`) } });
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={kind === "template" ? "Generate a template" : "Generate a note"}
      description={`Describe it and AI writes the ${noun}. You'll see it before it's saved.`}
      footer={
        draft && !busy ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
            <Button variant="secondary" onClick={() => void generate(draft.prompt)}>
              <RotateCcw size={14} aria-hidden /> Try again
            </Button>
            <Button variant="primary" disabled={saving || !draft.title.trim()} onClick={() => void save()}>
              {kind === "template" ? "Save template" : "Create note"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {busy ? (
              <Button variant="secondary" onClick={() => stream.stop()}>
                <span aria-hidden className="h-2 w-2 rounded-[4px] bg-current" /> Stop
              </Button>
            ) : (
              <Button variant="primary" disabled={!prompt.trim()} onClick={() => void generate(prompt)}>
                <AiIcon size={14} aria-hidden /> Generate
              </Button>
            )}
          </>
        )
      }
    >
      {!draft || busy ? (
        <div className="space-y-3">
          <label htmlFor={`${uid}-prompt`} className="block text-[13px] font-medium text-heading">
            {kind === "template" ? "What's the template for?" : "What should the note be?"}
          </label>
          <textarea
            id={`${uid}-prompt`}
            rows={3}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void generate(prompt);
              }
            }}
            placeholder={kind === "template" ? "A one-on-one with my manager: wins, blockers, feedback, next steps" : "A plan for moving house next month"}
            className="ui-input block w-full resize-none rounded-[10px] px-3 py-2.5 text-[14px] text-ink placeholder:text-faint"
          />
          {!busy ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Examples">
              {EXAMPLES[kind].map((x) => (
                <button key={x} type="button" onClick={() => setPrompt(x)} className="rounded-[6px] bg-[var(--glass-hover)] px-2.5 py-1 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
                  {x}
                </button>
              ))}
            </div>
          ) : null}
          {busy ? (
            <div className="max-h-[46vh] overflow-y-auto rounded-[10px] bg-[var(--glass-hover)] p-3" aria-busy="true">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
                <AiIcon size={12} aria-hidden className="animate-pulse motion-reduce:animate-none" /> Writing the {noun}…
              </p>
              {stream.text ? <StreamingText text={stream.text} /> : null}
            </div>
          ) : null}
          {!busy && !error ? <AiCreditsNote /> : null}
        </div>
      ) : (
        <section aria-label={`The ${noun}`} className="space-y-3">
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-[12px] font-medium text-muted">
              {kind === "template" ? "Template name" : "Title"}
            </label>
            <input
              ref={nameRef}
              id={`${uid}-name`}
              value={draft.title}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="ui-input block h-9 w-full rounded-[10px] px-3 text-[15px] font-semibold text-heading"
            />
          </div>
          <div className="max-h-[46vh] overflow-y-auto rounded-[10px] bg-[var(--glass-hover)] p-3 shadow-[inset_0_0_0_1px_var(--glass-border)]">
            <AiMarkdown markdown={draft.text} />
          </div>
          <p className="text-[11.5px] text-faint">Foli can make mistakes, so check it before you save. Sent to Google Gemini.</p>
        </section>
      )}
      {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "mt-3 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger" : "mt-3"} /> : null}
      <AiAnnouncer text={announce} />
    </Dialog>
  );
}
