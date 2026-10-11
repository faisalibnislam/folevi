import { ArrowUp, Check, FileText, Globe, Mic, RotateCcw, Undo2 } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { cx } from "../ui";

// Pictures for the Foli AI page, drawn with the app's own labels: the chat proposing changes to a note (the
// agent's result card), a "Think it through" result, the Study tab, a recording's meeting summary and a
// research report. Each is one image for assistive tech, described in its label.

/** The Foli AI panel's frame: a popover-like card with its title row. */
function Panel({ label, title, children, className }: { label: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cx("mk-app-pop mx-auto w-full max-w-[460px] overflow-hidden rounded-panel text-[13px]", className)}>
      <div aria-hidden="true">
        <div className="flex items-center gap-2 border-b border-(--color-line) px-4 py-3">
          <AiIcon size={15} />
          <p className="flex-1 text-[14px] font-semibold text-(--color-heading)">{title}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

const userBubble = "ml-auto max-w-[85%] rounded-control bg-(--color-heading) px-3 py-2 text-[12.5px] text-(--color-canvas)";

/** Ask in a note: "Tidy up the headings" → the agent's proposed changes, with Approve and Undo. */
export function ChangesPicture() {
  const rows = [
    { before: "Section #4: Approach", after: "Section 4: Approach" },
    { before: "Section #5: Problems we've hel...", after: "Section 7: Problems we've helped solve" },
    { before: "Section #7: Inight/Blog", after: "Section 9: Insights / Blog" },
  ];
  return (
    <Panel
      title="Foli AI"
      label="The Foli AI panel in a note. The person asked: the section numbers are messed up, please fix. Foli AI proposes three changes to the note's own headings, shown as before and after: Section #4 becomes Section 4, a duplicate section 5 becomes Section 7, and Inight/Blog becomes Section 9: Insights / Blog. Approve and Discard buttons sit under the changes."
    >
      <div className="space-y-3 p-2">
        <p className={userBubble}>The section numbers are all messed up. Please fix.</p>
        <div className="rounded-control bg-(--glass-hover) p-3">
          <p className="text-[12.5px] leading-relaxed text-ink">I renumbered the sections and fixed two headings. These changes need your approval.</p>
          <div className="mt-3 rounded-small bg-(--color-surface) p-2.5 shadow-(--shadow-control)">
            <p className="mk-caps text-[10.5px]">Proposed changes</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-(--color-heading)">
              <FileText size={13} className="text-muted" /> Edit “Website ideas” (3 changes)
            </p>
            <ul className="mt-2 space-y-1.5 text-[12px]">
              {rows.map((r) => (
                <li key={r.after} className="rounded-tiny bg-(--color-surface-sunken) px-2 py-1.5">
                  <span className="block text-muted line-through decoration-[color-mix(in_oklab,var(--color-danger)_70%,transparent)]">{r.before}</span>
                  <span className="block font-medium text-(--color-heading)">{r.after}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex gap-1.5">
              <span className="mk-btn mk-btn-primary h-8 gap-1 px-3 text-[12px]">
                <Check size={13} /> Approve
              </span>
              <span className="mk-btn mk-btn-secondary h-8 px-3 text-[12px]">Discard</span>
              <span className="ml-auto flex items-center gap-1 text-[11.5px] text-muted">
                <Undo2 size={12} /> One Undo
              </span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** A decision matrix from "Think it through": options scored against what matters, totals worked out. */
export function ThinkPicture() {
  const rows: [string, number, number, number, string][] = [
    ["Self-hosted", 3, 2, 4, "2.9"],
    ["Managed", 4, 4, 3, "3.7"],
    ["Hybrid", 3, 3, 3, "3.0"],
  ];
  return (
    <Panel
      title="Decision matrix"
      label="A decision matrix Foli AI made from a note: three options (self-hosted, managed and hybrid) scored from 1 to 5 against cost, speed and control, with weighted totals. Managed scores highest at 3.7. Below it, the other frameworks: pros and cons, SWOT, risks, pre-mortem, mind map, how might we, SCAMPER and six thinking hats."
    >
      <div className="p-4">
        <table className="w-full text-left text-[12px]">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Option</th>
              <th className="py-1 text-center font-medium">Cost ×2</th>
              <th className="py-1 text-center font-medium">Speed</th>
              <th className="py-1 text-center font-medium">Control</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {rows.map(([name, a, b, c, total]) => (
              <tr key={name} className="border-t border-(--color-line)">
                <td className="py-1.5 font-medium text-(--color-heading)">{name}</td>
                <td className="py-1.5 text-center tabular-nums">{a}</td>
                <td className="py-1.5 text-center tabular-nums">{b}</td>
                <td className="py-1.5 text-center tabular-nums">{c}</td>
                <td className={cx("py-1.5 text-right tabular-nums", total === "3.7" && "font-semibold text-(--color-heading)")}>{total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {["Pros and cons", "SWOT", "Risks", "Pre-mortem", "Mind map", "How might we", "SCAMPER", "Six hats"].map((f) => (
            <span key={f} className="rounded-chip bg-(--glass-hover) px-2 py-0.5 text-[11.5px] text-ink">
              {f}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/** The Study tab: a flashcard Foli AI made from the note, flipped, with Know it and Again. */
export function StudyPicture() {
  return (
    <Panel
      title="Study"
      label="The Study tab of the Foli AI panel: flashcard 3 of 12 from a biology note, showing the question 'What does the mitochondria do?' and its answer, 'It turns food into energy the cell can use (ATP).' Below are Again and Know it buttons and a progress bar."
    >
      <div className="p-4">
        <div className="flex items-center justify-between text-[11.5px] text-muted">
          <span>Flashcards · 3 of 12</span>
          <span>Quiz</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-tiny bg-(--color-surface-sunken)">
          <div className="h-full w-1/4 rounded-tiny bg-(--color-heading)" />
        </div>
        <div className="mt-4 rounded-control bg-(--color-surface) p-4 shadow-(--shadow-control)">
          <p className="mk-display text-[17px] leading-snug text-(--color-heading)">What does the mitochondria do?</p>
          <p className="mt-3 border-t border-(--color-line) pt-3 text-[13px] leading-relaxed text-ink">It turns food into energy the cell can use (ATP).</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="mk-btn mk-btn-secondary h-9 gap-1.5 text-[12.5px]">
            <RotateCcw size={13} /> Again
          </span>
          <span className="mk-btn mk-btn-primary h-9 gap-1.5 text-[12.5px]">
            <Check size={13} /> Know it
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** A recording, transcribed, and its meeting summary with owners and dates. */
export function MeetingPicture() {
  return (
    <Panel
      title="Meeting summary"
      label="A recording in a note, transcribed by Foli AI, and the meeting summary made from it: decisions, then action items as to-dos with owners and due dates, like '@Maya: send the venue shortlist (due 14 October)'."
    >
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2.5 rounded-control bg-(--color-surface-sunken) px-3 py-2">
          <span className="grid size-7 place-items-center rounded-chip bg-(--color-heading) text-(--color-canvas)">
            <Mic size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-(--color-heading)">Planning call.webm</p>
            <p className="text-[11px] text-muted">18:42 · Transcribed</p>
          </div>
        </div>
        <div>
          <p className="mk-caps text-[10.5px]">Decisions</p>
          <p className="mt-1 text-[12.5px] text-ink">Hold the launch event in Lisbon, the first week of November.</p>
        </div>
        <div>
          <p className="mk-caps text-[10.5px]">Action items</p>
          <ul className="mt-1.5 space-y-1.5 text-[12.5px] text-ink">
            {[
              ["Maya", "send the venue shortlist", "14 Oct"],
              ["Ines", "draft the invite list", "16 Oct"],
              ["Sam", "book the photographer", "20 Oct"],
            ].map(([who, what, when]) => (
              <li key={who} className="flex items-start gap-2">
                <span className="mt-[3px] size-[13px] flex-none rounded-tiny shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
                <span className="min-w-0 flex-1">
                  <span className="rounded-tiny bg-(--color-accent-soft) px-1 font-medium text-(--color-heading)">@{who}</span> {what}
                </span>
                <span className="flex-none text-[11px] text-muted">{when}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

/** A research report: steps, then the report with numbered web sources and Save as note. */
export function ResearchPicture() {
  return (
    <Panel
      title="Research"
      label="A Foli AI research report on heat pumps versus gas boilers. Steps show it searched the web and read six pages and two of the person's notes. The report has numbered sources from the web and the notes, and a Save as note button."
    >
      <div className="space-y-3 p-4">
        <p className={userBubble}>How do heat pumps compare with gas boilers?</p>
        <ul className="space-y-1 text-[11.5px] text-muted">
          <li className="flex items-center gap-1.5">
            <Check size={12} /> Searched the web (3 searches)
          </li>
          <li className="flex items-center gap-1.5">
            <Check size={12} /> Read 6 pages and 2 of your notes
          </li>
        </ul>
        <div className="rounded-control bg-(--glass-hover) p-3 text-[12.5px] leading-relaxed text-ink">
          <p className="font-semibold text-(--color-heading)">Running costs</p>
          <p className="mt-1">
            A heat pump uses about a third of the energy for the same heat <sup className="text-muted">[1]</sup>, so it costs less to run where electricity isn’t much dearer than gas <sup className="text-muted">[2]</sup>.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-chip bg-(--color-surface) px-1.5 py-0.5 shadow-(--shadow-control)">
              <Globe size={11} /> 1 energysavingtrust.org.uk
            </span>
            <span className="inline-flex items-center gap-1 rounded-chip bg-(--color-surface) px-1.5 py-0.5 shadow-(--shadow-control)">
              <FileText size={11} /> 2 House costs 2026
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="mk-btn mk-btn-secondary h-8 px-3 text-[12px]">Save as note</span>
          <span className="ml-auto grid size-8 place-items-center rounded-control bg-(--color-heading) text-(--color-canvas) opacity-40">
            <ArrowUp size={14} />
          </span>
        </div>
      </div>
    </Panel>
  );
}
