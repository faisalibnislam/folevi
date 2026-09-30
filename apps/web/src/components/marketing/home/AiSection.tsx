import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CornerDownLeft,
  FileText,
  Languages,
  Lightbulb,
  Maximize2,
  Minimize2,
  PenLine,
  RotateCcw,
  SpellCheck,
  Wand2,
  X,
} from "lucide-react";
import { emptyFlowchart, serializeFlowchart } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { chartFromDraft, type FlowDraft } from "@/components/editor/flowchart/ops";
import { FlowchartStatic } from "@/components/editor/flowchart/render";
import "@/components/editor/flowchart/flowchart.css";
import { AI_LANGUAGES } from "@/components/ai/languages";
import { artById, artThumb, artVars } from "../product/Replica";
import { Icon } from "../icons";
import { Kbd, SectionHeading, box, container, cx } from "../ui";

/*
 * The AI Assistant, feature by feature. Every picture is an HTML replica of the app's own AI surfaces with
 * the app's labels: the Ask AI chat (components/ai/AskAiChat.tsx), the ⌘J composer (ai/InlineAi.tsx) in its
 * edit and result states, flowchart AI (editor/flowchart/FlowchartAi.tsx, with a chart drawn by the app's
 * own renderer from an AI-shaped draft), Catch me up (ai/CatchUp.tsx) and title AI (doc/TitleAi.tsx).
 */

