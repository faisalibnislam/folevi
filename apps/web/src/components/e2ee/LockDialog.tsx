"use client";

import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import type { MenuItem } from "@/components/ui/Menu";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useAppState } from "@/lib/app/state";
import { useCapabilities } from "@/lib/mode";
import { copy } from "@/lib/e2ee/copy";
import { e2eeActions, useE2eeSpace, useKeySession, useLockedIds } from "./__stubs__";
import { SetupWizard } from "./SetupWizard";

/**
 * Whether the "Always fully encrypted" item shows before the account has encryption set up. §10.8 offers it
 * to everyone (it opens the wizard first); the owner asked that Standard users see nothing new but Settings >
 * Privacy until encryption ships, so it waits behind this switch.
 */
export const LOCK_MENU_FOR_EVERYONE = false;

/** Asks before marking a folder or note Always fully encrypted, or before stopping (§10.8, §6.9). */
export function LockDialog({ open, onClose, kind, id, name, locked }: { open: boolean; onClose: () => void; kind: "folder" | "document"; id: string; name: string; locked: boolean }) {
  const { scope } = useAppState();
  const space = useE2eeSpace(scope);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const l = copy.lock;
  const standard = !space || space.level === "standard";
  const apply = async () => {
    setBusy(true);
    try {
      if (kind === "folder") await e2eeActions.setFolderLocked(scope, id, !locked);
      else await e2eeActions.setDocumentLocked(scope, id, !locked);
      toast.show(locked ? l.stopped(name) : l.done(name), { tone: "success" });
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={locked ? l.stopTitle(name) : l.title(name)}
      description={locked ? (standard ? l.stopStandard : l.stopEncrypted) : l.body}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{copy.wizard.cancel}</Button>
          <Button variant={locked && standard ? "danger" : "primary"} disabled={busy} aria-busy={busy || undefined} onClick={() => void apply()}>
            {locked ? l.stopButton : busy ? l.busy : l.button}
          </Button>
        </>
      }
    />
  );
}

type LockTarget = { kind: "folder" | "document"; id: string; name: string; locked: boolean };
let openLock: ((t: LockTarget) => void) | null = null;

/**
 * The "Always fully encrypted" item for a folder's or note's menu, with a check when on. Choosing it opens
 * LockDialogHost's dialogs (the wizard first when the account has no encryption yet, then the confirmation),
 * so a menu only needs the item.
 */
export function useLockMenuItem(target: { kind: "folder" | "document"; id: string; name: string; locked?: boolean } | null): MenuItem | null {
  const { canEdit, canManage, workspace } = useAppState();
  const caps = useCapabilities();
  const { state } = useKeySession();
  const ids = useLockedIds();
  if (!target || !caps.account) return null;
  const locked = target.locked ?? (target.kind === "folder" ? ids.folders.has(target.id) : ids.documents.has(target.id));
  // Personal: its owner. A workspace: its owner and admins (like the level and the switches, §8.5).
  const allowed = workspace ? canManage : canEdit;
  if (!allowed || (state === "none" && !LOCK_MENU_FOR_EVERYONE)) return null;
  return {
    label: copy.lock.menuItem,
    icon: <LockKeyhole size={14} />,
    checked: locked,
    multi: true,
    onSelect: () => openLock?.({ kind: target.kind, id: target.id, name: target.name || "Untitled", locked }),
  };
}

/** Mounted once (E2eeGate): the dialogs behind every "Always fully encrypted" item. */
export function LockDialogHost() {
  const { scope } = useAppState();
  const { state } = useKeySession();
  const [target, setTarget] = useState<LockTarget | null>(null);
  const [asking, setAsking] = useState(false);
  const [wizard, setWizard] = useState(false);
  useEffect(() => {
    openLock = (t) => {
      setTarget(t);
      if (state === "none") setWizard(true);
      else setAsking(true);
    };
    return () => {
      openLock = null;
    };
  }, [state]);
  if (!target) return null;
  return (
    <>
      <LockDialog open={asking} onClose={() => setAsking(false)} kind={target.kind} id={target.id} name={target.name} locked={target.locked} />
      {wizard ? <SetupWizard open onClose={() => setWizard(false)} scope={scope} mode="methods" reason={copy.wizard.start.firstLock} onDone={() => setAsking(true)} /> : null}
    </>
  );
}
