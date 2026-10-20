"use client";
// A note listed from another device's catalog whose file isn't here yet (docs/LOCAL_MODE_PLAN.md §3.7, §3.14
// "Cold start"): the provider is still downloading it, or the device that has it hasn't synced it. It shows
// in place of the editor, so nothing is typed into a note that hasn't arrived; the note opens on its own
// once the file is read.
import { CloudDownload, Hourglass, Loader2 } from "lucide-react";
import { downloadingFrom } from "@/lib/local/libraryPlace";
import { useLibraryControl, useLibraryStatus } from "@/lib/local/useLibrary";

export function NotePlaceholder({ state }: { state: "downloading" | "waiting" }) {
  const status = useLibraryStatus(useLibraryControl());
  const kind = status?.info?.kind ?? null;
  const downloading = state === "downloading";
  const where = kind === "icloud" ? "iCloud Drive" : kind === "dropbox" ? "Dropbox" : kind === "gdrive" ? "Google Drive" : "your sync service";
  return (
    <div role="status" aria-live="polite" data-testid="note-placeholder" data-state={state} className="grid justify-items-center gap-3 px-4 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-panel bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] text-heading">
        {downloading ? <CloudDownload size={22} aria-hidden /> : <Hourglass size={22} aria-hidden />}
      </span>
      <p className="text-[17px] font-semibold text-heading">{downloading ? downloadingFrom(kind) : "Waiting for this from your other device"}</p>
      <p className="max-w-sm text-[14px] leading-relaxed text-muted">
        {downloading
          ? `This note is on its way from ${where}. It opens here as soon as it arrives.`
          : "Another device has this note but hasn't synced it yet. Open Folevi on that device and it comes through."}
      </p>
      {downloading ? <Loader2 size={16} aria-hidden className="mt-1 animate-spin text-muted motion-reduce:animate-none" /> : null}
    </div>
  );
}