export function AiSection() {
  return (
    <section id="ai" aria-labelledby="ai-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <div>
            <AiIcon size={32} />
            <SectionHeading
              className="mt-6"
              id="ai-title"
              eyebrow="AI Assistant"
              title="Ask, write and draw with your notes."
            />
          </div>
          <p className="mk-lede max-w-[52ch] lg:pb-1">
            The AI Assistant works where you write. Ask a question across your notes, rewrite a
            paragraph, turn a meeting into tasks or describe a process and get a flowchart. It only
            reads the notes you can open.
          </p>
        </div>

        <div className="mt-14 space-y-16 sm:space-y-20">
          <Feature
            eyebrow="Ask AI"
            title="Answers from your notes, with sources."
            art="art-49"
            picture={<AskPanel />}
            points={[
              <>
                Press <Kbd>⌘J</Kbd> anywhere outside a note, or pick <b>Ask AI about your notes</b>{" "}
                in the <Kbd>⌘K</Kbd> palette.
              </>,
              <>Each answer lists the notes it used. Click a source to open it.</>,
              <>
                Ask follow-ups in the same chat. From a folder’s menu,{" "}
                <b>Ask AI about this folder</b> keeps answers inside that folder.
              </>,
              <>If your notes don’t have the answer, it says so before giving a general one.</>,
            ]}
          >
            Try “What am I working on this week?” or “Which tasks are still open?”. Folevi searches
            your notes, reads the ones that match and writes an answer you can check.
          </Feature>

          <Feature
            reverse
            eyebrow="Edit with ⌘J"
            title="Select text and tell it what to change."
            art="art-16"
            picture={<EditPicture />}
            points={[
              <>
                Improve the writing, fix spelling, make it shorter, longer or simpler, or make it
                sound professional or casual.
              </>,
              <>
                Translate into {AI_LANGUAGES.length} languages, or ask it to explain or summarize
                the selection.
              </>,
              <>
                Or type your own instruction, like “turn this into a numbered list”. <b>Replace</b>{" "}
                swaps the text, and <b>Insert below</b> keeps both.
              </>,
            ]}
          >
            Select a sentence or a whole section and press <Kbd>⌘J</Kbd>, or use the AI button in
            the selection toolbar or a block’s handle menu.
          </Feature>

          <Feature
            eyebrow="Write with AI"
            title="Turn a messy page into next steps."
            art="art-03"
            picture={<WritePicture />}
            points={[
              <>
                <b>Continue writing</b> picks up where you stopped. <b>Summarize this note</b> and{" "}
                <b>Make an outline</b> sum up long pages.
              </>,
              <>
                <b>Find action items</b> writes real checkboxes, so they show up in Tasks with the
                rest of your to-dos.
              </>,
              <>
                <b>Brainstorm ideas</b> gives you a list to start from. Or type what you want, like
                “a friendly intro paragraph”.
              </>,
              <>
                Watch it write, press Stop at any time, then Insert, Try again or tweak it: Shorter,
                Longer, Simpler, More formal, More casual.
              </>,
            ]}
          >
            On an empty line, type <Kbd>/</Kbd> and pick an <b>AI</b> item, or press <Kbd>⌘J</Kbd>.
            It uses the note you’re in as context.
          </Feature>

          <Feature
            stacked
            eyebrow="Flowcharts with AI"
            title="Describe a process. Get a flowchart."
            art="art-42"
            picture={<FlowchartPicture />}
            points={[
              <>
                Write the steps, or a single sentence. Folevi draws the shapes, the decisions and
                the arrows, and lays them out.
              </>,
              <>
                Change it in words: “add an approval step after review” or “simplify it to the main
                steps”. <b>Start over</b> draws a new one.
              </>,
              <>
                Every shape stays editable. Drag, recolour and relabel it, and undo the whole AI
                change with <Kbd>⌘Z</Kbd>.
              </>,
            ]}
          >
            Insert a flowchart with <Kbd>/</Kbd> and click <b>Create with AI</b>, or the <b>AI</b>{" "}
            button on a chart you already have.
          </Feature>
        </div>

        <div className="mt-16 grid gap-6 sm:mt-20 lg:grid-cols-2">
          <SmallFeature
            art="art-30"
            picture={<CatchUpPicture />}
            title="Catch me up"
            body="On Home, one click writes a short brief of your week: what changed in your notes, and the tasks due next, with links to each note."
          />
          <SmallFeature
            art="art-01"
            picture={<TitlePicture />}
            title="Titles"
            body="Select words in a title for Edit with AI, or let Folevi suggest a title from what the note says. Untitled notes offer it on their own."
          />
        </div>

        <ul className="mt-14 grid gap-8 sm:grid-cols-3 sm:gap-10">
          <li>
            <h3 className="mk-h3 text-[15.5px]">Off when you want it off</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
              Turn the AI Assistant off in Settings and every AI button disappears. Core has no AI
              at all.
            </p>
          </li>
        </ul>

        <p className="mt-8 flex flex-wrap gap-x-8 gap-y-1 text-[15px]">
          <Link
            href="/features/ai-notes"
            className="mk-link inline-flex min-h-11 items-center gap-1.5"
          >
            More about AI notes <Icon name="arrow-right" size={15} />
          </Link>
          <Link
            href="/features/flowcharts"
            className="mk-link inline-flex min-h-11 items-center gap-1.5"
          >
            Flowcharts <Icon name="arrow-right" size={15} />
          </Link>
          <Link
            href="/docs/ai-assistant"
            className="mk-link inline-flex min-h-11 items-center gap-1.5"
          >
            AI Assistant guide <Icon name="arrow-right" size={15} />
          </Link>
        </p>
      </div>
    </section>
  );
}

/* Layout ------------------------------------------------------------------------------------------- */

function Feature({
  eyebrow,
  title,
  art,
  picture,
  points,
  children,
  reverse = false,
  stacked = false,
}: {
  eyebrow: string;
  title: string;
  /** The note style that lights the picture's stage. */
  art: string;
  picture: ReactNode;
  points: ReactNode[];
  children: ReactNode;
  reverse?: boolean;
  /** Text on top in two columns, and the picture below at full width. */
  stacked?: boolean;
}) {
  const stage = (
    <div
      className={cx("mk-stage px-3 py-8 sm:px-8 sm:py-10", reverse && "lg:order-1")}
      style={{ ["--stage-art" as string]: artThumb(artById(art)) }}
    >
      {picture}
    </div>
  );
  if (stacked) {
    return (
      <div>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="mk-caps">{eyebrow}</p>
            <h3 className="mk-display mt-3 max-w-[16ch] text-[28px] leading-[1.1] sm:text-[34px]">
              {title}
            </h3>
            <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed text-muted [&_b]:font-medium [&_b]:text-ink">
              {children}
            </p>
          </div>
          <Points points={points} className="lg:pt-8" />
        </div>
        <div className="mt-8">{stage}</div>
      </div>
    );
  }
  return (
    <div
      className={cx(
        "grid items-center gap-8 lg:gap-14",
        reverse
          ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
          : "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]",
      )}
    >
      <div className={cx("max-w-[460px]", reverse && "lg:order-2")}>
        <p className="mk-caps">{eyebrow}</p>
        <h3 className="mk-display mt-3 text-[28px] leading-[1.1] sm:text-[34px]">{title}</h3>
        <p className="mt-4 text-[16px] leading-relaxed text-muted [&_b]:font-medium [&_b]:text-ink">
          {children}
        </p>
        <Points points={points} className="mt-5" />
      </div>
      {stage}
    </div>
  );
}

