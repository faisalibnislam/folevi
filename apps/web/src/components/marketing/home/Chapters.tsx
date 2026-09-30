import Link from "next/link";
import type { ReactNode } from "react";
import { CaptureDemo } from "../demos/CaptureDemo";
import { ConnectDemo } from "../demos/ConnectDemo";
import { ReturnDemo } from "../demos/ReturnDemo";
import { ShapeDemo } from "../demos/ShapeDemo";
import { artById, artThumb } from "../product/Replica";
import { Icon } from "../icons";
import { Kbd, box, container, cx } from "../ui";

function Chapter({
  id,
  number,
  name,
  art,
  title,
  children,
  hint,
  demo,
  more,
  reverse = false,
}: {
  id: string;
  number: string;
  name: string;
  /** The note style that lights the stage, as a note's style lights the app's canvas. */
  art: string;
  title: string;
  children: ReactNode;
  hint: ReactNode;
  demo: ReactNode;
  /** The feature or docs page that explains this part of Folevi. */
  more: { label: string; href: string };
  reverse?: boolean;
}) {
  return (
    <article id={id} aria-labelledby={`${id}-title`} className={cx(box, "scroll-mt-20")}>
      <div
        className={cx(
          "grid items-center gap-8 lg:gap-16",
          reverse ? "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]" : "lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]",
        )}
      >
        <div className={cx("max-w-[460px]", reverse && "lg:order-2")}>
          <p className="mk-caps">
            <span className="tabular-nums">{number}</span> · {name}
          </p>
          <h3 id={`${id}-title`} className="mk-display mt-3 text-[32px] leading-[1.08] sm:text-[40px]">
            {title}
          </h3>
          <div className="mt-4 space-y-3.5 text-[16.5px] leading-relaxed text-muted">{children}</div>
          <p className="mt-5 text-[13.5px] leading-[2.1] text-muted [&_kbd]:mx-0.5">{hint}</p>
          <Link href={more.href} className="mk-link mt-3 inline-flex min-h-11 items-center gap-1.5 text-[14.5px]">
            {more.label} <Icon name="arrow-right" size={15} />
          </Link>
        </div>
        <div className={cx("mk-stage p-3 sm:p-8", reverse && "lg:order-1")} style={{ ["--stage-art" as string]: artThumb(artById(art)) }}>
          {demo}
        </div>
      </div>
    </article>
  );
}

function TryIt() {
  return <span className="mr-1 font-semibold text-(--color-heading)">Try it:</span>;
}

export function Chapters() {
  return (
    <section id="chapters" aria-label="Writing in Folevi" className={cx(container, "mk-stack scroll-mt-20")}>
      <Chapter
        id="capture"
        number="01"
        name="Capture"
        art="art-13"
        title="Write first. File it later."
        hint={
          <>
            <TryIt /> type <Kbd>/</Kbd> then <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> and <Kbd>↵</Kbd>
          </>
        }
        demo={<CaptureDemo />}
        more={{ label: "Blocks and slash commands", href: "/docs/blocks-and-slash-commands" }}
      >
        <p>
          Every line is a block. Type <span className="font-medium text-ink">/</span> to turn the line into a heading, a
          checklist, a quote or a callout, without the mouse.
        </p>
        <p>New notes wait in Drafts until you move them into a folder.</p>
      </Chapter>

      <Chapter
        id="shape"
        number="02"
        name="Shape"
        art="art-50"
        title="Move blocks and nest them."
        reverse
        hint={
          <>
            <TryIt /> drag a handle, or select a line and press <Kbd>⌥⇧↑</Kbd> <Kbd>⌥⇧↓</Kbd> to move it, <Kbd>⌥⇧→</Kbd> to nest it
          </>
        }
        demo={<ShapeDemo />}
        more={{ label: "Keyboard shortcuts", href: "/docs/keyboard-shortcuts" }}
      >
        <p>Drag a block by its handle, or move it from the keyboard. Nest a block under another to turn a list into an outline.</p>
        <p>Nested blocks move with their parent, so the outline stays in one piece.</p>
      </Chapter>

      <Chapter
        id="connect"
        number="03"
        name="Connect"
        art="art-42"
        title="Link pages with two brackets."
        hint={
          <>
            <TryIt /> type <Kbd>[[</Kbd> and pick a page
          </>
        }
        demo={<ConnectDemo />}
        more={{ label: "Linked notes and backlinks", href: "/features/linked-notes" }}
      >
        <p>
          Type <span className="font-medium text-ink">[[</span> to link any page in your workspace. The page you link to lists a
          backlink, so you can follow the link from either end.
        </p>
        <p>Sub-pages sit inside their parent page and show as a link or a card.</p>
      </Chapter>

      <Chapter
        id="return"
        number="04"
        name="Return"
        art="art-41"
        title="Find it again."
        reverse
        hint={
          <>
            <TryIt /> search for <span className="font-medium text-ink">labels</span> or{" "}
            <span className="font-medium text-ink">printer</span>, then tick off a task
          </>
        }
        demo={<ReturnDemo />}
        more={{ label: "Tasks in your notes", href: "/features/tasks" }}
      >
        <p>
          <Kbd>⌘K</Kbd> searches titles and text across your workspace. Tasks with a date collect in Today, so the next step is
          there when you open Folevi.
        </p>
        <p>The calendar shows the rest of the week, and Quick Add puts a new task in your Inbox page.</p>
      </Chapter>
    </section>
  );
}
