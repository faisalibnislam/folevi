"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { copy } from "@/lib/e2ee/copy";
import { publishPlainCopy } from "./hooks";

/**
 * "Publish a readable copy?" (§9.3, §10.11): the device renders a plain copy of the sealed note and Folevi
 * serves it like a Standard page. The note itself stays encrypted; the copy doesn't follow edits.
 */
export function PublishCopyDialog({ open, onClose, documentId, onPublished }: { open: boolean; onClose: () => void; documentId: string; onPublished: (url: string) => void }) {
  const p = copy.publish;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={p.title}
      description={p.body}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{copy.wizard.cancel}</Button>
          <Button
            variant="primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={async () => {
              setBusy(true);
              try {
                const { url } = await publishPlainCopy(documentId);
                toast.show(p.published, { tone: "success" });
                onPublished(url);
                onClose();
              } catch (e) {
                toast.show(errorMessage(e), { tone: "error" });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Globe size={14} aria-hidden /> {busy ? p.busy : p.button}
          </Button>
        </>
      }
    />
  );
}
