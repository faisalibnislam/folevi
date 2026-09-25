"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { blocksToHtml, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";

const REASONS: Record<string, string> = { idle: "Autosaved version", close: "Saved when closed", before_restore: "Before a restore", manual: "Saved manually", import: "Imported" };

/** Version snapshots with a read-only preview and restore (the current state is snapshotted first). */
export function VersionHistory({ open, onClose, documentId, canRestore }: { open: boolean; onClose: () => void; documentId: string; canRestore: boolean }) {
  const list = useQuery(api.documents.snapshots, open ? { documentId } : "skip");
  const [selected, setSelected] = useState<string | null>(null);
  const content = useQuery(api.documents.snapshotContent, selected ? { snapshotId: selected } : "skip");
  const restore = useMutation(api.documents.restoreSnapshot);
  const createSnapshot = useMutation(api.documents.createSnapshot);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  let preview: string | null = null;
  if (content?.content) {
    try {
      const parsed = JSON.parse(content.content) as { title: string; blocks: WireBlock[] };
      preview = blocksToHtml(parsed.blocks, { title: parsed.title || "Untitled" });
    } catch {
      preview = null;
    }
  }
  return (
    <Dialog open={open} onClose={() => { setSelected(null); setConfirm(false); onClose(); }} title="Version history" description="Versions are saved after a pause in editing and when you close a page — not on every keystroke." size="lg">
      <div className="grid min-h-[50vh] gap-4 md:grid-cols-[220px_1fr]">
        <div>
          {canRestore ? (
            <Button size="sm" className="mb-3 w-full" onClick={() => void createSnapshot({ documentId, reason: "manual" }).then((r) => toast.show(r.created ? "Version saved" : "No changes since the last version"), (e) => toast.show(errorMessage(e), { tone: "error" }))}>
              Save a version now
            </Button>
          ) : null}
          <ul role="listbox" aria-label="Versions" className="space-y-1">
            {list === undefined ? <li className="text-sm text-muted">Loading…</li> : null}
            {list?.length === 0 ? <li className="text-sm text-muted">No versions yet.</li> : null}
            {list?.map((s) => (
              <li key={s.id}>
                <button type="button" role="option" aria-selected={selected === s.id} onClick={() => { setSelected(s.id); setConfirm(false); }} className={`w-full rounded-[8px] px-3 py-2 text-left text-sm ${selected === s.id ? "bg-accent-soft text-accent-soft-ink" : "hover:bg-surface"}`}>
                  <span className="block font-medium">{formatDateTime(s.createdAt)}</span>
                  <span className="block text-xs text-muted">
                    {REASONS[s.reason] ?? "Version"} · {s.createdBy}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-h-0 flex-col rounded-[10px] border border-line bg-surface">
          {!selected ? (
            <p className="m-auto p-6 text-sm text-muted">Choose a version to preview it.</p>
          ) : !preview ? (
            <p className="m-auto p-6 text-sm text-muted">Loading preview…</p>
          ) : (
            <>
              <iframe title="Version preview" srcDoc={preview} sandbox="" className="min-h-[45vh] w-full flex-1 rounded-t-[10px] bg-white" />
              {canRestore ? (
                <div className="flex items-center justify-end gap-2 border-t border-line p-3">
                  {confirm ? (
                    <>
                      <span className="mr-auto text-xs text-muted">Your current page is saved as a version first, so you can undo this.</span>
                      <Button size="sm" onClick={() => setConfirm(false)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void restore({ snapshotId: selected }).then(
                            () => {
                              toast.show("Version restored", { tone: "success" });
                              onClose();
                            },
                            (e) => toast.show(errorMessage(e), { tone: "error" }),
                          )
                        }
                      >
                        Restore this version
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => setConfirm(true)}>
                      Restore…
                    </Button>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
