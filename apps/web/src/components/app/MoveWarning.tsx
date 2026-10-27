"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { confirmAction, hasNative } from "@/lib/native/ui";

interface Ask {
  title: string;
  message: string;
  resolve: (yes: boolean) => void;
}

let show: ((ask: Ask) => void) | null = null;

/**
 * Asks before a move changes who can see notes through folder sharing (docs/SHARING.md): the system's alert
 * in the apps, a dialog elsewhere. With no host mounted (nothing can ask) the move goes ahead.
 */
export function confirmMoveWarning(w: { title: string; message: string }): Promise<boolean> {
  if (hasNative("alert")) return confirmAction({ title: w.title, message: w.message, confirm: "Move", cancel: "Cancel" });
  if (!show) return Promise.resolve(true);
  const open = show;
  return new Promise((resolve) => open({ ...w, resolve }));
}

/** Where confirmMoveWarning's dialog draws (once, in the app). */
export function MoveWarningHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    show = (next) =>
      setAsk((was) => {
        was?.resolve(false);
        return next;
      });
    return () => {
      show = null;
    };
  }, []);
  const answer = (yes: boolean) => {
    ask?.resolve(yes);
    setAsk(null);
  };
  return (
    <Dialog
      open={ask !== null}
      onClose={() => answer(false)}
      title={ask?.title ?? ""}
      description={ask?.message}
      size="sm"
      footer={
        <>
          <Button onClick={() => answer(false)}>Cancel</Button>
          <Button variant="primary" data-testid="move-warning-confirm" onClick={() => answer(true)}>
            Move
          </Button>
        </>
      }
    />
  );
}
