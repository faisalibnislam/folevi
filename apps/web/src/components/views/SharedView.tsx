"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { formatRelative } from "@/lib/format";

export function SharedView() {
  const docs = useQuery(api.sharing.sharedWithMe, {});
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Shared with Me</h1>} tabTitle="Shared with Me">
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-8">
        <h2 className="ui-display text-[34px] leading-tight">Shared with Me</h2>
        <p className="text-sm text-muted">Pages people added you to directly, across all workspaces.</p>
        {docs === undefined ? (
          <div className="mt-6 h-24 animate-pulse rounded-[16px] bg-surface motion-reduce:animate-none" aria-busy />
        ) : docs.length === 0 ? (
          <p className="mt-10 text-center ui-display text-2xl text-muted">Nothing has been shared with you yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden ui-card rounded-[18px]">
            {docs.map((d) => (
              <li key={d.id}>
                <AppLink href={`/d/${d.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                  <span className="text-xl" aria-hidden>
                    {d.icon ?? "📄"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d.title || "Untitled"}</span>
                    <span className="block truncate text-sm text-muted">{d.excerpt}</span>
                    <span className="block text-xs text-faint">
                      Shared by {d.sharedBy} · {d.workspaceName} · {d.role === "editor" ? "Can edit" : d.role === "commenter" ? "Can comment" : "Can view"} · updated {formatRelative(d.updatedAt)}
                    </span>
                  </span>
                </AppLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ViewChrome>
  );
}