function Points({ points, className }: { points: ReactNode[]; className?: string }) {
  return (
    <ul className={cx("space-y-3", className)}>
      {points.map((point, i) => (
        <li
          key={i}
          className="flex gap-3 text-[14.5px] leading-relaxed text-ink [&_b]:font-medium [&_b]:text-(--color-heading)"
        >
          <span
            aria-hidden="true"
            className="mt-[9px] size-[5px] flex-none rounded-full bg-(--color-ink-muted)"
          />
          <span>{point}</span>
        </li>
      ))}
    </ul>
  );
}

function SmallFeature({
  art,
  picture,
  title,
  body,
}: {
  art: string;
  picture: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div
        className="mk-stage flex min-h-[380px] items-center px-3 py-8 sm:px-8"
        style={{ ["--stage-art" as string]: artThumb(artById(art)) }}
      >
        {picture}
      </div>
      <h3 className="mk-h3 mt-5 text-[17px]">{title}</h3>
      <p className="mt-1.5 max-w-[48ch] text-[14.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/* Shared pieces of the AI popover ------------------------------------------------------------------ */

const AI_VIOLET = "text-[#7c6cf0]";

function AiFoot({
  children = "AI can make mistakes. Sent to Google Gemini.",
}: {
  children?: ReactNode;
}) {
  return (
    <p className="border-t border-(--color-line) px-3.5 py-1.5 text-[11px] text-faint">
      {children}
    </p>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-(--glass-hover) px-2.5 py-1 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)]">
      {children}
    </span>
  );
}

function SourceChip({ n, title }: { n: number; title: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-(--glass-hover) px-2.5 py-1 text-[12px] text-ink">
      <span className="font-semibold text-muted">{n}</span>
      <FileText size={12} className="text-muted" />
      {title}
    </span>
  );
}

/* Ask AI ------------------------------------------------------------------------------------------- */

/** A replica of the app's Ask AI chat, with one question and its answer. */
export function AskPanel() {
  return (
    <div
      role="img"
      aria-label="The Ask AI panel. Question: When is swap day, and what is left to do? The answer names the date and the two open tasks, and lists the two notes it used as sources."
      className="mk-app-pop mx-auto flex max-w-[420px] flex-col overflow-hidden rounded-[18px] text-[13.5px]"
    >
      <div aria-hidden="true">
        <div className="flex items-center gap-2.5 border-b border-(--color-line) px-4 py-3">
          <AiIcon size={20} />
          <p className="flex-1 text-[14.5px] font-semibold text-(--color-heading)">Ask AI</p>
          <span className="text-[12px] text-muted">New chat</span>
          <X size={16} className="text-muted" />
        </div>
        <div className="space-y-2 px-4 py-4">
          <p className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-(--color-heading) px-3.5 py-2 text-(--color-canvas)">
            When is swap day, and what’s left to do?
          </p>
          <div className="rounded-[14px] rounded-bl-[4px] bg-(--glass-active) px-4 py-3 leading-relaxed text-ink shadow-(--glass-edge)">
            <p>
              Swap day is the{" "}
              <strong className="font-semibold text-(--color-heading)">
                first Saturday in April
              </strong>{" "}
              [1]. Two tasks are still open: print the seed labels by Friday, and order glassine
              envelopes by Monday [2].
            </p>
            <div className="mt-3 border-t border-(--color-line) pt-2.5">
              <p className="mk-caps mb-1.5 text-[10.5px]">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                <SourceChip n={1} title="Seed library" />
                <SourceChip n={2} title="Thursday notes" />
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
          <p className="mt-2 px-1 text-[11px] text-faint">
            AI can make mistakes. Questions and the notes they need go to Google Gemini.
          </p>
        </div>
      </div>
    </div>
  );
}

