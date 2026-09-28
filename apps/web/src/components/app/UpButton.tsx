"use client";

import { useQuery } from "convex/react";
import { ArrowUp } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter, type Route } from "@/lib/app/router";

const BTN =
  "grid h-8 w-8 flex-none place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-30";

/** Where "up" leads from a list view: folders and tags to their index, everything else to Home. */
function upFromView(route: Route): { href: string; label: string } | null {
  switch (route.name) {
    case "documents":
      return null;
    case "folder":
      return { href: "/folders", label: "Folders" };
    case "tag":
      return { href: "/tags", label: "Tags" };
    default:
      return { href: "/documents", label: "Home" };
  }
}

/**
 * "Up", like a file browser's: a nested page goes to its parent page, a note to its folder (or Drafts, or
 * Templates), a folder to Folders, a tag to Tags, any other view to Home. Disabled on Home.
 */
export function UpButton() {
  const { route, navigate } = useAppRouter();
  const docId = route.name === "doc" ? route.id : null;
  const meta = useQuery(api.documents.get, docId ? { documentId: docId } : "skip");
  let target: { href: string; label: string } | null;
  if (docId) {
    const parent = meta?.breadcrumbs[meta.breadcrumbs.length - 1];
    target = !meta
      ? null
      : parent
        ? { href: `/d/${parent.id}`, label: parent.title || "Untitled" }
        : meta.folder
          ? { href: `/folders/${meta.folder.id}`, label: meta.folder.name }
          : meta.document.kind === "template"
            ? { href: "/templates", label: "Templates" }
            : { href: "/drafts", label: "Drafts" };
  } else target = upFromView(route);
  const label = target ? `Up to ${target.label}` : "Up";
  return (
    <button type="button" aria-label={label} title={label} disabled={!target} onClick={() => target && navigate(target.href)} className={BTN}>
      <ArrowUp size={15} aria-hidden />
    </button>
  );
}
