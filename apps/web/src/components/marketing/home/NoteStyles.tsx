import Link from "next/link";
import { ArrowRight, Clock, Folder } from "lucide-react";
import type { ReactNode } from "react";
import { COVER_ART } from "@/lib/cover";
import { DEMO_FOLDERS } from "../content/demoFolders";
import { DemoFolderCard } from "../product/FoldersPageReplica";
import { NoteCard, artById } from "../product/Replica";
import { Checks } from "../Checks";
import { Play } from "../Play";
import { SectionHeading, box, container, cx } from "../ui";
import { Mark } from "../fun";

const CARDS = [
  { art: "art-03", title: "Seed library", folder: "Projects", lines: ["Swap day is the first Saturday in April.", "Print seed labels by Friday."] },
  { art: "art-30", title: "Trip sketch", folder: "Personal", lines: ["A long weekend on the coast.", "Book the ferry for Friday morning."] },
  { art: "art-01", title: "Reading list", folder: "Reading", lines: ["The Overstory, then Braiding Sweetgrass.", "Return the library copy by the 12th."] },
  { art: "art-39", title: "Studio move", folder: "Studio", lines: ["Boxes for the plan chest and the lamp.", "Keys from Ines on Friday morning."] },
];

/** The folders panel shows one row: the first four demo folders, in the sidebar's order; phones show two. */
const FOLDERS = DEMO_FOLDERS.slice(0, 4);

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      <span className="mk-tile">{icon}</span>
      <p className="mk-display flex-1 text-[22px] sm:text-[24px]">{title}</p>
      <span className="flex items-center gap-1 text-[13px] font-medium text-(--color-heading)">
        See all <ArrowRight size={14} />
      </span>
    </div>
  );
}

export function NoteStyles() {
  return (
    <section id="styles" aria-labelledby="styles-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <div className="relative">
            <SectionHeading
              id="styles-title"
              eyebrow="Note themes and folders"
              title={
                <>
                  Your notes bring the <Mark kind="squiggle">colour</Mark>.
                </>
              }
            />
          </div>
          <div className="lg:pb-1">
            <p className="mk-lede">{COVER_ART.length} note themes for your pages, and a colour for each folder.</p>
            <Checks
              className="mt-5"
              items={[<>On Auto, colours come from the theme</>, <>Use your own image as a theme</>, <>Dark colours for every theme</>]}
            />
          </div>
        </div>

        <div
          role="img"
          aria-label={`Recent notes and folders in the app: ${CARDS.length} notes, each in its own note theme (${CARDS.map((card) => artById(card.art).name).join(", ")}), and ${FOLDERS.length} folders, each in its own colour.`}
          className="mt-10"
        >
          <Play className="mk-panel p-4 sm:p-8">
            <div aria-hidden="true">
              <PanelHeader icon={<Clock size={16} />} title="Recent notes" />
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {CARDS.map((card) => (
                  <li key={card.title} data-step className="min-h-[216px]">
                    <NoteCard art={artById(card.art)} title={card.title} lines={card.lines} folder={card.folder} />
                  </li>
                ))}
              </ul>

              <div className="mt-10 sm:mt-12">
                <PanelHeader icon={<Folder size={16} />} title="Folders" />
              </div>
              <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 sm:gap-x-6 sm:gap-y-8">
                {FOLDERS.map((folder, i) => (
                  <li key={folder.name} data-step className={cx(i >= 2 && "hidden sm:block")}>
                    <DemoFolderCard folder={folder} />
                  </li>
                ))}
              </ul>
            </div>
          </Play>
        </div>

        <div className="mt-6 flex flex-wrap gap-x-8">
          <Link href="/features/note-themes" className="mk-link inline-flex min-h-11 items-center gap-1.5 text-[15px]">
            Note themes <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link href="/features/folders" className="mk-link inline-flex min-h-11 items-center gap-1.5 text-[15px]">
            Folders <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