/* Edit with ⌘J ------------------------------------------------------------------------------------- */

const EDIT_ROWS: Array<{ icon: ReactNode; label: string; more?: boolean }> = [
  { icon: <Wand2 size={15} />, label: "Improve writing" },
  { icon: <SpellCheck size={15} />, label: "Fix spelling & grammar" },
  { icon: <Minimize2 size={15} />, label: "Make shorter" },
  { icon: <Maximize2 size={15} />, label: "Make longer" },
  { icon: <BookOpen size={15} />, label: "Simplify language" },
  { icon: <PenLine size={15} />, label: "Sound professional" },
  { icon: <PenLine size={15} />, label: "Sound casual" },
  { icon: <Languages size={15} />, label: "Translate to…", more: true },
];

function EditPicture() {
  const selected =
    "the swap moved to the library hall because the café is closed for repairs, so everyone should bring their seeds there";
  return (
    <div
      role="img"
      aria-label="A note with a sentence selected and the AI composer open under it. It says Editing, then the selected text, and lists Improve writing, Fix spelling and grammar, Make shorter, Make longer, Simplify language, Sound professional, Sound casual and Translate to."
      className="mx-auto max-w-[480px]"
    >
      <div aria-hidden="true">
        <div
          className="mk-note rounded-[14px] px-5 pb-6 pt-5 text-[14px] leading-[1.65] shadow-(--glass-edge)"
          style={{ ...artVars(artById("art-16")), fontFamily: "var(--font-serif)" }}
        >
          <p className="mk-note-h text-[19px]">Swap day update</p>
          <p className="mt-2">
            Quick note for the group:{" "}
            <span className="rounded-[2px] bg-[color-mix(in_oklab,#7c6cf0_24%,transparent)]">
              {selected}
            </span>
            .
          </p>
        </div>
        <div className="mk-app-pop relative z-10 -mt-3 ml-4 overflow-hidden rounded-[14px] text-[13.5px] sm:ml-10">
          <p className="truncate border-b border-(--color-line) px-3.5 py-2 text-[12px] text-muted">
            <span className="font-semibold">Editing:</span> “{selected}”
          </p>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <AiIcon size={16} className={cx("flex-none", AI_VIOLET)} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-faint">
              Ask AI to edit the selected text…
            </span>
            <X size={15} className="flex-none text-muted" />
          </div>
          <ul className="border-t border-(--color-line) p-1.5">
            <li className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              Edit or review
            </li>
            {EDIT_ROWS.map((row, i) => (
              <li
                key={row.label}
                className={cx(
                  "flex items-center gap-2.5 rounded-[8px] px-2.5 py-[7px]",
                  i === 0 ? "bg-(--glass-hover) text-(--color-heading)" : "text-ink",
                )}
              >
                <span className="text-muted">{row.icon}</span>
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.more ? <ChevronRight size={14} className="text-faint" /> : null}
                {i === 0 ? <CornerDownLeft size={13} className="text-faint" /> : null}
              </li>
            ))}
          </ul>
          <AiFoot />
        </div>
      </div>
    </div>
  );
}

/* Write with AI ------------------------------------------------------------------------------------ */

const ACTION_ITEMS = [
  "Book the library hall for the 5th",
  "Print seed labels by Friday",
  "Order glassine envelopes",
  "Post the new time in the group chat",
];

