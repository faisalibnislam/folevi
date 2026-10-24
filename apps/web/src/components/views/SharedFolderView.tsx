"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { ChevronRight, FileText, FolderX, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { formatRelative } from "@/lib/format";
import { roleLabel, sharedPlace } from "@/lib/app/folderSharing";
import { FolderShareDialog } from "@/components/app/FolderShareDialog";

/**
 * /shared/<folderId>: a folder shared with this person, opened like a folder (docs/SHARING.md): the way up as
 * far as they can go, its subfolders and its notes, read only or editable by their role (each note opens
 * with the access the server gives it). Gone (revoked, deleted) reads as such.
 */
export function SharedFolderView({ folderId }: { folderId: string }) {
  const data = useQuery(api.folderSharing.open, { folderId });
  const [sharing, setSharing] = useState(false);
  const title = data?.folder.name || (data === null ? "Shared folder" : "");
  const facts = data ? [sharedPlace(data), data.roleLabel ?? (data.access === "write" || data.access === "manage" ? "Can edit" : data.access === "comment" ? "Can comment" : "Can view")].join(" · ") : undefined;
  return (
    <ViewChrome
      title={<h1 className="truncate text-sm font-semibold">{title}</h1>}
      subtitle={facts}
      tabTitle={title || "Shared folder"}
      iphone={{ title: title || "Shared folder", subtitle: facts }}
      actions={
        data ? (
          <Button size="sm" variant="quiet" onClick={() => setSharing(true)} aria-label="People with access">
            <Users size={14} aria-hidden /> People
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-3xl px-4 pb-[max(6rem,var(--fab-clearance))] pt-6 sm:px-8" data-testid="shared-folder">
        {data === undefined ? (
          <div className="mt-6 h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
        ) : data === null ? (
          <EmptyState icon={FolderX} title="You can’t open this folder" body="It may have been unshared, moved or deleted. Folders shared with you are in Shared with Me." />
        ) : (
          <>
            <nav aria-label="Folder path" className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted">
              <AppLink href="/shared" className="hover:text-heading">
                Shared with Me
              </AppLink>
              {data.path.map((p) => (
                <span key={p.id} className="flex items-center gap-1">
                  <ChevronRight size={12} aria-hidden />
                  <AppLink href={`/shared/${p.id}`} className="hover:text-heading">
                    {p.name || "Untitled"}
                  </AppLink>
                </span>
              ))}
              <ChevronRight size={12} aria-hidden />
              <span className="text-heading">{data.folder.name || "Untitled"}</span>
            </nav>
            {data.sharedBy ? (
              <p className="mb-4 text-xs text-muted">
                Shared with you by {data.sharedBy}
                {data.role ? ` (${roleLabel(data.role).toLowerCase()})` : ""}. Notes added to this folder later show up here too.
              </p>
            ) : null}
            {data.subfolders.length ? (
              <ul className="mb-6 grid gap-2 sm:grid-cols-2" aria-label="Folders">
                {data.subfolders.map((f) => (
                  <li key={f.id}>
                    <AppLink href={`/shared/${f.id}`} className="flex items-center gap-3 ui-card rounded-control px-3 py-2.5 hover:bg-surface">
                      <FolderGlyph color={f.color} size={20} />
                      <span className="min-w-0 flex-1 truncate font-medium">{f.name || "Untitled"}</span>
                      <span className="text-xs text-muted">{f.noteCount === 1 ? "1 note" : `${f.noteCount} notes`}</span>
                    </AppLink>
                  </li>
                ))}
              </ul>
            ) : null}
            {data.notes.length === 0 ? (
              data.subfolders.length ? null : <EmptyState icon={FileText} title="No notes here yet" body="Notes added to this folder show up here." />
            ) : (
              <ul className="divide-y divide-line overflow-hidden ui-card rounded-control" aria-label="Notes">
                {data.notes.map((d) => (
                  <li key={d.id}>
                    <AppLink href={`/d/${d.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                      <FileText size={16} className="mt-0.5 flex-none text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{d.title || "Untitled"}</span>
                        {d.excerpt ? <span className="block truncate text-sm text-muted">{d.excerpt}</span> : null}
                        <span className="block text-xs text-faint">
                          {d.access === "write" || d.access === "manage" ? "Can edit" : d.access === "comment" ? "Can comment" : "Can view"} · updated {formatRelative(d.updatedAt)}
                        </span>
                      </span>
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
            <FolderShareDialog open={sharing} onClose={() => setSharing(false)} folderId={data.folder.id} name={data.folder.name} />
          </>
        )}
      </div>
    </ViewChrome>
  );
}
