"use client";
// The apps carry their interface built in, so an old app keeps calling the backend the way it shipped with
// (docs/LOCAL_MODE_PLAN.md §5.3, risk R1). When the backend says this version is too old to sync
// (settings.status minShellVersion, convex/lib/shellVersions.ts), the app asks for an update instead of
// syncing. No prices or plans here: it's an app update, nothing to buy.
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@/lib/convex/api";
import { FullPageMessage } from "@/lib/app/state";
import { isShell, shell } from "@/lib/shell";
import { shellNeedsUpdate } from "../../../../../convex/lib/shellVersions";

/** Whether this app is older than the oldest version the backend still syncs with. Always false on the website. */
export function useShellOutdated(): boolean {
  const host = isShell() ? shell() : null;
  const status = useQuery(api.settings.status, host ? {} : "skip");
  if (!host || !status) return false;
  return shellNeedsUpdate(host.shellVersion, status.minShellVersion?.[host.platform]);
}

export function ShellUpdateGate({ children }: { children: ReactNode }) {
  const outdated = useShellOutdated();
  if (!outdated) return <>{children}</>;
  const mac = shell()?.platform === "mac";
  return (
    <FullPageMessage
      title="Update Folevi to keep syncing"
      body={
        mac
          ? "This version of Folevi for Mac is too old to sync with your account. Choose Check for Updates in the Folevi menu, then open Folevi again. Your notes on this Mac are safe."
          : "This version of Folevi is too old to sync with your account. Update it from the App Store, then open it again. Your notes on this device are safe."
      }
    />
  );
}
