import Link from "next/link";
import { artById, artThumb } from "../product/Replica";
import { SlashDemo } from "./SlashDemo";
import { Icon } from "../icons";
import { Kbd, SectionHeading, box, container, cx } from "../ui";

/*
 * What the "/" menu inserts. Labels are the slash menu's own (components/editor/EditorMenus.tsx,
 * slashItems), grouped here by what they're for. The picture is an animated replica (SlashDemo).
 */

/** What "/" adds, kept short: a few examples of each kind of block. */
const GROUPS: Array<{ title: string; items: string }> = [
  { title: "Write", items: "Headings, quotes, callouts, code" },
  { title: "Plan", items: "To-dos, lists, dates" },
  { title: "Organise", items: "Tables, collections, kanban, sub-pages" },
  { title: "Draw", items: "Flowcharts, whiteboards, formulas" },
  { title: "Add media", items: "Audio recordings, images, files" },
  { title: "Ask Foli", items: "Summaries, outlines, action items" },
];

export function SlashSection() {
  return (
    <section id="slash" aria-labelledby="slash-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <SectionHeading id="slash-title" eyebrow="The / menu" title="Type / and pick what comes next." />
            <p className="mk-lede mt-5 max-w-[46ch]">
              On any line, type <Kbd>/</Kbd> and keep typing to filter, like <span className="font-medium text-ink">/rec</span> for a
              voice note. Press <Kbd>↵</Kbd> to add it.
            </p>
            <ul className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
              {GROUPS.map((group) => (
                <li key={group.title}>
                  <h3 className="mk-h3 text-[15px]">{group.title}</h3>
                  <p className="mt-1 text-[14px] leading-snug text-muted">{group.items}</p>
                </li>
              ))}
            </ul>
            <Link href="/features/blocks" className="mk-link mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px]">
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
