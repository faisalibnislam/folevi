"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { MARKETING_URL } from "@/lib/env";
import { desktop } from "@/lib/desktop";
import { nativeApp } from "@/lib/nativeApp";
import { hostAuth } from "@/lib/auth/shellFetch";
import { shell } from "@/lib/shell";
import { forgetThisDevice } from "@/lib/nativeDevice";
import { clearAccountData, clearAllLocalData, localDb } from "@/lib/sync/db";
import { adoptNextSignIn, pinnedUserId } from "@/lib/places/pin";
import { knownAccount } from "@/lib/places/registry";
import { afterAccountSignedOut, signOutOfAccount } from "@/lib/places/web";
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
 * Signs this device out of the account it shows, and only that one (several accounts in one browser or app,
 * docs/MULTI_ACCOUNT_PLAN.md §9): the session ends on the server, this account's copy on the device goes, and
 * its encryption keys too. The other accounts stay signed in, and the page opens the next one; with none left
 * the website lands on the marketing home page and the apps on their sign-in screen, as before.
 *
 * A `destination` on /signin is "sign in again" (to confirm it's you, or because the session ended): the keys
 * stay (a trusted browser unlocks with no prompt afterwards) and the page opens whoever signs in next.
 *
 * In the apps' built-in interface the host ends its own session and forgets the token.
 */
export async function signOutNow(destination = signedOutDestination(), opts: { forget?: boolean; profileId?: string | null } = {}) {
  const again = destination.startsWith("/signin");
  await forgetThisDevice();
  // End-to-end encryption: signing out of an account removes its device keys from here; signing in again (above)
  // keeps a trusted browser's (IndexedDB "folevi-e2ee"), unless it was a public computer (docs/E2EE_DESIGN.md §6.3).
  // Decided before the session ends, while it still knows which it was.
  const forget = opts.forget ?? !again;
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
  const userId = pinnedUserId() ?? (await authClient.getSession().catch(() => null))?.data?.user?.id ?? null;
  const profileId = opts.profileId ?? (userId ? knownAccount(userId)?.profileId : null) ?? null;
  let left: string[] | null = null;
  if (userId) {
    // Only this account's session ends. (Better Auth's own sign-out would end every account in the browser.)
    left = await signOutOfAccount(userId);
  } else {
    try {
      await authClient.signOut();
    } catch {
      // Offline: the session expires on its own, and Settings > Devices can end it from anywhere.
    }
  }
  if (profileId) await clearAccountData(profileId, userId);
  const next = userId ? afterAccountSignedOut(userId, left) : null;
  if (again) {
    adoptNextSignIn();
    if (!next) await clearAllLocalData({ keep });
    window.location.assign(destination);
    return;
  }
  if (next) {
    window.location.assign("/documents");
    return;
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
      await signOutNow(undefined, { profileId: accountKey });
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
              await signOutNow(undefined, { profileId: accountKey });
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
