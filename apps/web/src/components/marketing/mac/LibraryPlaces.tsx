import { Cloud, Folder, HardDrive } from "lucide-react";
import { cx } from "../ui";

/*
 * The apps' "Keep notes on my devices" mode: where a library with no account can live. The titles are the
 * apps' own (components/app/LibrarySetup.tsx placeOptions, native-kit WebGates.swift detail), shortened for
 * the site. A picture, not a control: one image for assistive tech, with the places in its label.
 */

export const LIBRARY_PLACES: Array<{ kind: "icloud" | "dropbox" | "gdrive" | "folder" | "device"; title: string; detail: string }> = [
  { kind: "icloud", title: "Sync with iCloud", detail: "A Folevi folder in iCloud Drive, on your iPhone, iPad and Mac." },
  { kind: "dropbox", title: "Sync with Dropbox", detail: "Folevi only uses its own folder, Apps › Folevi." },
  { kind: "gdrive", title: "Sync with Google Drive", detail: "Folevi only sees the files it makes." },
  { kind: "folder", title: "Choose a folder", detail: "Any folder, such as one OneDrive keeps in sync." },
  { kind: "device", title: "This device only", detail: "Turn on sync later in Settings." },
];

const ICONS = { icloud: Cloud, dropbox: Cloud, gdrive: Cloud, folder: Folder, device: HardDrive } as const;

/** "Where should your library live?", the step the apps show after "Keep notes on my devices". */
export function LibraryPlaces({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      role="img"
      aria-label="Folevi asks where your library should live: iCloud, Dropbox, Google Drive, a folder you choose, or this device only."
      className={cx("mk-app-pop rounded-panel p-4 text-ink sm:p-5", className)}
    >
      <div aria-hidden="true">
        <p className="text-[15px] font-semibold text-(--color-heading)">Where should your library live?</p>
        <p className="mt-1 text-[13px] text-muted">Folevi’s servers never see these notes.</p>
        <ul className="mt-4 space-y-2">
          {LIBRARY_PLACES.map((place, index) => {
            const PlaceIcon = ICONS[place.kind];
            return (
              <li
                key={place.kind}
                className={cx(
                  "flex items-start gap-3 rounded-control px-3 py-2.5",
                  index === 0 ? "bg-(--mk-violet-soft)" : "bg-(--color-surface-sunken)",
                )}
              >
                <PlaceIcon size={18} strokeWidth={1.6} className="mt-0.5 flex-none text-(--color-heading)" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-(--color-heading)">{place.title}</span>
                  {compact ? null : <span className="mt-0.5 block text-[13px] leading-snug text-muted">{place.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
