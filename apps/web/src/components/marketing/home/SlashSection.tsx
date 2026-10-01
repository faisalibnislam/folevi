import Link from "next/link";
import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckSquare,
  Heading1,
  ImageIcon,
  LayoutList,
  Mic,
  Network,
  PenTool,
  StickyNote,
  Table2,
} from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { artById, artThumb } from "../product/Replica";
import { Icon } from "../icons";
import { Kbd, SectionHeading, box, container, cx } from "../ui";

/*
 * What the "/" menu inserts. Labels are the slash menu's own (components/editor/EditorMenus.tsx,
 * slashItems), grouped here by what they're for. The picture is an HTML replica of the menu (ListMenu).
 */

/** What "/" adds, kept short: a few examples of each kind of block. */
const GROUPS: Array<{ title: string; items: string }> = [
  { title: "Write", items: "Headings, quotes, callouts, code" },
  { title: "Plan", items: "To-dos, lists, dates" },
  { title: "Organise", items: "Tables, collections, kanban, sub-pages" },
  { title: "Draw", items: "Flowcharts, whiteboards, formulas" },
  { title: "Add media", items: "Audio recordings, images, files" },
  { title: "Ask AI", items: "Summaries, outlines, action items" },
];

const MENU: Array<{ icon: ReactNode; label: string; hint?: string }> = [
  { icon: <Heading1 size={15} />, label: "Heading 1", hint: "#" },
  { icon: <CheckSquare size={15} />, label: "To-do", hint: "[]" },
  { icon: <StickyNote size={15} />, label: "Callout" },
  { icon: <Table2 size={15} />, label: "Table" },
  { icon: <Mic size={15} />, label: "Audio recording" },
  { icon: <Network size={15} />, label: "Flowchart" },
  { icon: <PenTool size={15} />, label: "Whiteboard" },
  { icon: <LayoutList size={15} />, label: "Collection" },
  { icon: <ImageIcon size={15} />, label: "Image" },
  { icon: <CalendarDays size={15} />, label: "Today’s date" },
  { icon: <AiIcon size={15} className="text-[#7c6cf0]" />, label: "Ask AI…", hint: "⌘J" },
];
const ACTIVE = MENU.findIndex((m) => m.label === "Audio recording");

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
            <Link href="/docs/blocks-and-slash-commands" className="mk-link mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px]">
              Blocks and slash commands <Icon name="arrow-right" size={15} />
            </Link>
          </div>
          <div className="mk-stage px-3 py-8 sm:px-10 sm:py-10" style={{ ["--stage-art" as string]: artThumb(artById("art-30")) }}>
            <SlashMenuPicture />
          </div>
        </div>
      </div>
    </section>
  );
}

function SlashMenuPicture() {
  return (
    <div
      role="img"
      aria-label={`A note with a slash typed on a new line and the block menu open under it: ${MENU.map((m) => m.label).join(", ")}. Audio recording is highlighted.`}
      className="mx-auto max-w-[340px]"
    >
      <div aria-hidden="true">
        <p className="px-1 text-[15px] text-ink">
          /
          <span className="ml-px inline-block h-[18px] w-px translate-y-[3px] animate-pulse bg-(--color-heading) motion-reduce:animate-none" />
        </p>
        <ul className="mk-app-pop mt-2 overflow-hidden rounded-[12px] p-1.5 text-[13.5px]">
          {MENU.map((item, i) => (
            <li
              key={item.label}
              className={cx(
                "flex items-center gap-2.5 rounded-[6px] px-2 py-1.5",
                i === ACTIVE ? "mk-app-row-on text-(--color-heading)" : "text-ink",
              )}
            >
              <span className="grid size-7 flex-none place-items-center rounded-[6px] bg-(--color-surface) text-(--color-heading) shadow-(--shadow-control)">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint ? <span className="text-[12px] text-faint">{item.hint}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
