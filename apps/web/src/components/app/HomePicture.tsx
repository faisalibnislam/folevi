"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, Folder, House } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { editedText, formatRelative } from "@/lib/format";
import { NOTE_CARD_LINK, NoteCardFace } from "@/components/views/DocumentCard";
import { FOLDER_CARD_BOX, FolderCardArt } from "@/components/views/FolderCardArt";

/** The layout's own size (16:10): laid out once, then scaled to the picture, so every card is whole at any size. */
const WIDTH = 960;
const HEIGHT = 600;
const COLUMNS = 4;

/**
 * Home's tab in Show All Tabs (the owner, 21 November 2026; the Mac's HomePicture draws the same): a "Recent notes"
 * row of note cards and a "Recent folders" row of folder cards, with breathing room between the rows. Only the
 * cards' faces, no links or menus: the picture sits inside the overview's button.
 */
/** `width`, `height` and `columns` lay it out for another shape (Show all tabs draws it in a note card's shape). */
export function HomePicture({ className = "", width = WIDTH, height = HEIGHT, columns = COLUMNS }: { className?: string; width?: number; height?: number; columns?: number }) {
  const { scope } = useAppState();
  const notes = useOfflineQuery(api.documents.recentNotes, { scope, limit: columns });
  const org = useOfflineQuery(api.organization.recentFolders, { scope, limit: columns });
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [width]);
  const rows = (notes ?? []).slice(0, columns);
  const folders = (org?.folders ?? []).slice(0, columns);

  return (
    <div ref={box} aria-hidden className={`relative overflow-hidden bg-[var(--color-canvas)] ${className}`}>
      {!rows.length && !folders.length ? (
        <div className="grid h-full w-full place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-container bg-[var(--glass-hover)] text-muted">
            <House size={24} />
          </span>
        </div>
      ) : scale > 0 ? (
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left p-6" style={{ width, height, transform: `scale(${scale})` }}>
          {rows.length ? (
            <>
              <Heading icon={<Clock3 size={18} />} title="Recent notes" />
              <div className="mb-8 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {rows.map((d) => (
                  <div key={d.id} className="relative [container-type:inline-size]">
                    <div className={NOTE_CARD_LINK}>
                      <NoteCardFace
                        title={d.title}
                        excerpt={d.excerpt}
                        preview={d.preview}
                        shape={d.shape}
                        kind={d.kind}
                        cover={d.cover}
                        style={d.style}
                        createdAt={d.createdAt}
                        time={editedText(d.updatedAt)}
                        starred={d.starred}
                        folder={d.homeFolder}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {folders.length ? (
            <>
              <Heading icon={<Folder size={18} />} title="Recent folders" />
              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {folders.map((f) => (
                  <div key={f.id} className={FOLDER_CARD_BOX}>
                    <div className="absolute inset-0">
                      <FolderCardArt name={f.name} color={f.color} count={f.documentCount} age={formatRelative(f.updatedAt)} previews={f.previews} subfolders={f.childCount ?? 0} subfolderColors={f.childColors} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Heading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-1.5">
      <span className="text-muted">{icon}</span>
      <span className="text-title-2 font-semibold text-heading">{title}</span>
    </div>
  );
}
