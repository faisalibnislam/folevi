import Link from "next/link";
import type { ReactNode } from "react";
import { ReturnDemo } from "../demos/ReturnDemo";
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
  /** Shown before the name when the chapters are a numbered series. */
  number?: string;
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
            {number ? <span className="tabular-nums">{number} · </span> : null}
            {name}
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

/** The home page's editor chapter: finding things again, with a working search and task list. */
export function Chapters() {
  return (
    <section id="chapters" aria-label="Writing in Folevi" className={cx(container, "mk-stack scroll-mt-20")}>
      <Chapter
        id="return"
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
