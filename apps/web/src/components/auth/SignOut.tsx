"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { MARKETING_URL } from "@/lib/env";
import { desktop } from "@/lib/desktop";
import { nativeApp } from "@/lib/nativeApp";
import { hostAuth } from "@/lib/auth/shellFetch";
import { shell } from "@/lib/shell";
import { forgetThisDevice } from "@/lib/nativeDevice";
import { clearAllLocalData, localDb } from "@/lib/sync/db";
import { endKeySession, keepOnSignOut } from "@/lib/e2ee/keys";
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

/** The website lands on the marketing home page; the apps (iPhone, iPad, Android, Mac) stay on their sign-in screen. */
function signedOutDestination(): string {
  return nativeApp() || desktop() ? "/signin?notice=signed_out" : `${MARKETING_URL}/`;
}

/**
 * Ends the session on the server, then clears this device's copy (in the iOS app, its token too). In the
 * apps' built-in interface the host ends its own session and forgets the token, and the app opens on its
 * sign-in screen (there are no /signin pages there, so `destination` doesn't apply). On the web, signing
 * out lands on the marketing site's home page by default.
 */
export async function signOutNow(destination = signedOutDestination(), opts: { forget?: boolean } = {}) {
  await forgetThisDevice();
  // End-to-end encryption: a trusted browser keeps its device keys (IndexedDB "folevi-e2ee") so the next
  // sign-in here unlocks with no prompt, unless the person asked to forget this browser or it was a public
  // computer (docs/E2EE_DESIGN.md §6.3). Decided before the session ends, while it still knows which it was.
  const forget = opts.forget ?? false;
  const keepE2ee = keepOnSignOut(forget)("folevi-e2ee");
  const keep = (name: string) => name === "folevi-e2ee" && keepE2ee;
  await endKeySession({ forget }).catch(() => undefined);
  if (hostAuth()) {
    await shell()
      ?.auth.signOut()
      .catch(() => undefined);
    await clearAllLocalData({ keep });
    window.location.assign("/");
    return;
  }
  try {
    await authClient.signOut();
  } catch {
    // Offline: the cookie is still cleared locally by the POST route below if we can't reach the server.
  }
  await clearAllLocalData({ keep });
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
