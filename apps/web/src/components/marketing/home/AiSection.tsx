import Link from "next/link";
import type { ReactNode } from "react";
import {
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
import { AiIcon } from "@/components/ai/AiIcon";
import { AI_LANGUAGES } from "@/components/ai/languages";
import { artById, artThumb, artVars } from "../product/Replica";
import { Icon } from "../icons";
import { AskDemo } from "../demos/AskDemo";
import { WriteDemo } from "../demos/WriteDemo";
import { FlowchartDemo } from "../demos/FlowchartDemo";
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

        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Ask AI"
            title="Answers from your notes, with sources."
            art="art-49"
            picture={<AskDemo />}
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
            tint
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
            picture={<WriteDemo />}
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
            tint
            eyebrow="Flowcharts with AI"
            title="Describe a process. Get a flowchart."
            art="art-42"
            picture={<FlowchartDemo />}
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

/** Some features sit in a panel tinted by the page's note style, so tinted and plain rows alternate. */
const TINTED = "mk-panel p-4 sm:p-8 lg:p-10";

function Feature({
  eyebrow,
  title,
  art,
  picture,
  points,
  children,
  reverse = false,
  stacked = false,
  tint = false,
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
  tint?: boolean;
}) {
  const tinted = tint ? TINTED : undefined;
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
      <div className={tinted}>
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
        tinted,
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

function SourceChip({ n, title }: { n: number; title: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-(--glass-hover) px-2.5 py-1 text-[12px] text-ink">
      <span className="font-semibold text-muted">{n}</span>
      <FileText size={12} className="text-muted" />
      {title}
    </span>
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
