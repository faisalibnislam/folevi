import Link from "next/link";
import { artById, artThumb } from "../product/Replica";
import { SlashDemo } from "./SlashDemo";
import { Checks } from "../Checks";
import { Icon } from "../icons";
import { Kbd, SectionHeading, box, container, cx } from "../ui";

/*
 * What the "/" menu inserts, in three short lines. Labels are the slash menu's own
 * (components/editor/EditorMenus.tsx, slashItems). The picture is an animated replica (SlashDemo).
 */

export function SlashSection() {
  return (
    <section id="slash" aria-labelledby="slash-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <SectionHeading id="slash-title" eyebrow="The / menu" title="Type / and pick what comes next." />
            <p className="mk-lede mt-5 max-w-[46ch]">
              On any line, type <Kbd>/</Kbd> and a few letters to filter.
            </p>
            <Checks
              className="mt-6"
              items={[<>Headings, to-dos, tables and kanban</>, <>Flowcharts, whiteboards, audio and images</>, <>Foli AI summaries and action items</>]}
            />
            <Link href="/features/blocks" className="mk-link mt-5 inline-flex min-h-11 items-center gap-1.5 text-[15px]">
              Blocks and the / menu <Icon name="arrow-right" size={15} />
            </Link>
          </div>
          <div className="mk-stage px-3 py-8 sm:px-10 sm:py-10" style={{ ["--stage-art" as string]: artThumb(artById("art-30")) }}>
            <SlashDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
