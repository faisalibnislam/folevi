"use client";
// The library's controls and status in React (LocalGate, Settings > Library, a note's placeholder). Only the
// window hosting the library has them (`client.local.library`, lib/local/client.ts); in another window, and on
// an in-memory library, there's nothing and these return null. The hosting window can change under a live
// page (host.ts), so the control is looked for again until one appears.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocalClient } from "@/lib/convex/provider";
import { shell } from "@/lib/shell";
import type { CloudStatus, ShellLockSettings } from "@/lib/shell/types";
import type { LibraryControl, LibraryStatus } from "./store/types";

export function useLibraryControl(): LibraryControl | null {
  const client = useLocalClient();
  const [control, setControl] = useState<LibraryControl | null>(() => client?.local.library ?? null);
  useEffect(() => {
    if (!client) return;
    const look = () => {
      const next = client.local.library ?? null;
      setControl((had) => (had === next ? had : next));
      return next;
    };
    if (look()) return;
    const timer = setInterval(() => {
      if (look()) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [client]);
  return control;
}

const noSubscription = () => () => {};
const nothing = () => null;

/** The library's status, kept current; null without a control. */
export function useLibraryStatus(control: LibraryControl | null): LibraryStatus | null {
  return useSyncExternalStore(control ? control.subscribe : noSubscription, control ? control.status : nothing, nothing);
}

/** Dropbox and Google Drive's connection (null on a host without them). */
export function useCloudStatus(): CloudStatus | null {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  useEffect(() => {
    const cloud = shell()?.library.cloud;
    if (!cloud) return;
    let live = true;
    void cloud.status().then(
      (s) => live && setStatus(s),
      () => undefined,
    );
    const off = cloud.onStatus((s) => live && setStatus(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}

/** The Touch ID lock's settings, with a setter; null until read (or on a host without it). */
export function useLockSettings(): [ShellLockSettings | null, (patch: Partial<Pick<ShellLockSettings, "lock" | "lockAfter">>) => Promise<void>] {
  const [settings, setSettings] = useState<ShellLockSettings | null>(null);
  useEffect(() => {
    const lock = shell()?.lock;
    if (!lock) return;
    let live = true;
    void lock.getSettings().then(
      (s) => live && setSettings(s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const update = async (patch: Partial<Pick<ShellLockSettings, "lock" | "lockAfter">>) => {
    const lock = shell()?.lock;
    if (!lock) return;
    setSettings(await lock.setSettings(patch));
  };
  return [settings, update];
}
