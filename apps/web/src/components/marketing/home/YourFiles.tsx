import { Cloud, FileText, Folder, HardDrive, Sparkles, WifiOff, ArrowLeftRight } from "lucide-react";
import type { ReactNode } from "react";
import { SectionHeading, box, container, cx } from "../ui";
import { Mark, Sticker } from "../fun";

/*
 * The apps' free mode (Keep notes on my devices): the library is a folder of files in a place the person picks
 * (components/app/LibrarySetup.tsx placeOptions), never on Folevi's servers. The picture is a Finder-like window
 * of that folder in iCloud Drive.
 */

const PLACES: Array<{ icon: ReactNode; title: string; body: string }> = [
  { icon: <Cloud size={18} />, title: "iCloud Drive", body: "On every iPhone, iPad and Mac signed in to your iCloud account." },
  { icon: <Folder size={18} />, title: "Dropbox or Google Drive", body: "Folevi only uses its own folder there." },
  { icon: <Folder size={18} />, title: "Any folder", body: "Such as one in OneDrive, or one the Files app offers." },
  { icon: <HardDrive size={18} />, title: "Just this device", body: "Turn on sync later in Settings." },
];

const POINTS: Array<{ icon: ReactNode; title: string; body: string }> = [
  { icon: <WifiOff size={17} />, title: "Offline, always", body: "Everything is on your device first. Write on a plane and it syncs when you land." },
  { icon: <Sparkles size={17} />, title: "Private Foli AI", body: "On your Mac, Foli AI runs on Apple Intelligence or on your own key, straight from your Mac." },
  { icon: <ArrowLeftRight size={17} />, title: "Never stuck", body: "Sign in later to move your notes to Folevi Cloud, or export them back into a folder." },
];

const FILES = [
  { name: "Seed library", when: "Today, 9:41" },
  { name: "Trip sketch", when: "Yesterday" },
  { name: "Reading list", when: "Yesterday" },
  { name: "Studio move", when: "3 Nov" },
  { name: "Weekly reset", when: "1 Nov" },
];

function FolderPicture() {
  return (
    <div role="img" aria-label="A Finder window of the Folevi folder in iCloud Drive: one file for each note, such as Seed library and Trip sketch." className="mk-card overflow-hidden">
      <div aria-hidden="true">
        <div className="flex h-10 items-center gap-1.5 border-b mk-hair px-4">
          <span className="size-2.5 rounded-chip bg-[#ff5f57]" />
          <span className="size-2.5 rounded-chip bg-[#febc2e]" />
          <span className="size-2.5 rounded-chip bg-[#28c840]" />
          <span className="ml-3 flex items-center gap-1.5 text-[13px] font-semibold text-(--color-heading)">
            <Cloud size={14} className="text-muted" /> iCloud Drive <span className="font-normal text-muted">›</span> Folevi
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 px-4 py-2 text-[12px] text-muted">
          <span>Name</span>
          <span>Date modified</span>
        </div>
        <ul className="px-2 pb-3">
          {FILES.map((f, i) => (
            <li key={f.name} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 rounded-control px-2 py-1.5 text-[14px]", i === 0 && "bg-(--mk-violet-soft)")}>
              <span className="flex min-w-0 items-center gap-2 text-(--color-heading)">
                <FileText size={15} className="flex-none text-(--mk-violet-ink)" />
                <span className="truncate">{f.name}</span>
              </span>
              <span className="text-muted">{f.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function YourFiles() {
  return (
    <section id="your-files" aria-labelledby="files-title" className={cx(container, "scroll-mt-20")}>
      <div className={cx(box, "mk-tint relative overflow-hidden")}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              id="files-title"
              eyebrow="Your notes, your files"
              title={
                <>
                  Your notes are files, in a folder <Mark>you</Mark> pick.
                </>
              }
              lede="In the apps, your library is a folder of files in the cloud you already use. Each note is its own file, and Folevi’s servers never see them."
            />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {PLACES.map((p) => (
                <li key={p.title} className="mk-card flex gap-3 p-4">
                  <span className="mk-tile flex-none">{p.icon}</span>
                  <span>
                    <span className="block text-[15px] font-semibold text-(--color-heading)">{p.title}</span>
                    <span className="mt-0.5 block text-[14px] leading-snug text-muted">{p.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute -top-4 right-4 z-10">
              <Sticker tone="violet" rotate={-6} className="text-[14px]">
                Free forever. No account.
              </Sticker>
            </div>
            <FolderPicture />
          </div>
        </div>
        <ul className="mt-10 grid gap-6 border-t mk-hair pt-8 md:grid-cols-3">
          {POINTS.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="mt-0.5 flex-none text-(--mk-violet-ink)">{p.icon}</span>
              <span>
                <span className="block text-[16px] font-semibold text-(--color-heading)">{p.title}</span>
                <span className="mt-1 block text-[15px] leading-relaxed text-muted">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