function WritePicture() {
  return (
    <div
      role="img"
      aria-label="The AI composer after Find action items. It lists four new tasks as checkboxes, with the buttons Insert, Try again and Discard, and quick changes: Shorter, Longer, Simpler, More formal and More casual."
      className="mk-app-pop mx-auto max-w-[460px] overflow-hidden rounded-[14px] text-[13.5px]"
    >
      <div aria-hidden="true">
        <div className="border-b border-(--color-line) px-4 pb-3 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
            <AiIcon size={12} className={AI_VIOLET} /> Find action items
          </p>
          <ul className="space-y-2 text-[14px] text-ink">
            {ACTION_ITEMS.map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="mk-check" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <AiIcon size={16} className={cx("flex-none", AI_VIOLET)} />
          <span className="min-w-0 flex-1 truncate text-[14px] text-faint">
            Tell AI what to change… (⏎ to accept)
          </span>
          <X size={15} className="flex-none text-muted" />
        </div>
        <div className="space-y-2 border-t border-(--color-line) px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <span className="mk-btn mk-btn-primary h-8 gap-1.5 px-3">
              <CornerDownLeft size={14} /> Insert
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-ink">
              <RotateCcw size={13} /> Try again
            </span>
            <span className="ml-auto inline-flex h-8 items-center px-2.5 text-muted">Discard</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Shorter", "Longer", "Simpler", "More formal", "More casual"].map((r) => (
              <Chip key={r}>{r}</Chip>
            ))}
          </div>
        </div>
        <AiFoot />
      </div>
    </div>
  );
}

/* Flowcharts with AI ------------------------------------------------------------------------------- */

/** What the AI sends back for "Customer refund process": shapes, colours and connectors, no positions. */
const REFUND_DRAFT: FlowDraft = {
  direction: "TD",
  nodes: [
    { id: "start", shape: "terminator", text: "Refund requested", color: "accent" },
    { id: "check", shape: "process", text: "Check the order", color: "neutral" },
    { id: "days", shape: "decision", text: "Within 30 days?", color: "yellow" },
    { id: "refund", shape: "process", text: "Approve the refund", color: "green" },
    { id: "credit", shape: "process", text: "Offer store credit", color: "pink" },
    { id: "pay", shape: "io", text: "Send the money back", color: "blue" },
    { id: "done", shape: "terminator", text: "Email the customer", color: "neutral" },
  ],
  edges: [
    { from: "start", to: "check" },
    { from: "check", to: "days" },
    { from: "days", to: "refund", label: "Yes" },
    { from: "days", to: "credit", label: "No" },
    { from: "refund", to: "pay" },
    { from: "pay", to: "done" },
    { from: "credit", to: "done", style: "dashed" },
  ],
};

