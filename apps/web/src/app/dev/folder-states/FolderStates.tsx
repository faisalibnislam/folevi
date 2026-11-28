"use client";

import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, type DocumentCover } from "@folevi/editor-schema";
import type { PreviewLine } from "@/components/views/DocumentCard";
import { OfflineConvex } from "@/lib/convex/offline";
import {
  FOLDER_CARD_BOX,
  FOLDER_CARD_FRAME,
  FOLDER_CARD_MENU,
  FolderCardArt,
  FolderCardMenuLook,
  type FolderPreview,
} from "@/components/views/FolderCardArt";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { SUBFOLDER_NAME } from "@/components/views/FolderCard";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20);
const art = (n: number): DocumentCover => ({
  kind: "art",
  value: `art-${String(n).padStart(2, "0")}`,
});
const p = (t: string, x: string, extra: Partial<PreviewLine> = {}): PreviewLine => ({
  t,
  x,
  ...extra,
});
/** A note as a folder's preview carries it: drawn as that note's own card (NoteCardFace). */
const note = (
  title: string,
  days: number,
  preview: PreviewLine[],
  o: { cover?: DocumentCover; shape?: string } = {},
): FolderPreview => ({
  title,
  excerpt: preview.map((l) => l.x).join(" "),
  cover: o.cover ?? DEFAULT_COVER,
  createdAt: NOW - days * DAY,
  updatedAt: NOW - Math.max(0, days - 1) * DAY,
  style: DEFAULT_DOCUMENT_STYLE,
  preview,
  shape: o.shape ?? null,
  kind: "document",
});

const NOTES = [
  note(
    "Lisbon, day by day",
    12,
    [
      p("paragraph", "Day 1: Alfama on foot, tram 28 early before the crowds."),
      p("heading", "Day 2", { l: 2 }),
      p("paragraph", "Belem by the river."),
    ],
    { cover: art(3) },
  ),
  note(
    "Packing list",
    8,
    [
      p("todo", "Passport and boarding pass", { c: true }),
      p("todo", "Charger and adapter"),
      p("todo", "Earbuds"),
    ],
    { shape: "list" },
  ),
  note("Train times", 4, [
    p("paragraph", "Porto 08:39, Coimbra 10:52."),
    p("bulleted", "Seats in car 3"),
    p("bulleted", "By the window"),
  ]),
  note(
    "Hotels shortlist",
    2,
    [p("paragraph", "Casa Amora or Memmo Alfama."), p("paragraph", "Ask about a late check-out.")],
    { cover: art(7) },
  ),
  note("Receipts to find", 1, [
    p("bulleted", "Laptop"),
    p("bulleted", "Desk chair"),
    p("bulleted", "The March train tickets"),
  ]),
];

type State = {
  label: string;
  name: string;
  color: string;
  count: number;
  age: string;
  previews: FolderPreview[];
  subfolders?: number;
  subfolderColors?: string[];
  hover?: boolean;
};
const STATES: State[] = [
  {
    label: "0 notes",
    name: "Ideas for 2027",
    color: "plum",
    count: 0,
    age: "Nov 20",
    previews: [],
  },
  {
    label: "1 note",
    name: "Taxes 2026",
    color: "slate",
    count: 1,
    age: "Nov 14",
    previews: NOTES.slice(4),
    hover: true,
  },
  {
    label: "2 notes",
    name: "Reading",
    color: "sage",
    count: 2,
    age: "Nov 12",
    previews: NOTES.slice(3),
  },
  {
    label: "3 notes",
    name: "Recipes",
    color: "amber",
    count: 3,
    age: "Nov 9",
    previews: NOTES.slice(2),
  },
  {
    label: "4 notes",
    name: "Travel",
    color: "sky",
    count: 4,
    age: "Nov 18",
    previews: NOTES.slice(1),
  },
  { label: "5+ notes", name: "Work", color: "indigo", count: 24, age: "today", previews: NOTES },
  {
    label: "1 subfolder, 2 notes",
    name: "Project Atlas",
    color: "blue",
    count: 2,
    age: "today",
    previews: NOTES.slice(3),
    subfolders: 1,
    subfolderColors: ["teal"],
  },
  {
    label: "3 subfolders",
    name: "Clients",
    color: "coral",
    count: 0,
    age: "Nov 18",
    previews: [],
    subfolders: 3,
    subfolderColors: ["sky", "sage"],
  },
  {
    label: "2 subfolders, 12 notes",
    name: "Home",
    color: "rose",
    count: 12,
    age: "Nov 15",
    previews: NOTES,
    subfolders: 2,
    subfolderColors: ["green", "sand"],
  },
  {
    label: "Long name",
    name: "Quarterly planning and roadmap review for the whole team",
    color: "violet",
    count: 3,
    age: "2 days ago",
    previews: NOTES.slice(2),
  },
];

function Card({ s, width, labelScale }: { s: State; width: number; labelScale?: number }) {
  return (
    <figure className="grid gap-2" style={{ width }}>
      <div
        className={FOLDER_CARD_BOX}
        data-state={s.label}
        style={
          labelScale
            ? ({ "--fc-text": labelScale, "--fc-name": SUBFOLDER_NAME } as React.CSSProperties)
            : undefined
        }
      >
        <div className={FOLDER_CARD_FRAME}>
          <FolderCardArt
            name={s.name}
            color={s.color}
            count={s.count}
            age={s.age}
            previews={s.previews}
            subfolders={s.subfolders}
            subfolderColors={s.subfolderColors}
            menuRoom
            nameLines={labelScale ? 1 : undefined}
          />
        </div>
        <div className={`${FOLDER_CARD_MENU} ${s.hover ? "!opacity-100" : ""}`}>
          <FolderCardMenuLook />
        </div>
      </div>
      <figcaption className="text-center text-caption-1 text-muted">{s.label}</figcaption>
    </figure>
  );
}

export function FolderStates() {
  return (
    // The notes are the app's note cards, which ask Convex for an image cover: no server here.
    <OfflineConvex>
      <main className="min-h-screen space-y-10 bg-canvas p-10 text-heading">
        {[
          { title: "Web and Mac (Home, 25% smaller)", width: 176 },
          { title: "iPad (Home)", width: 234 },
          // As DocumentBrowser draws them: 143 px, with the labels of a 234 px card (SUBFOLDER_LABELS).
          { title: "Subfolders on a folder page (web and Mac)", width: 143, labelScale: 234 / 152 },
        ].map((g) => (
          <section key={g.title}>
            <h2 className="mb-4 text-headline font-semibold">{g.title}</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-8">
              {STATES.map((s) => (
                <Card
                  key={s.label}
                  s={s}
                  width={g.width}
                  labelScale={"labelScale" in g ? g.labelScale : undefined}
                />
              ))}
            </div>
          </section>
        ))}
        <section>
          <h2 className="mb-4 text-headline font-semibold">Sidebar glyph</h2>
          <div className="flex items-center gap-4">
            <FolderGlyph color="sky" size={15} />
            <FolderGlyph color="coral" size={15} kind="stack" />
            <FolderGlyph color="plum" size={15} kind="empty" />
            <FolderGlyph color="amber" size={24} />
            <FolderGlyph color="rose" size={24} kind="stack" />
          </div>
        </section>
      </main>
    </OfflineConvex>
  );
}
