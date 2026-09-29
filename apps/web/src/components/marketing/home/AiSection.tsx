import { ArrowUp, FileText, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { TRIAL_DAYS } from "@/lib/plans";
import { artById, artThumb } from "../product/Replica";
import { Kbd, SectionHeading, container } from "../ui";

const facts = [
  <>
    Write, rewrite, summarize or continue text from the slash menu, the selection toolbar or <Kbd>⌘J</Kbd>.
  </>,
  <>Catch me up, on Home, writes a short brief of your week: recent notes and what’s due.</>,
  <>Part of Pro, and of the {TRIAL_DAYS}-day Pro trial every new account gets.</>,
  <>Turn it off in Settings at any time. While it’s off, none of your notes are sent to it.</>,
];

export function AiSection() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={container}>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <AiIcon size={32} />
            <SectionHeading
              className="mt-6"
              id="ai-title"
              eyebrow="AI Assistant"
              title="Ask your notes a question."
              lede="The AI Assistant answers from the notes you can open, and links to the notes it used so you can check the answer."
            />
            <ul className="mt-8 space-y-3.5">
              {facts.map((fact, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                  <span aria-hidden="true" className="mt-[9px] size-[5px] flex-none rounded-full bg-(--color-ink-muted)" />
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mk-stage px-3 py-8 sm:px-10 sm:py-12" style={{ ["--stage-art" as string]: artThumb(artById("art-49")) }}>
            <AskPanel />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A replica of the app's Ask AI chat, with one question and its answer. */
function AskPanel() {
  return (
    <div
      role="img"
      aria-label="The Ask AI panel. Question: When is swap day, and what is left to do? The answer names the date and the two open tasks, and lists the two notes it used as sources."
      className="mk-app-pop mx-auto flex max-w-[420px] flex-col overflow-hidden rounded-[18px] text-[13.5px]"
    >
      <div aria-hidden="true">
        <div className="flex items-center gap-2.5 border-b border-(--color-line) px-4 py-3">
          <span className="grid size-7 place-items-center rounded-full bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)]">
            <AiIcon size={14} mono className="text-white" />
          </span>
          <p className="flex-1 text-[14.5px] font-semibold text-(--color-heading)">Ask AI</p>
          <X size={16} className="text-muted" />
        </div>
        <div className="space-y-2 px-4 py-4">
          <p className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-(--color-heading) px-3.5 py-2 text-(--color-canvas)">
            When is swap day, and what’s left to do?
          </p>
          <div className="rounded-[14px] rounded-bl-[4px] bg-(--glass-active) px-4 py-3 leading-relaxed text-ink shadow-(--glass-edge)">
            <p>
              Swap day is the <strong className="font-semibold text-(--color-heading)">first Saturday in April</strong>. Two tasks are still
              open: print the seed labels by Friday, and order glassine envelopes by Monday.
            </p>
            <div className="mt-3 border-t border-(--color-line) pt-2.5">
              <p className="mk-caps mb-1.5 text-[10.5px]">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                {["Seed library", "Thursday notes"].map((title, n) => (
                  <span key={title} className="inline-flex items-center gap-1.5 rounded-full bg-(--glass-hover) px-2.5 py-1 text-[12px] text-ink">
                    <span className="font-semibold text-muted">{n + 1}</span>
                    <FileText size={12} className="text-muted" />
                    {title}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-(--color-line) px-3 pb-3 pt-2.5">
          <div className="relative rounded-[14px] bg-(--glass-hover) px-3.5 pb-8 pt-3 text-faint shadow-[inset_0_0_0_1px_var(--glass-border)]">
            Ask a follow-up…
            <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full bg-(--color-heading) text-(--color-canvas) opacity-30">
              <ArrowUp size={15} />
            </span>
          </div>
          <p className="mt-2 px-1 text-[11px] text-faint">AI can make mistakes. Questions and the notes they need go to Google Gemini.</p>
        </div>
      </div>
    </div>
  );
}
