import Link from "next/link";
import { ArrowRight, Clock, Folder } from "lucide-react";
import type { ReactNode } from "react";
import { COVER_ART } from "@/lib/cover";
import { DEMO_FOLDERS } from "../content/demoFolders";
import { DemoFolderCard } from "../product/FoldersPageReplica";
import { NoteCard, artById } from "../product/Replica";
import { SectionHeading, box, container, cx } from "../ui";

const CARDS = [
  { art: "art-03", title: "Seed library", folder: "Projects", lines: ["Swap day is the first Saturday in April.", "Print seed labels by Friday."] },
  { art: "art-30", title: "Trip sketch", folder: "Personal", lines: ["A long weekend on the coast.", "Book the ferry for Friday morning."] },
  { art: "art-01", title: "Reading list", folder: "Reading", lines: ["The Overstory, then Braiding Sweetgrass.", "Return the library copy by the 12th."] },
  { art: "art-39", title: "Studio move", folder: "Studio", lines: ["Boxes for the plan chest and the lamp.", "Keys from Ines on Friday morning."] },
];

const points = [
  { title: "Colours from the image", body: "On Auto, the page and text colours come from the style, and so do highlights, callouts and checkboxes." },
  { title: "Your own image", body: "Upload a picture as a note’s style and Folevi picks its page and text colours from it." },
  { title: "A pair for dark mode", body: "Every style has dark colours too, so a note reads the same way at night." },
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
          <SectionHeading id="styles-title" eyebrow="Note styles and folders" title="The app stays neutral. Your notes bring the colour." />
          <p className="mk-lede max-w-[52ch] lg:pb-1">
            Pick one of {COVER_ART.length} note styles for a page. The style sets the cover, the paper and the text colour, and
            the app around it stays white, or near-black when you switch the app to dark mode. File notes in folders when you’re ready, each folder in
            a colour of its own.
          </p>
        </div>

        <div className="mk-panel mt-12 p-4 sm:p-8">
          <PanelHeader icon={<Clock size={16} />} title="Recent notes" />
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Four sample notes, each in a different note style">
            {CARDS.map((card) => {
              const art = artById(card.art);
              return (
                <li key={card.title} aria-label={`${card.title}, in the ${art.name} style`} className="min-h-[216px]">
                  <NoteCard art={art} title={card.title} lines={card.lines} folder={card.folder} />
                </li>
              );
            })}
          </ul>

          <div className="mt-10 sm:mt-12">
            <PanelHeader icon={<Folder size={16} />} title="Folders" />
          </div>
          <ul
            className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 sm:gap-x-6 sm:gap-y-8"
            aria-label={`${FOLDERS.length} sample folders, each in its own colour, with their newest notes showing through the cover`}
          >
            {FOLDERS.map((folder, i) => (
              <li key={folder.name} aria-label={`${folder.name}, ${folder.notes.length} notes`} className={cx(i >= 2 && "hidden sm:block")}>
                <DemoFolderCard folder={folder} />
              </li>
            ))}
          </ul>
        </div>

        <ul className={cx("mt-10 grid gap-8 sm:grid-cols-3 sm:gap-10")}>
          {points.map((point) => (
            <li key={point.title}>
              <h3 className="mk-h3 text-[15.5px]">{point.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{point.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap gap-x-8">
          <Link href="/features/note-styles" className="mk-link inline-flex min-h-11 items-center gap-1.5 text-[15px]">
            More about note styles <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link href="/features/folders" className="mk-link inline-flex min-h-11 items-center gap-1.5 text-[15px]">
            More about folders <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
