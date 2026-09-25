"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";

/**
 * Quick Add Task (⇧⌘A). The task becomes a checklist block in the person's Inbox page unless a document is
 * chosen — every task always lives in a document.
 */
export function QuickAddTask({ open, onClose, documentId }: { open: boolean; onClose: () => void; documentId?: string }) {
  const { workspace, today, deviceId } = useAppState();
  const quickAdd = useMutation(api.tasks.quickAdd);
  const { route, navigate } = useAppRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");
  const [attachHere, setAttachHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentDoc = documentId ?? (route.name === "doc" ? route.id : undefined);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDue("");
      setTime("");
      setAttachHere(Boolean(currentDoc));
    }
  }, [open, currentDoc]);

  return (
    <Dialog open={open} onClose={onClose} title="Quick add task" description="Press Enter to add. Tasks without a document go to your Inbox page." size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          setBusy(true);
          try {
            const r = await quickAdd({
              workspaceId: workspace.id,
              title,
              today,
              dueDate: due || undefined,
              dueTime: due && time ? time : undefined,
              documentId: attachHere && currentDoc ? currentDoc : undefined,
              deviceId: deviceId ?? undefined,
            });
            onClose();
            toast.show("Task added", { tone: "success", action: { label: "Open", onClick: () => navigate(`/d/${r.documentId}`) } });
          } catch (err) {
            toast.show(errorMessage(err), { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="qa-title" className="sr-only">
          Task
        </label>
        <input
          id="qa-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          maxLength={500}
          className="h-11 w-full ui-input rounded-full px-3 text-[15px] outline-none"
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-muted">Due date</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-1 h-9 ui-input rounded-full px-2" />
          </label>
          <label className="text-sm">
            <span className="block text-muted">Time (optional)</span>
            <input type="time" value={time} disabled={!due} onChange={(e) => setTime(e.target.value)} className="mt-1 h-9 ui-input rounded-full px-2 disabled:opacity-50" />
          </label>
        </div>
        {currentDoc ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={attachHere} onChange={(e) => setAttachHere(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            Add to the open document instead of your Inbox
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
            Add task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
