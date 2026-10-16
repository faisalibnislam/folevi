"use client";

import type { ReactNode } from "react";
import { ChevronRight, FileText, Share } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import type { MenuEntry } from "@/components/ui/Menu";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { GlassPill, PillButton } from "./Glass";
import { MoreMenu } from "./RootBar";
import { Sheet } from "./Sheet";
import type { InspectorTab } from "@/components/doc/Inspector";

/** Top right of a note: Share and the note's "…" menu (the same actions as on the web). */
export function NoteTrailing({ onShare, shared, actions }: { onShare?: () => void; shared: boolean; actions: MenuEntry[] }) {
  return (
    <GlassPill label="Note actions">
      {onShare ? (
        <PillButton label={shared ? "Shared: sharing settings" : "Share"} onClick={onShare}>
          <Share size={20} strokeWidth={1.9} aria-hidden className="-mt-0.5" />
          {shared ? <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-capsule bg-heading" /> : null}
        </PillButton>
      ) : null}
      {actions.length ? <MoreMenu items={actions} label="Document actions" /> : null}
    </GlassPill>
  );
}

/** The note's place, in the middle of the bar until the title takes over: its parent page, else its folder (or Drafts). */
export function NotePlaceChip({ parent, folder }: { parent?: { id: string; title: string } | null; folder?: { id: string; name: string; color: string | null } | null }) {
  const href = parent ? `/d/${parent.id}` : folder ? `/folders/${folder.id}` : "/drafts";
  const label = parent ? parent.title || "Untitled" : folder ? folder.name : "Drafts";
  return (
    <AppLink
      href={href}
      aria-label={`In ${label}`}
      className="ui-liquid flex h-8 max-w-full items-center gap-1.5 rounded-capsule pl-2.5 pr-2 text-[13px] font-medium text-heading outline-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-focus"
    >
      {parent ? <FileText size={14} aria-hidden className="flex-none text-muted" /> : <FolderGlyph color={folder?.color ?? null} size={15} />}
      <span className="min-w-0 truncate">{label}</span>
      <ChevronRight size={13} strokeWidth={2.4} aria-hidden className="flex-none text-faint" />
    </AppLink>
  );
}

const TITLES: Record<InspectorTab, string> = { ai: "Foli AI", insert: "Insert", format: "Format", style: "Style", info: "Info", comments: "Comments", related: "Related" };

/**
 * A note's tools in the iPhone app (Foli AI, Insert, Format, Style, Comments, Info): one sheet, its size
 * suited to the tool (Format and Insert leave the note visible above them; Foli AI and Comments can fill
 * the screen).
 */
export function ToolSheet({ open, tab, onClose, children }: { open: boolean; tab: InspectorTab; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={TITLES[tab]} size={tab === "ai" || tab === "comments" || tab === "style" ? "medium" : "fit"} bodyClassName="flex flex-col">
      <div id="document-inspector" className="flex min-h-0 flex-1 flex-col [&>div]:min-h-0 [&>div]:flex-1">
        {children}
      </div>
    </Sheet>
  );
}