function FlowchartPicture() {
  const data = serializeFlowchart(chartFromDraft(REFUND_DRAFT, emptyFlowchart(), "create"));
  return (
    <div
      role="img"
      aria-label="A flowchart block with the AI panel open. The request reads: Customer refund process, refunds within 30 days, store credit after that. Below it, the chart the AI drew: Refund requested, Check the order, then a decision, Within 30 days? Yes leads to Approve the refund and Send the money back; No leads to Offer store credit. Both end at Email the customer."
      className="mx-auto max-w-[760px]"
    >
      <div aria-hidden="true" className="mk-card overflow-hidden">
        <div className="flex items-center gap-2 border-b mk-hair px-4 py-2.5 text-[12px] font-medium text-muted">
          <span className="rounded-[5px] bg-(--glass-hover) px-1.5 leading-5 text-ink">
            Flowchart
          </span>
          <span className="flex-1" />
          <span>Tidy up</span>
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-(--glass-hover) px-2 py-0.5 text-(--color-heading)">
            <AiIcon size={12} /> AI
          </span>
        </div>
        <div className="grid items-start md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="mk-app-pop m-3 overflow-hidden rounded-[12px] text-[13.5px] md:m-5">
            <div className="flex gap-1 px-2.5 pt-2 text-[12px] font-[550]">
              <span className="rounded-full px-2.5 py-1 text-muted">Update this chart</span>
              <span className="rounded-full bg-(--glass-hover) px-2.5 py-1 text-(--color-heading) shadow-[inset_0_0_0_1px_var(--glass-border)]">
                Start over
              </span>
            </div>
            <div className="flex items-start gap-2 p-2.5">
              <AiIcon size={15} className={cx("mt-[3px] flex-none", AI_VIOLET)} />
              <p className="min-w-0 flex-1 text-[14px] leading-[1.45] text-ink">
                Customer refund process: refunds within 30 days, store credit after that
              </p>
              <span className="grid size-7 flex-none place-items-center rounded-full bg-(--color-heading) text-(--color-canvas)">
                <ArrowUp size={15} />
              </span>
            </div>
            <ul className="border-t border-(--color-line) px-1.5 py-1.5 text-[13px] text-muted">
              {[
                "Add an approval step after review",
                "Add error handling to every step",
                "Simplify it to the main steps",
              ].map((idea) => (
                <li key={idea} className="rounded-[8px] px-2 py-1.5">
                  {idea}
                </li>
              ))}
            </ul>
            <AiFoot>AI can make mistakes. Sent to Google Gemini. Undo with ⌘Z.</AiFoot>
          </div>
          <div className="px-2 pb-5 md:pt-3 [&_.fc-static]:flex [&_.fc-static]:justify-center">
            <FlowchartStatic data={data} height={560} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* Catch me up -------------------------------------------------------------------------------------- */

function CatchUpPicture() {
  return (
    <div
      role="img"
      aria-label="The Catch me up brief on Home, titled Your week. This week: the swap moved to the library hall, and the trip is booked. Up next: print seed labels by Friday and book the ferry. Three notes are linked as sources."
      className="mx-auto w-full max-w-[420px]"
    >
      <div
        aria-hidden="true"
        className="mk-app-pop rounded-[16px] p-5 text-[13px] leading-relaxed text-ink"
      >
        <div className="mb-2 flex items-center gap-2">
          <AiIcon size={15} className={AI_VIOLET} />
          <p className="mk-display flex-1 text-[18px]">Your week</p>
          <RotateCcw size={14} className="text-muted" />
          <X size={15} className="ml-2 text-muted" />
        </div>
        <p className="mt-2 font-semibold text-(--color-heading)">This week</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Swap day moved to the library hall [1].</li>
          <li>The coast trip is booked for the 18th [2].</li>
        </ul>
        <p className="mt-2.5 font-semibold text-(--color-heading)">Up next</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Print seed labels, due Friday [1]</li>
          <li>Book the ferry, due Monday [3]</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <SourceChip n={1} title="Seed library" />
          <SourceChip n={2} title="Trip sketch" />
          <SourceChip n={3} title="Travel list" />
        </div>
      </div>
    </div>
  );
}

/* Titles ------------------------------------------------------------------------------------------- */

function TitlePicture() {
  return (
    <div
      role="img"
      aria-label="A note title with its words selected, and the title AI menu open under it: Suggest a new title from the note, Improve writing, Fix spelling and grammar, Make shorter."
      className="mx-auto w-full max-w-[400px]"
    >
      <div aria-hidden="true">
        <p className="mk-display text-[24px] text-(--color-heading)">
          <span className="rounded-[2px] bg-[color-mix(in_oklab,#7c6cf0_24%,transparent)]">
            notes from tuesdays call w/ ines
          </span>
        </p>
        <div className="mk-app-pop mt-2.5 overflow-hidden rounded-[14px] text-[13.5px]">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <AiIcon size={16} className={cx("flex-none", AI_VIOLET)} />
            <span className="min-w-0 flex-1 truncate text-faint">Ask AI to edit the title…</span>
          </div>
          <ul className="border-t border-(--color-line) p-1.5">
            {[
              { icon: <Lightbulb size={15} />, label: "Suggest a new title from the note" },
              { icon: <Wand2 size={15} />, label: "Improve writing" },
              { icon: <SpellCheck size={15} />, label: "Fix spelling & grammar" },
              { icon: <Minimize2 size={15} />, label: "Make shorter" },
            ].map((row, i) => (
              <li
                key={row.label}
                className={cx(
                  "flex items-center gap-2.5 rounded-[8px] px-2.5 py-[7px]",
                  i === 0 ? "bg-(--glass-hover) text-(--color-heading)" : "text-ink",
                )}
              >
                <span className="text-muted">{row.icon}</span>
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {i === 0 ? <Check size={13} className="text-faint" /> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
