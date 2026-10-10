"use client";

import type { Editor } from "@tiptap/react";
import { useId, useState } from "react";
import { Check, Languages, Loader2, X } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useAppRouter } from "@/lib/app/router";
import { AI_LANGUAGES } from "./languages";
import { AiMarkdown } from "./AiMarkdown";
import { AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { applyTranslation, type BlockTranslation } from "./translateApply";
import { useAi } from "./useAi";

type Output = "note" | "replace";
interface Preview {
  language: string;
  translations: BlockTranslation[];
  preview: string;
  untranslated: number;
}

const kept = (n: number) => (n === 1 ? "One piece couldn't be translated and kept its original text." : `${n} pieces couldn't be translated and kept their original text.`);

/**
 * Translate the whole note (the note's AI panel): into a new note beside it ("Title (Spanish)"), or in place.
 * In place shows the translation first; Replace saves a version of the note, then swaps each block's text in
 * one undo step (headings, lists, to-dos, tables, links, mentions and code stay as they are).
 */
export function TranslateNote({ documentId, editor, readOnly, disabled }: { documentId: string; editor: Editor | null; readOnly: boolean; disabled?: boolean }) {
  const { translateNote, versionBeforeReplace } = useAi();
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [language, setLanguage] = useState("Spanish");
  const [output, setOutput] = useState<Output>("note");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uid = useId();
  const how: Output = readOnly ? "note" : output;

  const translate = async () => {
    if (busy) return;
    setBusy(`Translating into ${language}`);
    setProblem(null);
    setNotice(null);
    setPreview(null);
    try {
      const out = await translateNote(documentId, language, how);
      if (how === "note" && out.id) {
        const id = out.id;
        setNotice(`Made "${out.title}".${out.untranslated ? ` ${kept(out.untranslated)}` : ""}`);
        toast.show("Translated into a new note", { action: { label: "Open", onClick: () => navigate(`/d/${id}`) } });
      } else if (out.translations) {
        setPreview({ language, translations: out.translations, preview: out.preview ?? "", untranslated: out.untranslated });
      }
    } catch (e) {
      setProblem(aiProblem(e));
    } finally {
      setBusy(null);
    }
  };

  const replace = async () => {
    if (!preview || !editor || busy) return;
    setBusy("Saving a version first");
    setProblem(null);
    try {
      await versionBeforeReplace(documentId);
      const { changed, skipped } = applyTranslation(editor, preview.translations);
      setPreview(null);
      const left = skipped ? ` ${skipped === 1 ? "One block was" : `${skipped} blocks were`} edited meanwhile and kept as they are.` : "";
      setNotice(changed ? `Translated into ${preview.language}. Undo with ⌘Z, or restore the version saved before it from the note's history.${left}` : `Nothing changed: the note was edited since the translation was made.`);
    } catch (e) {
      setProblem(aiProblem(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`${uid}-title`} className="space-y-2">
      <h3 id={`${uid}-title`} className="ui-caps px-1">
        Translate this note
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select aria-label="Translate into" value={language} onChange={(e) => setLanguage(e.target.value)} className="h-8 rounded-[6px] bg-[var(--glass-hover)] px-2 text-[12.5px] font-medium text-ink">
          {AI_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <div className="ui-seg ui-well w-full basis-full text-[12px]" role="group" aria-label="Where the translation goes">
          <button type="button" aria-pressed={how === "note"} onClick={() => setOutput("note")}>
            New note
          </button>
          <button type="button" aria-pressed={how === "replace"} disabled={readOnly} onClick={() => setOutput("replace")}>
            Replace text
          </button>
        </div>
        <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void translate()} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
          <Languages size={14} aria-hidden /> Translate
        </button>
      </div>
      <p className="px-1 text-[11.5px] text-faint">{how === "note" ? `Makes a copy titled "… (${language})" next to this note.` : "Shows the translation first. A version of the note is saved before anything changes."}</p>
      <div aria-live="polite" className="space-y-2 empty:hidden">
        {busy ? (
          <p className="flex items-center gap-2 rounded-[10px] bg-[var(--glass-hover)] px-3 py-3 text-muted">
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> {busy}…
          </p>
        ) : null}
        {problem ? <AiProblemNotice problem={problem} /> : null}
        {notice ? <p className="px-1 text-[12.5px] text-muted">{notice}</p> : null}
      </div>
      {preview && !busy ? (
        <section aria-label="Translation" className="rounded-[14px] bg-[var(--glass-active)] p-3 shadow-[var(--glass-edge)]">
          <p className="mb-2 text-[12px] font-semibold text-muted">In {preview.language}</p>
          <div className="max-h-[320px] overflow-y-auto pr-1">
            <AiMarkdown markdown={preview.preview} />
          </div>
          {preview.untranslated ? <p className="mt-2 text-[12px] text-muted">{kept(preview.untranslated)}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={readOnly || !editor} onClick={() => void replace()} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
              <Check size={14} aria-hidden /> Replace note text
            </button>
            <button type="button" onClick={() => setPreview(null)} aria-label="Discard" title="Discard" className="ui-btn ui-btn-ghost ml-auto h-8 w-8 px-0">
              <X size={14} aria-hidden />
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
