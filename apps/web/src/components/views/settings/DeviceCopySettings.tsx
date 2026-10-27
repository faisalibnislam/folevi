"use client";
// Settings > Sync: "Keep all notes on this device" (docs/NATIVE_APP_PLAN.md §11.8). On by default: every note of
// this account (Personal and each workspace) is kept here, so notes open at once and work offline. Shows how far
// the download is, the storage it takes, and removes the downloaded copy on request (never changes waiting to
// sync: those are the engine's and the outbox's).
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { deviceCopyOf, keepAllNotes, onDeviceCopies, onKeepAllNotes, setKeepAllNotes } from "@/lib/sync/deviceCopyHost";
import { keptFilesUsage } from "@/lib/sync/deviceFiles";
import { localDb } from "@/lib/sync/db";
import type { ScopeCopyStatus } from "@/lib/sync/deviceCopy";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ActionRow, DestructiveRow, IosRow, IosSection, SwitchRow } from "@/components/iphone/SettingsKit";
import { Card } from "./Card";

const NONE: readonly ScopeCopyStatus[] = [];

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const count = (n: number) => n.toLocaleString("en-US");

/** One place's progress in words: "Downloading notes, 412 of 1,530" or "All 1,530 notes on this device". */
export function copyProgress(s: ScopeCopyStatus | undefined, on: boolean): string {
  if (!on) return "Notes you open are kept";
  if (!s || s.phase === "listing" || s.total === null) return "Getting ready to download";
  if (s.have < s.total) return `Downloading notes, ${count(s.have)} of ${count(s.total)}`;
  return s.total === 1 ? "The note is on this device" : `All ${count(s.total)} notes on this device`;
}

function useCopyStatus(accountKey: string) {
  const handle = useSyncExternalStore(
    (cb) => onDeviceCopies(cb),
    () => deviceCopyOf(accountKey),
    () => null,
  );
  const status = useSyncExternalStore(
    (cb) => (handle ? handle.copy.subscribe(cb) : () => undefined),
    () => handle?.copy.status() ?? NONE,
    () => NONE,
  );
  return { handle, status };
}

function useKeepAll(accountKey: string): boolean {
  return useSyncExternalStore(
    (cb) => onKeepAllNotes(cb),
    () => keepAllNotes(accountKey),
    () => true,
  );
}

/** What the copy takes on this device: notes kept whole, attachments, and the browser's own estimate. */
function useStorage(accountKey: string, tick: unknown) {
  const [usage, setUsage] = useState<{ notes: number; files: { count: number; bytes: number }; used: number | null; free: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const db = await localDb(accountKey);
        const [notes, files, est] = await Promise.all([db.count("blocks"), keptFilesUsage(accountKey), navigator.storage?.estimate?.().catch(() => undefined)]);
        if (live) setUsage({ notes, files, used: est?.usage ?? null, free: est?.quota !== undefined ? Math.max(0, est.quota - (est.usage ?? 0)) : null });
      } catch {
        /* storage unavailable */
      }
    })();
    return () => {
      live = false;
    };
  }, [accountKey, tick]);
  return usage;
}

export function DeviceCopySettings({ iphone }: { iphone: boolean }) {
  const { profile, workspaces } = useAppState();
  const local = useBackendMode() === "local";
  const on = useKeepAll(profile.id);
  const { handle, status } = useCopyStatus(profile.id);
  const [cleared, setCleared] = useState(0);
  const usage = useStorage(profile.id, `${status.map((s) => `${s.have}/${s.total}`).join(",")}:${cleared}`);
  const toast = useToast();
  const hint = useId();
  // A local library is on this device already; a public computer keeps nothing (no copy runs there).
  if (local) return null;
  const places = status.map((s) => ({ ...s, name: s.scopeKey === "personal" ? "Personal" : (workspaces.find((w) => w.id === s.scopeKey)?.name ?? "Workspace") }));
  const storage = usage
    ? `${count(usage.notes)} ${usage.notes === 1 ? "note" : "notes"} and ${count(usage.files.count)} ${usage.files.count === 1 ? "attachment" : "attachments"} (${bytes(usage.files.bytes)}) kept here.${usage.used !== null ? ` Folevi uses ${bytes(usage.used)} on this device${usage.free !== null ? `, ${bytes(usage.free)} free` : ""}.` : ""}`
    : "";
  const clear = async () => {
    if (!handle) return;
    await handle.copy.clear();
    await handle.files.clear();
    setCleared((n) => n + 1);
    toast.show("Downloaded copy removed");
  };
  const download = () => {
    if (!on) setKeepAllNotes(profile.id, true);
    handle?.copy.foreground();
  };
  const footer = "Notes open instantly and work offline. Attachments up to 1 MB always come too; larger ones only on Wi-Fi, up to 2 GB or a tenth of the free space. Nothing waiting to sync is ever removed.";
  if (iphone)
    return (
      <>
        <IosSection header="Notes on this device" footer={`${footer} ${storage}`}>
          <SwitchRow label="Keep all notes on this device" checked={on} onChange={(next) => setKeepAllNotes(profile.id, next)} />
          {places.map((p) => (
            <IosRow key={p.scopeKey} label={p.name} value={copyProgress(p, on)} />
          ))}
        </IosSection>
        <IosSection>
          <ActionRow label="Download now" onClick={download} disabled={!handle} />
          <DestructiveRow label="Remove downloaded copy" confirm="Remove downloaded copy" message="Your notes stay in your account and anything waiting to sync stays. Notes you open are kept again." onConfirm={() => void clear()} disabled={!handle} />
        </IosSection>
      </>
    );
  return (
    <Card title="Notes on this device" description="Folevi keeps a copy of every note in this browser, so notes open instantly and work offline. It downloads in the background and stays up to date while Folevi is open.">
      <div className="max-w-xl divide-y divide-line/70" data-testid="device-copy-settings">
        <div className="flex items-center justify-between gap-6 py-3 first:pt-0">
          <span className="min-w-0">
            <span className="block text-subheadline text-ink">Keep all notes on this device</span>
            <span id={hint} className="block text-footnote text-muted">
              {footer}
            </span>
          </span>
          <Switch checked={on} onChange={(next) => setKeepAllNotes(profile.id, next)} label="Keep all notes on this device" describedBy={hint} />
        </div>
        {places.map((p) => (
          <div key={p.scopeKey} className="flex items-center justify-between gap-6 py-2 text-subheadline" data-copy-scope={p.scopeKey} data-copy-phase={p.phase}>
            <span className="text-ink">{p.name}</span>
            <span className="tabular-nums text-muted">{copyProgress(p, on)}</span>
          </div>
        ))}
      </div>
      {storage ? <p className="mt-3 max-w-xl text-footnote text-muted">{storage}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={download} disabled={!handle}>
          Download now
        </Button>
        <Button variant="quiet" className="text-danger" onClick={() => void clear()} disabled={!handle}>
          Remove downloaded copy
        </Button>
      </div>
    </Card>
  );
}
