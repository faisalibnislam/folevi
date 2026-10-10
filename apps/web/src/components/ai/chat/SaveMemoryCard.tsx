"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { api } from "@/lib/convex/api";
import type { Id } from "@/lib/convex/api";
import { useToast, errorMessage } from "@/components/ui/Toast";

export interface MemoryOffer {
  kind: "tone" | "language" | "length" | "term" | "instruction";
  text: string;
  status: "proposed" | "saved" | "dismissed";
}

/**
 * An answer's offer to remember a preference: nothing is kept unless the person clicks Save. Once saved it
 * says so (and where to change it); after Not now it's gone.
 */
export function SaveMemoryCard({ memory, busy, onSave, onDismiss }: { memory: MemoryOffer; busy?: boolean; onSave: () => void; onDismiss: () => void }) {
  if (memory.status === "dismissed") return null;
  if (memory.status === "saved") {
    return (
      <p role="status" className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted">
        <Check size={13} aria-hidden /> Saved to memory. You can change it in Settings &gt; AI.
      </p>
    );
  }
  return (
    <div role="group" aria-label="Remember this?" className="mt-3 rounded-[14px] bg-[var(--glass-hover)] p-3 shadow-[inset_0_0_0_1px_var(--glass-border)]">
      <p className="text-[12px] text-muted">Remember this for next time?</p>
      <p className="mt-0.5 text-[13px] font-semibold text-heading">{memory.text}</p>
      <div className="mt-2 flex gap-1.5">
        <button type="button" disabled={busy} onClick={onSave} className="rounded-[6px] bg-[var(--glass-active)] px-3 py-1 text-[12.5px] font-medium text-heading hover:bg-accent-soft disabled:opacity-50">
          Save
        </button>
        <button type="button" disabled={busy} onClick={onDismiss} className="rounded-[6px] px-3 py-1 text-[12.5px] text-muted hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-50">
          Not now
        </button>
      </div>
    </div>
  );
}

/** The offer on a chat answer, saved or dismissed on the server. */
export function MessageMemory({ messageId, memory }: { messageId: Id<"aiMessages">; memory: MemoryOffer }) {
  const save = useMutation(api.aiMemory.saveProposal);
  const dismiss = useMutation(api.aiMemory.dismissProposal);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = (p: Promise<unknown>) => {
    setBusy(true);
    void p.then(
      () => setBusy(false),
      (e) => {
        setBusy(false);
        toast.show(errorMessage(e), { tone: "error" });
      },
    );
  };
  return <SaveMemoryCard memory={memory} busy={busy} onSave={() => run(save({ messageId }))} onDismiss={() => run(dismiss({ messageId }))} />;
}
