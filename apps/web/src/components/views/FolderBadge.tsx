import { Check, PencilLine } from "lucide-react";
import { FolderGlyph } from "@/components/ui/FolderGlyph";

export interface HomeFolder {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Where a page lives: its folder (with a checkmark, meaning it's been filed) or "Draft" when it isn't
 * in any folder yet. Nested pages show their parent page's folder.
 */
export function FolderBadge({ folder, className = "" }: { folder: HomeFolder | null | undefined; className?: string }) {
  if (folder) {
    return (
      <span
        className={`inline-flex min-w-0 max-w-[70%] shrink-0 items-center gap-1 rounded-[6px] bg-moss-soft px-2 py-0.5 text-[11px] font-medium text-moss-ink ${className}`}
        title={`In folder “${folder.name}”`}
      >
        <Check size={11} strokeWidth={2.5} className="shrink-0" aria-hidden />
        <FolderGlyph color={folder.color} size={13} />
        <span className="truncate">
          <span className="sr-only">In folder </span>
          {folder.name}
        </span>
      </span>
    );
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted ${className}`} title="Not in a folder yet">
      <PencilLine size={11} className="shrink-0" aria-hidden />
      Draft
    </span>
  );
}
