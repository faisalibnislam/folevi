"use client";

// Home's list blocks (the owner, 28 November 2026, Home design version 14): Bookmarks (five bookmarked notes, each
// with its folder and when it was edited, and a thin bar in the folder's colour), and the optional Shared with me
// and Templates, drawn the same way.
import type { ReactNode } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useQuery, useQueryState } from "@/lib/convex/queries";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { useNotesWithLocal } from "@/lib/hooks/useLocalNotes";
import { editedText } from "@/lib/format";
import { folderHex } from "@/lib/folderColors";
import { useCreateDocument } from "@/components/app/useCreateDocument";

/** Notes a list block shows, at most. */
const LIST_COUNT = 5;

const ROW = "flex w-full items-stretch gap-2.5 py-2.5 text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-focus";

/** One row: a thin bar (a folder's colour, or the line colour), the name in the serif face, then a line under it. */
function RowFace({ title, meta, color }: { title: string; meta: string; color: string | null }) {
  return (
    <>
      <span aria-hidden className="w-[3px] flex-none rounded-tiny" style={{ background: color ?? "var(--color-line)" }} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-serif text-callout font-semibold text-heading">{title}</span>
        <span className="truncate text-footnote text-muted">{meta}</span>
      </span>
    </>
  );
}

function Rows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col [&>li]:border-b [&>li]:border-[var(--color-line)] [&>li:last-child]:border-b-0">
      {children}
    </ul>
  );
}

const quiet = (text: string) => <p className="text-subheadline text-muted">{text}</p>;

/** Bookmarks: the latest bookmarked notes, newest edit first. */
export function BookmarksList() {
  const { scope } = useAppState();
  const list = useOfflineQuery(api.documents.list, { scope, view: "starred", sort: "updated", paginationOpts: { numItems: LIST_COUNT, cursor: null } });
  const docs = useNotesWithLocal(list?.page, { include: "none" });
  if (docs === undefined) return quiet("Loading…");
  if (!docs.length) return quiet("Bookmark a note to keep it here.");
  return (
    <Rows label="Bookmarked notes">
      {docs.slice(0, LIST_COUNT).map((d) => (
        <li key={d.id}>
          <AppLink href={`/d/${d.id}`} title={d.title || "Untitled"} className={ROW}>
            <RowFace title={d.title || "Untitled"} meta={`${d.homeFolder ? d.homeFolder.name || "Folder" : "Drafts"} · edited ${editedText(d.updatedAt)}`} color={d.homeFolder ? folderHex(d.homeFolder.color) : null} />
          </AppLink>
        </li>
      ))}
    </Rows>
  );
}

/** Shared with me: the pages people shared with this person most recently (Shared with Me has the rest). */
export function SharedList() {
  const docs = useQueryState(api.sharing.sharedWithMe, {}).data;
  if (docs === undefined) return quiet("Loading…");
  if (!docs.length) return quiet("Nothing has been shared with you yet.");
  return (
    <Rows label="Shared with me">
      {docs.slice(0, LIST_COUNT).map((d) => (
        <li key={d.id}>
          <AppLink href={`/d/${d.id}`} title={d.title || "Untitled"} className={ROW}>
            <RowFace title={d.title || "Untitled"} meta={`${d.sharedBy} · edited ${editedText(d.updatedAt)}`} color={null} />
          </AppLink>
        </li>
      ))}
    </Rows>
  );
}

/** Templates: this person's own templates, then built-in ones; a click starts a note from it. */
export function TemplatesList() {
  const { scope } = useAppState();
  const own = useOfflineQuery(api.documents.list, { scope, view: "templates", sort: "updated", paginationOpts: { numItems: LIST_COUNT, cursor: null } });
  const builtIns = useQuery(api.settings.builtInTemplates, {});
  const createDocument = useCreateDocument();
  if (own === undefined || builtIns === undefined) return quiet("Loading…");
  const rows = [
    ...own.page.map((d) => ({ key: d.id, title: d.title || "Untitled", meta: "Your template", templateId: d.id })),
    ...builtIns.map((t) => ({ key: t.key, title: t.name, meta: t.description, templateId: t.key })),
  ].slice(0, LIST_COUNT);
  if (!rows.length) return quiet("Save any note as a template from its menu.");
  return (
    <Rows label="Templates">
      {rows.map((t) => (
        <li key={t.key}>
          <button type="button" aria-label={`New note from ${t.title}`} title={`New note from ${t.title}`} className={ROW} onClick={() => void createDocument({ title: t.title, templateId: t.templateId })}>
            <RowFace title={t.title} meta={t.meta} color={null} />
          </button>
        </li>
      ))}
    </Rows>
  );
}
