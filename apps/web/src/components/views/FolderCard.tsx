"use client";

import { MoreHorizontal } from "lucide-react";
import { FOLDER_CARD_BOX, FOLDER_CARD_FRAME, FOLDER_CARD_MENU, FolderCardArt, type FolderPreview } from "./FolderCardArt";
import { FolderMenu } from "@/components/app/FolderMenu";
import { AppLink } from "@/lib/app/router";
import { ageText, formatRelative } from "@/lib/format";

const pages = (n: number) => (n === 1 ? "1 page" : `${n.toLocaleString()} pages`);

export interface FolderSummary {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  updatedAt: number;
  documentCount: number;
  /** Up to three of the notes inside (most recently edited first), drawn faintly through the cover. */
  previews?: FolderPreview[];
}

/**
 * A folder card drawn as a real folder (portrait): the drawing (FolderCardArt, shared with the site's
 * replica) inside a link to the folder, with the folder's menu over the cover on hover. The page count sits
 * top-left of the front cover, the last update top-right, and the name bottom-left in large serif.
 */
export function FolderCard({ folder: f, parentName }: { folder: FolderSummary; parentName?: string }) {
  const label = `${f.name}${parentName ? `, in ${parentName}` : ""}, ${pages(f.documentCount)}, updated ${formatRelative(f.updatedAt)}`;
  return (
    <div data-ctx-host="" className={FOLDER_CARD_BOX}>
      <AppLink
        href={`/folders/${f.id}`}
        aria-label={label}
        title={parentName ? `${f.name} (in ${parentName})` : f.name}
        className={`${FOLDER_CARD_FRAME} focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-4 focus-visible:ring-offset-canvas`}
      >
        <FolderCardArt name={f.name} color={f.color} count={f.documentCount} age={ageText(f.updatedAt)} previews={f.previews} />
      </AppLink>
      <FolderMenu
        folder={f}
        trigger={<MoreHorizontal size={16} aria-hidden />}
        className={`${FOLDER_CARD_MENU} pointer-events-none focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto pointer-coarse:pointer-events-auto [&>div>button]:text-[#17171a]/75 [&>div>button:hover]:text-[#17171a]`}
      />
    </div>
  );
}
