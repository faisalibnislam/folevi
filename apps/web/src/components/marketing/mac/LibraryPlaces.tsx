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

type PlaceKind = (typeof LIBRARY_PLACES)[number]["kind"];
const SPOKEN: Record<PlaceKind, string> = { icloud: "iCloud", dropbox: "Dropbox", gdrive: "Google Drive", folder: "a folder you choose", device: "this device only" };

/**
 * "Where should your library live?", the step the apps show after "Keep notes on my devices". `kinds` keeps only
 * the places an app offers (Windows and Linux: a folder or this device), `details` rewords a place for that app.
 */
export function LibraryPlaces({
  className,
  compact = false,
  kinds,
  details,
}: {
  className?: string;
  compact?: boolean;
  kinds?: PlaceKind[];
  details?: Partial<Record<PlaceKind, string>>;
}) {
  const places = LIBRARY_PLACES.filter((place) => !kinds || kinds.includes(place.kind)).map((place) => ({ ...place, detail: details?.[place.kind] ?? place.detail }));
  const spoken = places.map((place) => SPOKEN[place.kind]);
  const list = spoken.length > 2 ? `${spoken.slice(0, -1).join(", ")}, or ${spoken.at(-1)}` : spoken.join(" or ");
  return (
    <div
      role="img"
      aria-label={`Folevi asks where your library should live: ${list}.`}
      className={cx("mk-app-pop rounded-panel p-4 text-ink sm:p-5", className)}
    >
      <div aria-hidden="true">
        <p className="text-[15px] font-semibold text-(--color-heading)">Where should your library live?</p>
        <p className="mt-1 text-[13px] text-muted">Folevi’s servers never see these notes.</p>
        <ul className="mt-4 space-y-2">
          {places.map((place, index) => {
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
