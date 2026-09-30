import Link from "next/link";
import { ArrowRight, FolderInput, House, Inbox, Palette } from "lucide-react";
import type { ReactNode } from "react";
import { MoveToFolderReplica } from "../product/MoveToFolderReplica";
import { FOLDERS_SCREENSHOT, ThemedScreenshot } from "../product/Screenshot";
import { artById, artThumb } from "../product/Replica";
import { SectionHeading, container } from "../ui";

// What folders do in the app: components/app/Sidebar.tsx and FolderMenu.tsx, views/OrganizeIndex.tsx (the
// Folders page), views/MoveToFolderDialog.tsx and views/HomeDashboard.tsx (Recent folders). The screenshot
// is real (scripts/capture-folder-screenshots.ts); the Move to folder picture is an HTML replica.
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
    body: "Home shows the folders with the latest edits, drawn the same way as on the Folders page.",
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
            Make a folder for each project, client or trip. The Folders page shows every folder with
            its newest notes showing through the cover, and a folder’s own page lists every note
            inside. Notes you haven’t filed wait in Drafts.
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

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.55fr)] lg:gap-14">
          <figure>
            <MoveToFolderReplica className="h-[500px] sm:h-[600px]" />
            <figcaption className="mt-3 text-[13.5px] text-muted">
              Move to folder lists every folder in the space you’re in. Type to filter.
            </figcaption>
          </figure>
          <ul className="grid content-start gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-1">
            {points.map((point) => (
              <li key={point.title}>
                <span className="mk-tile">{point.icon}</span>
                <h3 className="mk-h3 mt-3.5 text-[15.5px]">{point.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
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
