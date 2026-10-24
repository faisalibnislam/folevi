import Link from "next/link";
import type { ReactNode } from "react";
import { ReturnDemo } from "../demos/ReturnDemo";
import { artById, artThumb } from "../product/Replica";
import { Checks } from "../Checks";
import { Icon } from "../icons";
import { Eyebrow, Kbd, box, container, cx } from "../ui";
import { Hand, Mark } from "../fun";

function Chapter({
  id,
  number,
  name,
  art,
  title,
  lead,
  points,
  demo,
  more,
  reverse = false,
}: {
  id: string;
  /** Shown before the name when the chapters are a numbered series. */
  number?: string;
  name: string;
  /** The note theme that lights the stage, as a note's theme lights the app's canvas. */
  art: string;
  title: ReactNode;
  /** One short line under the title. */
  lead: ReactNode;
  /** Up to three checkmark lines. */
  points: ReactNode[];
  demo: ReactNode;
  /** The feature or docs page that explains this part of Folevi. */
  more: { label: string; href: string };
  reverse?: boolean;
}) {
  return (
    <article id={id} aria-labelledby={`${id}-title`} className={cx(box, "mk-tint relative scroll-mt-20")}>
      <div
        className={cx(
          "grid items-center gap-8 lg:gap-16",
          reverse ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]" : "lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]",
        )}
      >
        <div className={cx("max-w-[420px]", reverse && "lg:order-2")}>
          <Eyebrow>
            {number ? <span className="tabular-nums">{number} · </span> : null}
            {name}
          </Eyebrow>
          <h3 id={`${id}-title`} className="mk-h2 mt-5">
            {title}
          </h3>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">{lead}</p>
          <Checks className="mt-5" items={points} />
          <Link href={more.href} className="mk-link mt-5 inline-flex min-h-11 items-center gap-1.5 text-[15px]">
            {more.label} <Icon name="arrow-right" size={15} />
          </Link>
        </div>
        <div className={cx("mk-stage p-4 sm:p-8", reverse && "lg:order-1")} style={{ ["--stage-art" as string]: artThumb(artById(art)) }}>
          {demo}
        </div>
      </div>
    </article>
  );
}

/** The home page's editor chapter: finding things again, with a working search and task list. */
export function Chapters() {
  return (
    <section id="chapters" aria-label="Writing in Folevi" className={cx(container, "mk-stack relative scroll-mt-20")}>
      <div aria-hidden="true" className="pointer-events-none absolute bottom-16 right-16 z-10 hidden xl:block">
        <Hand rotate={-6} arrow="up-left">
          it really searches, try it
        </Hand>
      </div>
      <Chapter
        id="return"
        name="Return"
        art="art-41"
        title={
          <>
            Find it <Mark kind="squiggle">again</Mark>.
          </>
        }
        reverse
        lead={
          <>
            <Kbd>⌘K</Kbd> searches titles and text across your workspace.
          </>
        }
        points={[<>Tasks with a date collect in Today</>, <>The calendar shows the week ahead</>, <>Quick Add puts a new task in your Inbox</>]}
        demo={<ReturnDemo />}
        more={{ label: "Tasks in your notes", href: "/features/tasks" }}
      />
    </section>
  );
}
