"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { clearAllLocalData, localDb } from "@/lib/sync/db";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

/** Changes on this device that haven't reached the server yet (queued edits, conflicts, uploads). */
export async function unsyncedChangeCount(accountKey: string | null): Promise<number> {
  if (!accountKey) return 0;
  try {
    const db = await localDb(accountKey);
    let count = 0;
    for (const state of await db.getAll("syncState")) {
      count += (state.pending?.length ?? 0) + (state.inflight?.length ?? 0) + (state.conflicts?.length ?? 0);
    }
    count += await db.count("uploads");
    return count;
  } catch {
    return 0;
  }
}

/** Ends the session on the server, then clears this device's copy. */
export async function signOutNow(destination = "/signin?notice=signed_out") {
  try {
    await authClient.signOut();
  } catch {
    // Offline: the cookie is still cleared locally by the POST route below if we can't reach the server.
  }
  await clearAllLocalData();
  window.location.assign(destination);
}

/**
 * Sign-out that never silently deletes work: if anything on this device hasn't synced, the person
 * must explicitly choose to discard it (or stay and let it sync).
 */
export function useSafeSignOut(accountKey: string | null) {
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const request = async () => {
    const count = await unsyncedChangeCount(accountKey);
    if (count > 0) setPending(count);
    else {
      setBusy(true);
      await signOutNow();
    }
  };
  const dialog = (
    <Dialog
      open={pending !== null}
      onClose={() => setPending(null)}
      title="Some changes haven't synced yet"
      description={
        pending === 1
          ? "One change on this device hasn't reached Folevi yet. If you sign out now it will be deleted from this device."
          : `${pending ?? 0} changes on this device haven't reached Folevi yet. If you sign out now they will be deleted from this device.`
      }
      size="sm"
      footer={
        <>
          <Button variant="primary" onClick={() => setPending(null)}>
            Stay signed in
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOutNow();
            }}
          >
            Sign out and delete them
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        {typeof navigator !== "undefined" && !navigator.onLine
          ? "You're offline. Reconnect and wait for the status to show “Saved”, then sign out."
          : "Wait a moment for the status to show “Saved”, then sign out."}
      </p>
    </Dialog>
  );
  return { request, dialog, busy };
}

export function SignOutButton({ accountKey, label = "Sign out" }: { accountKey: string | null; label?: string }) {
  const { request, dialog, busy } = useSafeSignOut(accountKey);
  return (
    <>
      <Button variant="secondary" onClick={() => void request()} disabled={busy}>
        {label}
      </Button>
      {dialog}
    </>
  );
}
