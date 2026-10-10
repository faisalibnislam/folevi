import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, CloudOff, FileCode, FileText, Moon, Printer, Sun } from "lucide-react";
import { COVER_ART } from "@/lib/cover";
import { artById, artVars } from "../product/Replica";
import { container } from "../ui";

/*
 * What every plan includes, each with a small picture of it drawn from the app's own pieces (the sync status
 * pill, a note, the page menu's export items, the note themes, and light and dark mode). Pictures are decorative:
 * each is one image to assistive tech, described by its label. The labels are the app's own strings.
 */

type Tile = { title: string; body: ReactNode; link?: { label: string; href: string }; label: string; picture: ReactNode; wide?: boolean };

const TILES: Tile[] = [
  {
    title: "Works offline",
    body: "Write with no connection. Folevi keeps your changes on this device and syncs them when you reconnect.",
    link: { label: "Offline notes", href: "/features/offline-notes" },
    label: "A note with the sync status reading Offline, 3 changes waiting, then Saved once the connection is back.",
    picture: <OfflinePicture />,
  },
  {
    title: "Real-time sync",
    body: "Open a note on another device and your latest edits are already there. The status says Saved once the server has them.",
    link: { label: "Sync and offline", href: "/docs/sync-and-offline" },
    label: "The same note open on a laptop and a phone. A line typed on the laptop appears on the phone.",
    picture: <SyncPicture />,
  },
  {
    title: `${COVER_ART.length} note themes`,
    body: "Give each page a theme. The cover, the paper and the text take their colours from its artwork.",
    link: { label: "Note themes", href: "/features/note-themes" },
    label: "Five note theme artworks fanned out, and a note in the Summer sky theme.",
    picture: <StylesPicture />,
  },
  {
    title: "Markdown, HTML and PDF export",
    body: "Export a page from its ••• menu, or everything in a space as a ZIP of Markdown files from Settings.",
    link: { label: "Import and export", href: "/features/import-and-export" },
    label: "A page’s menu with Export as Markdown, Export as HTML and Export as PDF (print).",
    picture: <ExportPicture />,
    wide: true,
  },
  {
    title: "Light and dark mode",
    body: "Pick Light, Dark or System in Settings. Every note theme has colours for both.",
    label: "The same note in light mode and in dark mode, side by side.",
    picture: <ThemesPicture />,
    wide: true,
  },
];

