"use client";

/**
 * The quiet mark on a note card or row whose changes are still only on this device (made offline, or in the
 * moment before the server answers): a small dot and "Waiting to sync". "failed" says the server refused a
 * change (the sync status explains and offers Retry).
 */
export function WaitingToSync({ state = "queued", className = "" }: { state?: "queued" | "failed"; className?: string }) {
  const failed = state === "failed";
  return (
    <span
      data-waiting-to-sync={state}
      className={`inline-flex items-center gap-1 text-footnote font-medium ${failed ? "text-danger" : "text-muted"} ${className}`}
      title={failed ? "A change to this note wasn’t saved. Open the sync status to retry." : "Saved on this device. It syncs when you’re back online."}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-tiny ${failed ? "bg-danger" : "bg-current"}`} aria-hidden />
      <span>{failed ? "Not saved" : "Waiting to sync"}</span>
    </span>
  );
}

/** A list row's waiting mark, when this device laid one on it (lib/sync/localNotes.ts overlayNotes). */
export function waitingOf(row: object): "queued" | "failed" | undefined {
  const w = (row as { waiting?: unknown }).waiting;
  return w === "queued" || w === "failed" ? w : undefined;
}
