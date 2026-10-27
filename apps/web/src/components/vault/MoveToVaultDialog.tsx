"use client";
// "Move to the Vault…" from a note's menu (docs/VAULT_PLAN.md §5): the note becomes a sealed vault note and the
// original is deleted for good, with its version history. The Vault must be open on this device.
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { isSealedDocument } from "@/lib/e2ee/router/hooks";
import { vaultSessions } from "@/lib/vault/keys";
import { newItemId } from "@/lib/vault/items";
import { sealNote } from "@/lib/vault/files";
import { useVaultInfo, useVaultOpen } from "./useVault";
import { vaultDocFromBlocks, whyNotMovable } from "./moveNote";

export function MoveToVaultDialog({ documentId, title, onClose }: { documentId: string; title: string; onClose: () => void }) {
  const { engine } = useAppState();
  const { navigate } = useAppRouter();
  const info = useVaultInfo();
  const vaultId = info?.exists ? info.id : null;
  const open = useVaultOpen(vaultId);
  const createNote = useMutation(api.vaultFiles.createNote);
  const trash = useMutation(api.documents.moveToTrash);
  const deleteForGood = useMutation(api.documents.deletePermanently);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const blocks = engine ? engine.documentBlocks(documentId) : [];
  const problem = whyNotMovable(blocks);

  const move = async () => {
    if (!vaultId || !engine) return;
    setBusy(true);
    try {
      const s = vaultSessions();
      const version = s.currentVersion(vaultId)!;
      const doc = vaultDocFromBlocks(engine.documentBlocks(documentId));
      const text = engine
        .documentBlocks(documentId)
        .map((b) => (b.text as { text?: string }[]).map((t) => t.text ?? "").join(""))
        .join(" ");
      const name = title.trim() || "Untitled";
      const id = newItemId();
      // The vault copy first, so nothing is lost if deleting the original fails.
      await createNote({ vaultId, itemId: id, item: await sealNote(vaultId, id, version, s.keys(vaultId), name, doc, text.replace(/\s+/g, " ").trim().slice(0, 160)), movedFrom: documentId, client: s.info(vaultId) });
      try {
        await trash({ documentId });
        await deleteForGood({ documentId, confirmTitle: isSealedDocument(documentId) ? "sealed" : name });
        toast.show("Moved to the Vault. The original is deleted for good.", { tone: "success" });
      } catch (e) {
        toast.show(`Moved a copy to the Vault, but the original couldn't be deleted for good (${errorMessage(e)}). It's in Trash: ask its owner to delete it.`, { tone: "error" });
      }
      onClose();
      navigate("/vault");
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Move to the Vault?"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!open ? (
            <Button variant="primary" onClick={() => (onClose(), navigate("/vault"))}>
              Open the Vault
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || Boolean(problem)} onClick={() => void move()}>
              {busy ? "Moving…" : "Move to the Vault"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 pb-2 text-subheadline text-muted">
        {!open ? (
          <p>Unlock the Vault on this device first, then come back to this note.</p>
        ) : problem ? (
          <p className="text-warning">{problem}</p>
        ) : (
          <>
            <p>&ldquo;{title.trim() || "Untitled"}&rdquo; becomes an end-to-end encrypted note in the Vault, opened with the Vault&apos;s passcode, and every change to it is logged.</p>
            <p>The original note is deleted for good, with its version history, comments and links to it, so no readable copy stays outside the Vault. Search and Foli AI won&apos;t find it.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
