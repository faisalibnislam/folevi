"use client";

import { useQuery } from "convex/react";
import { SharedVaultItems, useSharedVaultCount } from "@/components/vault/SharedVaultItems";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { formatRelative } from "@/lib/format";
import { FileText, Share2 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { roleLabel, sharedPlace } from "@/lib/app/folderSharing";

/** Shared with Me: folders shared with this person (docs/SHARING.md), then pages shared with them one by one. */
export function SharedView() {
  const docs = useQuery(api.sharing.sharedWithMe, {});
  const folders = useQuery(api.folderSharing.sharedFolders, {});
  const vaultItems = useSharedVaultCount() ?? 0;
  const loading = docs === undefined || folders === undefined;
  const counts = loading
    ? undefined
    : [
        folders.length ? `${folders.length} ${folders.length === 1 ? "folder" : "folders"}` : null,
        docs.length || (!folders.length && !vaultItems) ? `${docs.length} ${docs.length === 1 ? "page" : "pages"}` : null,
        vaultItems ? `${vaultItems} from Vaults` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <ViewChrome
      title={<h1 className="text-subheadline font-semibold">Shared with Me</h1>}
      subtitle={counts === undefined ? undefined : `${counts} · from anyone`}
      tabTitle="Shared with Me"
      iphone={{ title: "Shared with Me", subtitle: !loading && (docs.length || folders.length || vaultItems) ? counts : undefined }}
    >
      <div className="mx-auto max-w-3xl px-4 pb-[max(6rem,var(--fab-clearance))] pt-6 sm:px-8">
        {loading ? (
          <div className="mt-6 h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
        ) : docs.length === 0 && folders.length === 0 && !vaultItems ? (
          <EmptyState icon={Share2} title="Nothing has been shared with you yet" body="Folders and pages people share with you, from their Personal or from any workspace, show up here." />
        ) : (
          <>
            {folders.length ? (
              <section aria-label="Folders" className="mt-6">
                <h2 className="mb-2 text-footnote font-semibold text-muted">Folders</h2>
                <ul className="divide-y divide-line overflow-hidden ui-card rounded-control" data-testid="shared-folders">
                  {folders.map((f) => (
                    <li key={f.id}>
                      <AppLink href={`/shared/${f.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                        <span className="mt-0.5 flex-none" aria-hidden>
                          <FolderGlyph color={f.color} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{f.name || "Untitled"}</span>
                          <span className="block text-footnote text-faint">
                            Shared by {f.sharedBy} · {sharedPlace(f)} · {roleLabel(f.role)} · {f.noteCount === 1 ? "1 note" : `${f.noteCount} notes`} · updated {formatRelative(f.updatedAt)}
                          </span>
                        </span>
                      </AppLink>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {docs.length ? (
              <section aria-label="Pages" className="mt-6">
                {folders.length ? <h2 className="mb-2 text-footnote font-semibold text-muted">Pages</h2> : null}
                <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <AppLink href={`/d/${d.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                        <span className="text-title-2" aria-hidden>
                          <FileText size={16} className="text-muted" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{d.title || "Untitled"}</span>
                          <span className="block truncate text-subheadline text-muted">{d.excerpt}</span>
                          <span className="block text-footnote text-faint">
                            Shared by {d.sharedBy} · {d.workspaceName ?? `Personal · ${d.ownerName ?? "someone"}`} · {d.role === "editor" ? "Can edit" : d.role === "commenter" ? "Can comment" : "Can view"} · updated {formatRelative(d.updatedAt)}
                          </span>
                        </span>
                      </AppLink>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
        <SharedVaultItems />
      </div>
    </ViewChrome>
  );
}
