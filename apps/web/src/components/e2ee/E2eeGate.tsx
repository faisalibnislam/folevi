"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FullPageMessage, useAppState } from "@/lib/app/state";
import { copy } from "@/lib/e2ee/copy";
import { useKeySession } from "@/lib/e2ee/keys";
import { startFeatureWorkers, startMigrationRunner, useE2eeSpaceStatus, useSpaceAccess } from "./hooks";
import { UnlockScreen } from "./UnlockScreen";
import { SetupWizard, pendingWizard } from "./SetupWizard";
import { IncomingApprovalHost } from "./ApproveDeviceDialog";
import { ConsentHost } from "./ConsentPopover";
import { LOCK_MENU_FOR_EVERYONE, LockDialogHost } from "./LockDialog";
import { NativeGate } from "@/lib/engine/NativeGate";

/** The full page the gate shows instead of the app, with a way back to Personal from a locked workspace. */
function GatePage({ children }: { children: ReactNode }) {
  const { scope, setContext } = useAppState();
  return (
    <main id="main" tabIndex={-1} className="ui-neutral-chrome flex min-h-dvh flex-col bg-canvas">
      <div className="flex-1">{children}</div>
      {scope.kind === "workspace" ? (
        <div className="flex justify-center pb-8">
          <Button variant="quiet" onClick={() => setContext({ kind: "personal" })}>
            {copy.unlock.switchToPersonal}
          </Button>
        </div>
      ) : null}
    </main>
  );
}

/**
 * Between AccountGate and the Shell (§6.3, §8.1, §8.2). Standard accounts pass straight through: nothing here
 * runs for them beyond reading the key session's "none". For an e2ee-active space it shows, in place of the
 * app: the unlock screen while this browser is locked (and the trust choice right after), the setup wizard
 * when a workspace is encrypted and this account has no keys, or the wait for an admin's device to share
 * the key. A query refused with `e2ee_locked_session` anywhere below lands on the unlock screen too.
 */
export function E2eeGate({ children }: { children: ReactNode }) {
  const { scope, workspace, setContext } = useAppState();
  const { state } = useKeySession();
  const status = useE2eeSpaceStatus(scope);
  const access = useSpaceAccess(scope);
  const [unlocking, setUnlocking] = useState(false);
  const [refused, setRefused] = useState(0);
  const [wizard, setWizard] = useState(() => pendingWizard(scope, "methods")?.extra === "gate");
  const locked = state === "locked" || state === "unlocking";
  // An encrypted space (WP7's view; Standard accounts read Standard). A Standard space with a few locked notes
  // stays open: a locked note's own queries land on the unlock screen through the boundary below.
  const active = status.level !== "standard";
  // Once the person starts unlocking by hand, the screen stays up after the notes open, until they pick
  // "Trust this browser" or a public computer. (Opening with this device's own key needs no screen.)
  const personal = workspace ? [{ id: "personal", label: copy.unlock.switchToPersonal, style: "quiet" as const, run: () => setContext({ kind: "personal" }) }] : [];
  const spaceInfo = { space: scope.kind === "personal" ? "personal" : scope.workspaceId, spaceName: workspace?.name ?? "Personal" };
  if (access === "needs_setup")
    return (
      <GatePage>
        <NativeGate gate="e2eeSetup" title={copy.unlock.lockedSpace} message={copy.unlock.needsSetup} e2ee={{ ...spaceInfo, view: "needsSetup", methods: [] }} actions={personal} />
        <div className="flex min-h-full items-start justify-center px-4 py-16 sm:items-center">
          <section className="ui-card w-full max-w-md rounded-container p-6 sm:p-8">
            <span aria-hidden className="grid h-11 w-11 place-items-center rounded-control bg-heading text-canvas">
              <LockKeyhole size={20} />
            </span>
            <h1 className="ui-display mt-4 text-[24px] leading-tight">{copy.unlock.lockedSpace}</h1>
            <p className="mt-2 text-sm text-muted">{copy.unlock.needsSetup}</p>
            <Button variant="primary" className="mt-6" onClick={() => setWizard(true)}>
              {copy.unlock.setUp}
            </Button>
          </section>
        </div>
        {wizard ? <SetupWizard open onClose={() => setWizard(false)} scope={scope} mode="methods" resumeExtra="gate" /> : null}
      </GatePage>
    );
  if (access === "waiting_for_key")
    return (
      <GatePage>
        <NativeGate gate="e2eeWaiting" title={copy.unlock.waitingTitle} message={copy.unlock.waitingForKey} e2ee={{ ...spaceInfo, view: "waitingForKey", methods: [] }} actions={personal} />
        <div className="flex min-h-full items-start justify-center px-4 py-16 sm:items-center">
          <section role="status" className="ui-card w-full max-w-md rounded-container p-6 sm:p-8">
            <h1 className="ui-display text-[24px] leading-tight">{copy.unlock.waitingTitle}</h1>
            <p className="mt-2 text-sm text-muted">{copy.unlock.waitingForKey}</p>
            {workspace ? <p className="mt-3 text-[13px] text-faint">{workspace.name}</p> : null}
          </section>
        </div>
        {/* The wizard opened from "Set up encryption" carries on here once the keys exist (ways to unlock). */}
        {wizard ? <SetupWizard open onClose={() => setWizard(false)} scope={scope} mode="methods" resumeExtra="gate" /> : null}
      </GatePage>
    );
  if (!unlocking && state === "unlocking" && (active || refused > 0)) return <FullPageMessage title={copy.unlock.opening} busy />;
  if ((active && (locked || unlocking)) || (refused > 0 && locked))
    return (
      <GatePage>
        <UnlockScreen
          onStart={() => setUnlocking(true)}
          onDone={() => {
            setUnlocking(false);
            setRefused(0);
          }}
        />
      </GatePage>
    );
  return (
    <LockedSessionBoundary onRefused={() => setRefused((n) => n + 1)}>
      {children}
      {/* Standard accounts: nothing but the children (the same tree, so setting up never remounts the app). */}
      {state !== "none" || LOCK_MENU_FOR_EVERYONE ? <LockDialogHost /> : null}
      {state === "unlocked" ? <E2eeHosts /> : null}
    </LockedSessionBoundary>
  );
}

/** The dialogs a trusted, unlocked device answers wherever the person is: device approvals and Foli AI consent. */
function E2eeHosts() {
  return (
    <>
      <IncomingApprovalHost />
      <ConsentHost />
    </>
  );
}

/** WP8's migration runner and feature workers, started once this device is unlocked (§6.9, §7). */
export function E2eeWorkers() {
  const { state } = useKeySession();
  useEffect(() => {
    if (state !== "unlocked") return;
    const stopMigration = startMigrationRunner();
    const stopWorkers = startFeatureWorkers();
    return () => {
      stopMigration();
      stopWorkers();
    };
  }, [state]);
  return null;
}

/** Turns the router's `e2ee_locked_session` refusal (thrown by a query while locked) into the unlock screen. */
class LockedSessionBoundary extends Component<{ children: ReactNode; onRefused: () => void }, { failed: boolean; other: unknown }> {
  override state = { failed: false, other: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    const ours = (error as { data?: { code?: string } })?.data?.code === "e2ee_locked_session";
    return ours ? { failed: true, other: null } : { failed: false, other: error };
  }
  override componentDidUpdate() {
    if (this.state.failed) {
      this.props.onRefused();
      this.setState({ failed: false });
    }
  }
  override render() {
    // Anything else goes on to the boundaries above, as if this one weren't here.
    if (this.state.other) throw this.state.other;
    return this.state.failed ? null : this.props.children;
  }
}