export function Included() {
  return (
    <section aria-labelledby="included-title" className={container}>
      <div className="mk-box px-5 py-7 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
        <h2 id="included-title" className="mk-caps">
          Included in every plan
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:gap-5">
          {TILES.map((tile) => (
            <li key={tile.title} className={tile.wide ? "lg:col-span-3" : "lg:col-span-2"}>
              <div role="img" aria-label={tile.label} className="mk-mini-stage">
                <div aria-hidden="true" className="contents">
                  {tile.picture}
                </div>
              </div>
              <h3 className="mk-h3 mt-4 text-[15.5px]">{tile.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{tile.body}</p>
              {tile.link ? (
                <Link href={tile.link.href} className="mk-link mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px]">
                  {tile.link.label} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* Pictures ---------------------------------------------------------------------------------------- */

function MiniLines({ widths }: { widths: string[] }) {
  return (
    <span className="mt-2 block space-y-1.5">
      {widths.map((w, i) => (
        <span key={i} className="mk-mini-line block" style={{ width: w }} />
      ))}
    </span>
  );
}

/** The sync status pill (components/app/SyncStatus.tsx): Offline with changes waiting, then Saved. */
function OfflinePicture() {
  return (
    <div className="mk-mini-card w-[78%] max-w-[260px] px-4 pb-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-semibold text-(--color-heading)">Train notes</span>
        <span className="mk-mini-pills">
          <span className="mk-mini-pill mk-mini-pill-offline" data-step="1">
            <span className="size-1.5 flex-none rounded-tiny bg-(--color-ink-faint)" />
            <CloudOff size={12} />
            Offline <span className="tabular-nums">· 3</span>
          </span>
          <span className="mk-mini-pill" data-step="2">
            <span className="size-1.5 flex-none rounded-tiny bg-moss" />
            <Check size={12} className="text-moss-ink" />
            Saved
          </span>
        </span>
      </div>
      <MiniLines widths={["92%", "78%", "86%", "40%"]} />
    </div>
  );
}

/** One note open on a laptop and on a phone; the line typed on one appears on the other. */
function SyncPicture() {
  return (
    <div className="flex items-end gap-3">
      <div className="mk-mini-card w-[170px] overflow-hidden sm:w-[190px]">
        <div className="flex items-center gap-1 border-b border-(--color-line) px-2.5 py-1.5">
          <span className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
          <span className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
          <span className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
        </div>
        <div className="px-3 pb-3 pt-2">
          <span className="block text-[11.5px] font-semibold text-(--color-heading)">Seed library</span>
          <MiniLines widths={["90%", "70%"]} />
          <span className="mk-mini-typed mt-1.5 block text-[10.5px] text-ink">
            Print seed labels<span className="mk-mini-caret" />
          </span>
        </div>
      </div>
      <div className="mk-mini-card w-[74px] overflow-hidden rounded-panel px-2 pb-3 pt-3">
        <span className="mx-auto mb-2 block h-1 w-5 rounded-tiny bg-(--color-line-strong)" />
        <span className="block truncate text-[9.5px] font-semibold text-(--color-heading)">Seed library</span>
        <MiniLines widths={["92%", "68%"]} />
        <span className="mk-mini-arrive mt-1.5 block truncate rounded-chip text-[8.5px] text-ink">Print seed labels</span>
      </div>
    </div>
  );
}

const FAN = ["art-03", "art-01", "art-30", "art-49", "art-39"].map(artById);

/** A fan of note theme artworks, and a note wearing one of them. */
function StylesPicture() {
  const note = artById("art-30");
  return (
    <div className="relative h-[124px] w-[240px]">
      {FAN.map((art, i) => (
        <span
          key={art.id}
          className="mk-mini-art absolute top-2"
          style={{ left: `${i * 30}px`, backgroundImage: `url("/marketing/mini/${art.id}.webp")`, transform: `rotate(${(i - 2) * 5}deg)`, zIndex: i }}
        />
      ))}
      <span className="mk-note absolute bottom-0 right-0 z-10 w-[112px] overflow-hidden shadow-(--shadow-pop)" style={artVars(note)}>
        <span className="block h-7 bg-cover bg-center" style={{ backgroundImage: `url("/marketing/mini/${note.id}.webp")` }} />
        <span className="block px-2.5 pb-2.5 pt-1.5">
          <span className="mk-note-h block text-[11px]">Trip sketch</span>
          <span className="mt-1 block h-[3px] w-[85%] rounded-tiny bg-[color-mix(in_oklab,var(--n-ink)_22%,transparent)]" />
          <span className="mt-1 block h-[3px] w-[60%] rounded-tiny bg-[color-mix(in_oklab,var(--n-ink)_22%,transparent)]" />
        </span>
      </span>
    </div>
  );
}

/** The export items of a page's ••• menu (DocumentView), with the first one under the pointer. */
function ExportPicture() {
  const items = [
    { icon: <FileText size={13} />, label: "Export as Markdown" },
    { icon: <FileCode size={13} />, label: "Export as HTML" },
    { icon: <Printer size={13} />, label: "Export as PDF (print)" },
  ];
  return (
    <div className="flex items-center gap-4">
      <div className="mk-mini-card w-[112px] px-3 pb-3 pt-2.5 max-sm:hidden">
        <span className="block text-[11px] font-semibold text-(--color-heading)">Reading list</span>
        <MiniLines widths={["88%", "64%", "76%"]} />
      </div>
      <div className="mk-app-pop w-[210px] rounded-control p-1 text-[12px]">
        {items.map((item, i) => (
          <span key={item.label} className={`flex h-7 items-center gap-2 rounded-chip px-2 ${i === 0 ? "bg-(--glass-hover) text-(--color-heading)" : "text-ink"}`}>
            <span className="text-muted">{item.icon}</span>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The same note in the app's light and dark chrome. */
function ThemesPicture() {
  return (
    <div className="mk-mini-themes">
      {(["light", "dark"] as const).map((theme) => (
        <div key={theme} className="mk-mini-theme" data-mini-theme={theme}>
          <span className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold">Weekly review</span>
            {theme === "light" ? <Sun size={12} /> : <Moon size={12} />}
          </span>
          <span className="mt-2 block space-y-1.5">
            {["90%", "72%", "84%", "46%"].map((w, i) => (
              <span key={i} className="block h-[4px] rounded-tiny bg-current opacity-[0.16]" style={{ width: w }} />
            ))}
          </span>
          <span className="mt-2.5 flex items-center gap-1.5 text-[10px]">
            <span className="grid size-3 place-items-center rounded-tiny bg-current">
              <Check size={8} className="mk-mini-theme-check" strokeWidth={3} />
            </span>
            <span className="opacity-70">Book the ferry</span>
          </span>
        </div>
      ))}
    </div>
  );
}

