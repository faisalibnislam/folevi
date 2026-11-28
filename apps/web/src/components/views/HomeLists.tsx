"use client";

// Home's optional list sections (the owner, 28 November 2026, Home design version 16): Shared with me and Templates,
// in two columns of one-line rows like My tasks.
import type { ReactNode } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useQuery, useQueryState } from "@/lib/convex/queries";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { editedText } from "@/lib/format";
import { useCreateDocument } from "@/components/app/useCreateDocument";

/** Notes a list block shows, at most. */
const LIST_COUNT = 5;

const ROW = "flex min-h-11 w-full items-center gap-3 text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-focus";

/** One row: the name, then a short line at the right (as My tasks' due date). */
function RowFace({ title, meta }: { title: string; meta: string }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate text-subheadline text-ink">{title}</span>
      <span className="max-w-[45%] flex-none truncate text-footnote text-muted">{meta}</span>
    </>
  );
}

function Rows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="mt-1 grid grid-cols-1 gap-x-10 @[640px]:grid-cols-2 [&>li]:border-b [&>li]:border-[var(--color-line)]">
      {children}
    </ul>
  );
}

const quiet = (text: string) => <p className="pt-3 text-subheadline text-muted">{text}</p>;

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
            <RowFace title={d.title || "Untitled"} meta={`${d.sharedBy} · edited ${editedText(d.updatedAt)}`} />
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
            <RowFace title={t.title} meta={t.meta} />
          </button>
        </li>
      ))}
    </Rows>
  );
}
