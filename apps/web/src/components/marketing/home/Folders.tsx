import Link from "next/link";
import { ArrowRight, FolderInput, House, Inbox, Palette } from "lucide-react";
import type { ReactNode } from "react";
import {
  FOLDERS_SCREENSHOT,
  MOVE_TO_FOLDER_SCREENSHOT,
  ThemedScreenshot,
} from "../product/Screenshot";
import { artById, artThumb } from "../product/Replica";
import { SectionHeading, container } from "../ui";

// What folders do in the app: components/app/Sidebar.tsx and FolderMenu.tsx, views/MoveToFolderDialog.tsx
// and views/HomeDashboard.tsx (Recent folders). /features/folders has the rest.
const points: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <Inbox size={16} aria-hidden="true" />,
    title: "Drafts until you file them",
    body: "A new note starts in Drafts, and the sidebar shows how many are there. Start one from a folder’s page and it goes into that folder.",
  },
  {
    icon: <FolderInput size={16} aria-hidden="true" />,
    title: "Move or drag",
    body: "Pick Move to folder from a note’s menu, or drag the note onto a folder in the sidebar. Select several notes to move them together.",
  },
  {
    icon: <Palette size={16} aria-hidden="true" />,
    title: "A colour for each folder",
    body: "New folders get a colour, and you can pick another from the folder’s menu. The colours come from the note styles.",
  },
  {
    icon: <House size={16} aria-hidden="true" />,
    title: "Recent folders on Home",
    body: "Home shows the folders with the latest edits. Each is drawn as a folder, with its newest notes showing through the cover.",
  },
];

export function Folders() {
  return (
    <section id="folders" aria-labelledby="folders-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={container}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <SectionHeading
            id="folders-title"
            eyebrow="Folders"
            title="File notes in folders when you’re ready."
          />
          <p className="mk-lede max-w-[52ch] lg:pb-1">
            Make a folder for each project, client or trip. Open one and its page shows every note
            inside, sorted by last edit, title or your own order. Notes you haven’t filed wait in
            Drafts.
          </p>
        </div>

        <div
          className="mk-stage mt-12 p-2 sm:p-6 lg:p-8"
          style={{ ["--stage-art" as string]: artThumb(artById("art-30")) }}
        >
          <div className="mk-shot">
            <ThemedScreenshot shot={FOLDERS_SCREENSHOT} />
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          <ul className="grid content-start gap-x-8 gap-y-8 sm:grid-cols-2">
            {points.map((point) => (
              <li key={point.title}>
                <span className="mk-tile">{point.icon}</span>
                <h3 className="mk-h3 mt-3.5 text-[15.5px]">{point.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
          <figure className="self-start">
            <div className="mk-shot">
              <ThemedScreenshot shot={MOVE_TO_FOLDER_SCREENSHOT} />
            </div>
            <figcaption className="mt-3 text-[13.5px] text-muted">
              Move to folder lists every folder in the space you’re in. Type to filter.
            </figcaption>
          </figure>
        </div>
        <Link
          href="/features/folders"
          className="mk-link mt-8 inline-flex min-h-11 items-center gap-1.5 text-[15px]"
        >
          More about folders <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
