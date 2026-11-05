"use client";

import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { AppLink } from "@/lib/app/router";

/** A step of the small path over a nested folder's name ("Folders › Work › Clients"). */
export interface PathStep {
  label: string;
  href: string;
}

/**
 * The title row of a folder's page and the Folders page (the owner, 6 November 2026): the page's name in the display
 * serif at a page title's size (a folder's with its colour mark), a quiet line of facts under it ("5 notes · edited
 * Oct 22"), and the page's actions at the right. A nested folder shows the way up above its name, each step a link.
 * It shares the content column's edges with the toolbar and the cards under it.
 */
export function ListPageHeader({ title, mark, info, path, actions }: { title: string; mark?: ReactNode; info?: ReactNode; path?: PathStep[]; actions?: ReactNode }) {
  return (
    <header data-page-header="" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
      {/* (On a narrow window the actions wrap under the name rather than squeeze it.) */}
      <div className="min-w-[min(100%,18rem)] flex-1">
        {path?.length ? (
          <nav aria-label="Breadcrumb" className="-ml-1.5 mb-1 flex min-w-0 items-center gap-0.5 text-footnote">
            {path.map((step, i) => (
              <Fragment key={step.href}>
                {i > 0 ? <ChevronRight size={12} className="flex-none text-faint" aria-hidden /> : null}
                <AppLink href={step.href} className="min-w-0 max-w-[12rem] truncate rounded-chip px-1.5 py-0.5 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
                  {step.label}
                </AppLink>
              </Fragment>
            ))}
            <ChevronRight size={12} className="flex-none text-faint" aria-hidden />
          </nav>
        ) : null}
        <div className="flex min-w-0 items-center gap-3">
          {mark}
          <h1 data-page-title="" className="ui-display min-w-0 truncate text-title-1">
            {title}
          </h1>
        </div>
        {info ? (
          <p role="status" data-page-info="" className="mt-1 min-w-0 truncate text-subheadline text-muted">
            {info}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The small caps heading over a section of a list page (Built-in templates, a folder's Folders). */
export const SECTION_LABEL = "mb-3 text-footnote font-semibold uppercase tracking-[0.06em] text-faint";
