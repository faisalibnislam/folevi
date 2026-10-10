import Link from "next/link";
import type { ReactNode } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AI_LANGUAGES } from "@/components/ai/languages";
import { artById, artThumb } from "../product/Replica";
import { Icon } from "../icons";
import { AskDemo } from "../demos/AskDemo";
import { WriteDemo } from "../demos/WriteDemo";
import { FlowchartDemo } from "../demos/FlowchartDemo";
import { EditDemo } from "../demos/EditDemo";
import { CatchUpDemo } from "../demos/CatchUpDemo";
import { TitleDemo } from "../demos/TitleDemo";
import { Kbd, SectionHeading, box, container, cx } from "../ui";

/*
 * Foli, feature by feature. Every picture is an HTML replica of the app's own AI surfaces with
 * the app's labels: the Ask Foli chat (components/ai/AskAiChat.tsx), the ⌘J composer (ai/InlineAi.tsx) in its
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
              eyebrow="Foli"
              title="Ask, write and draw with your notes."
            />
          </div>
          <p className="mk-lede max-w-[52ch] lg:pb-1">
            Foli works where you write. Ask a question across your notes, rewrite a
            paragraph, turn a meeting into tasks or describe a process and get a flowchart. It only
            reads the notes you can open.
          </p>
        </div>

        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Ask Foli"
            title="Answers from your notes, with sources."
            art="art-49"
            picture={<AskDemo />}
            points={[
              <>
                Press <Kbd>⌘J</Kbd> anywhere outside a note, or pick <b>Ask Foli about your notes</b>{" "}
                in the <Kbd>⌘K</Kbd> palette.
              </>,
              <>Each answer lists the notes it used. Click a source to open it.</>,
              <>
                Ask follow-ups in the same chat. From a folder’s menu,{" "}
                <b>Ask Foli about this folder</b> keeps answers inside that folder.
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
            picture={<EditDemo />}
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
            picture={<CatchUpDemo />}
            title="Catch me up"
            body="On Home, one click writes a short brief of your week: what changed in your notes, and the tasks due next, with links to each note."
          />
          <SmallFeature
            art="art-01"
            picture={<TitleDemo />}
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
            Foli guide <Icon name="arrow-right" size={15} />
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
            className="mt-[9px] size-[5px] flex-none rounded-[4px] bg-(--color-ink-muted)"
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
