"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { formatRelative } from "@/lib/format";
import { FileText } from "lucide-react";

export function SharedView() {
  const docs = useQuery(api.sharing.sharedWithMe, {});
  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Shared with Me</h1>}
      subtitle={docs === undefined ? undefined : `${docs.length} ${docs.length === 1 ? "page" : "pages"} · from anyone`}
      tabTitle="Shared with Me"
    >
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-8">
        {docs === undefined ? (
          <div className="mt-6 h-24 animate-pulse rounded-[6px] bg-surface motion-reduce:animate-none" aria-busy />
        ) : docs.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="ui-display text-2xl text-muted">Nothing has been shared with you yet.</p>
            <p className="mt-2 text-sm text-muted">Pages people share with you directly, from their Personal or from any workspace, show up here.</p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden ui-card rounded-[8px]">
            {docs.map((d) => (
              <li key={d.id}>
                <AppLink href={`/d/${d.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                  <span className="text-xl" aria-hidden>
                    <FileText size={16} className="text-muted" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d.title || "Untitled"}</span>
                    <span className="block truncate text-sm text-muted">{d.excerpt}</span>
                    <span className="block text-xs text-faint">
                      Shared by {d.sharedBy} · {d.workspaceName ?? `Personal · ${d.ownerName ?? "someone"}`} · {d.role === "editor" ? "Can edit" : d.role === "commenter" ? "Can comment" : "Can view"} · updated {formatRelative(d.updatedAt)}
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
