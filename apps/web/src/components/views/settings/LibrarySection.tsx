"use client";
// Settings > Library, local mode's replacement for the account's "Offline & sync" (docs/LOCAL_MODE_PLAN.md
// §5.2, WP10): where the library is (and the Dropbox or Google Drive connection), Sync now, Move library, the
// devices that use it, Library health, the passphrase, the Touch ID lock, Foli AI keys (WP11) and signing in
// to Folevi (WP12). Everything here talks to the host (shell().library, .cloud, .lock) or the library store's
// controls (client.local.library); none of it reaches Folevi's servers.
import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, CloudDownload, Hourglass, Laptop, Loader2, Smartphone } from "lucide-react";
import { useBackendMode, useLocalAi } from "@/lib/mode";
import { AppLink } from "@/lib/app/router";
import { PROVIDERS, modelLabel } from "@/lib/local/ai/catalog";
import { shell } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import type { CloudProvider, LibraryInfo, ShellLockSettings } from "@/lib/shell/types";
import { formatRelative } from "@/lib/format";
import type { HealthItem, LibraryStatus } from "@/lib/local/store/types";
import { hostError, placeName, kindOf, placeProblem, providerName, providerOf } from "@/lib/local/libraryPlace";
import { signInToFolevi } from "@/lib/local/signIn";
import { useCloudStatus, useLibraryControl, useLibraryStatus, useLockSettings } from "@/lib/local/useLibrary";
import { PassphraseFields, PlaceList, movePlace, passphraseHere, passphraseProblem, thisDevice } from "@/components/app/LibrarySetup";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { Card } from "./Card";

/** The host's own description of the library (it changes with a move or a passphrase), read again on demand. */
function useHostInfo(): [LibraryInfo | null, () => void] {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const read = useCallback(() => {
    void shell()
      ?.library.info()
      .then(setInfo, () => undefined);
  }, []);
  useEffect(read, [read]);
  return [info, read];
}

export function LibrarySection() {
  const mode = useBackendMode();
  const control = useLibraryControl();
  const status = useLibraryStatus(control);
  const [info, refreshInfo] = useHostInfo();
  if (mode !== "local") return <Card title="Library">This Folevi keeps your notes in your account. Its offline copy is in Offline &amp; sync.</Card>;
  const where = info ?? status?.info ?? null;
  return (
    <div className="space-y-5" data-testid="library-section">
      <PlaceCard info={where} status={status} onChanged={refreshInfo} syncNow={control ? () => control.syncNow() : null} />
      {status ? <DevicesCard status={status} /> : null}
      {status ? <HealthCard status={status} /> : null}
      {where && passphraseHere() ? <PassphraseCard info={where} onChanged={refreshInfo} /> : null}
      <LockCard />
      <AiKeysCard />
      <AccountCard />
      {shell()?.places ? <ForgetLibraryCard flush={control ? () => control.flush() : null} /> : null}
    </div>
  );
}

/**
 * Several places (docs/MULTI_ACCOUNT_PLAN.md §9): "Remove from this Mac" forgets the library here (this device's copy
 * and journal go) after writing out what's waiting. Its folder, with every note in it, stays exactly as it is.
 */
function ForgetLibraryCard({ flush }: { flush: (() => Promise<void>) | null }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const here = deviceWords().here;
  const forget = async () => {
    setBusy(true);
    try {
      await flush?.();
      const { closeLocalLibrary } = await import("@/lib/local/index");
      await closeLocalLibrary();
      const all = (await indexedDB.databases?.()) ?? [];
      await Promise.all(
        all
          .filter((d) => d.name?.startsWith("folevi-local-"))
          .map(
            (d) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(d.name!);
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
              }),
          ),
      );
      // The app opens another place (an account, or the first-launch choice).
      await shell()?.places?.forgetLibrary();
    } catch (e) {
      setBusy(false);
      toast.show(hostError(e).message || "Folevi couldn't remove the library.", { tone: "error" });
    }
  };
  return (
    <Card title={`Remove from ${here}`} description={`Folevi stops showing this library on ${here}. Its folder stays exactly as it is, with every note in it, and other devices keep using it.`}>
      <Button variant="danger" onClick={() => setOpen(true)} disabled={busy}>
        Remove from {here}…
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Remove the library from ${here}?`}
        description="What's waiting is written to the folder first. Nothing in the folder is deleted: set the library up again on the same folder to bring it back."
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void forget()} disabled={busy}>
              {busy ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      />
    </Card>
  );
}

// ---- where it is ---------------------------------------------------------------------------------------------

function syncLine(status: LibraryStatus | null): string {
  if (!status) return "";
  if (status.state === "unavailable") return `Folevi can't reach the library right now. Your edits are kept on ${thisDevice()} until it's back.`;
  if (status.state === "locked") return "Locked: enter the passphrase to sync.";
  if (status.syncing) return "Syncing…";
  if (status.unsaved > 0) return `${status.unsaved} ${status.unsaved === 1 ? "change" : "changes"} not in the library yet`;
  if (status.lastSyncAt) return `Synced ${formatRelative(status.lastSyncAt)}`;
  return "Not synced yet";
}

function PlaceCard({ info, status, onChanged, syncNow }: { info: LibraryInfo | null; status: LibraryStatus | null; onChanged: () => void; syncNow: (() => Promise<void>) | null }) {
  const toast = useToast();
  const cloud = useCloudStatus();
  const [moving, setMoving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const provider = info ? providerOf(info.kind) : null;
  const sync = async () => {
    if (!syncNow) return;
    setSyncing(true);
    try {
      await syncNow();
      toast.show("Library synced");
    } catch (e) {
      toast.show(hostError(e).message || "Couldn't sync. Try again.", { tone: "error" });
    } finally {
      setSyncing(false);
    }
  };
  return (
    <Card title="Where your library is" description="Folevi keeps your notes as files in one folder. Other devices that use the same place share the library.">
      <dl className="grid max-w-lg grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Syncs with</dt>
        <dd data-testid="library-kind">{info ? placeName(info.kind) : "…"}</dd>
        <dt className="text-muted">Location</dt>
        <dd className="break-words" data-testid="library-path">
          {info?.displayPath || "…"}
        </dd>
        <dt className="text-muted">Status</dt>
        <dd>
          <span role="status" data-testid="library-status">
            {syncLine(status)}
          </span>
        </dd>
        {status?.error && status.state !== "unavailable" ? (
          <>
            <dt className="text-muted">Last problem</dt>
            <dd className="text-danger">{status.error}</dd>
          </>
        ) : null}
      </dl>
      {provider ? <Connection provider={provider} cloud={cloud} /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void sync()} disabled={!syncNow || syncing || status?.state === "locked"}>
          {syncing ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Sync now
        </Button>
        <Button onClick={() => setMoving(true)} disabled={!info}>
          Move library…
        </Button>
      </div>
      <MoveDialog
        open={moving}
        current={info}
        onClose={() => setMoving(false)}
        onMoved={(next) => {
          setMoving(false);
          onChanged();
          toast.show(`Library moved to ${placeName(next.kind)}`, { tone: "success" });
        }}
      />
    </Card>
  );
}

/** Dropbox or Google Drive: who's connected, Reconnect, Sign out. */
function Connection({ provider, cloud }: { provider: CloudProvider; cloud: ReturnType<typeof useCloudStatus> }) {
  const toast = useToast();
  const name = providerName(provider);
  const [busy, setBusy] = useState<"connect" | "signOut" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const here = cloud?.provider === provider ? cloud : null;
  const state = here?.state ?? "none";
  const connect = async () => {
    setBusy("connect");
    try {
      await shell()?.library.cloud?.connect(provider);
      toast.show(`Connected to ${name}`, { tone: "success" });
    } catch (e) {
      if (hostError(e).code !== "cancelled") toast.show(placeProblem(kindOf(provider), e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const signOut = async () => {
    setConfirm(false);
    setBusy("signOut");
    try {
      await shell()?.library.cloud?.signOut();
      toast.show(`Signed out of ${name}`);
    } catch (e) {
      toast.show(hostError(e).message || "Couldn't sign out. Try again.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-4 grid gap-3 rounded-control border border-line px-4 py-3" data-testid="library-connection">
      {busy === "connect" ? (
        <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
          <Loader2 size={15} aria-hidden className="animate-spin text-heading motion-reduce:animate-none" />
          <span className="min-w-0 flex-1">Finish signing in to {name} in {deviceWords().signInPlace}.</span>
          <Button size="sm" onClick={() => void shell()?.library.cloud?.cancel()}>
            Cancel
          </Button>
        </div>
      ) : state === "connected" || state === "offline" ? (
        <p className="text-sm">
          Connected as <span className="font-medium text-heading">{here?.account ?? `your ${name} account`}</span>
          {state === "offline" ? <span className="text-muted">. Offline: changes go up when {deviceWords().here} is back online.</span> : null}
        </p>
      ) : state === "reconnect" ? (
        <p className="flex gap-2 text-sm">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none text-danger" />
          {name} stopped letting Folevi in (the access was removed or it expired). Reconnect to keep syncing. Your notes are safe on {deviceWords().here} meanwhile.
        </p>
      ) : (
        <p className="text-sm text-muted">Not connected to {name}. Your notes are kept on {deviceWords().here} and sync once you connect again.</p>
      )}
      {busy !== "connect" ? (
        <div className="flex flex-wrap gap-2">
          {state !== "connected" && state !== "offline" ? (
            <Button size="sm" variant="primary" onClick={() => void connect()} disabled={busy !== null}>
              {state === "reconnect" ? `Reconnect ${name}` : `Connect ${name}`}
            </Button>
          ) : null}
          {state !== "none" ? (
            <Button size="sm" onClick={() => setConfirm(true)} disabled={busy !== null}>
              Sign out of {name}…
            </Button>
          ) : null}
        </div>
      ) : null}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Sign out of ${name}?`}
        size="sm"
        description={`Folevi stops syncing with ${name}. Your notes stay on ${deviceWords().here} and in ${name}. To sync again, connect again or move the library somewhere else.`}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        }
      />
    </div>
  );
}

function MoveDialog({ open, current, onClose, onMoved }: { open: boolean; current: LibraryInfo | null; onClose: () => void; onMoved: (info: LibraryInfo) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Move your library" description="Folevi copies every file to the new place, checks each one arrived, then uses it. Keep Folevi open until it's done. Other devices need to be moved too." size="md">
      {open ? (
        <PlaceList
          label="Move the library to"
          current={current?.kind}
          onPick={async (kind, onConnecting) => {
            const next = await movePlace(kind, onConnecting);
            if (next && next.kind === kind) onMoved(next);
            return null;
          }}
        />
      ) : null}
    </Dialog>
  );
}

// ---- devices -------------------------------------------------------------------------------------------------

function DevicesCard({ status }: { status: LibraryStatus }) {
  const platform = (p: string) => (p === "ios" ? "iPhone or iPad" : p === "android" ? "Android phone or tablet" : p === "web" ? "Browser" : "Mac");
  return (
    <Card title="Devices" description="Every device that opens this library, and when each last synced with it.">
      {status.devices.length === 0 ? (
        <p className="text-sm text-muted">No device has synced yet.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="library-devices">
          {status.devices.map((d) => (
            <li key={d.deviceId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-small bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] text-ink">{d.platform === "ios" || d.platform === "android" ? <Smartphone size={16} aria-hidden /> : <Laptop size={16} aria-hidden />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">
                  {/* The store names a device "This device" until the host gives it a name of its own. */}
                  {d.name && d.name !== "This device" ? d.name : d.thisDevice ? platform(d.platform) : `Another ${platform(d.platform)}`}
                  {d.thisDevice ? <span className="ml-2 text-xs font-normal text-muted">{deviceWords().Here}</span> : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  {platform(d.platform)}
                  {d.appVersion ? ` · Folevi ${d.appVersion}` : ""}
                </span>
              </span>
              <span className="flex-none text-xs text-muted">{d.thisDevice && status.syncing ? "Syncing…" : `Last synced ${formatRelative(d.lastSeen)}`}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- health ----------------------------------------------------------------------------------------------------

const HEALTH: { key: keyof LibraryStatus["health"]; title: string; why: string; icon: React.ReactNode }[] = [
  {
    key: "unreadable",
    title: "Can't be read",
    why: "These files are damaged, only half written, or were saved with a different passphrase. Folevi never writes over them and keeps trying. A copy that's fine on another device fixes them when it syncs.",
    icon: <AlertTriangle size={15} aria-hidden className="text-danger" />,
  },
  {
    key: "downloading",
    title: "Still downloading",
    why: "Your sync service hasn't brought these to this device yet. They open as soon as they arrive.",
    icon: <CloudDownload size={15} aria-hidden className="text-muted" />,
  },
  {
    key: "waiting",
    title: "Waiting for another device",
    why: "Another device mentioned these, such as a picture or a synced block, but hasn't synced them yet. They appear after it does.",
    icon: <Hourglass size={15} aria-hidden className="text-muted" />,
  },
];

function HealthCard({ status }: { status: LibraryStatus }) {
  const total = status.health.unreadable.length + status.health.downloading.length + status.health.waiting.length;
  return (
    <Card title="Library health" description={total === 0 ? `Every file in the library could be read. ${status.notes.total} ${status.notes.total === 1 ? "note" : "notes"} on ${thisDevice()}.` : "Some files need a moment, or need a look."}>
      <div className="space-y-4" data-testid="library-health">
        {total === 0 ? <p className="text-sm text-muted">Nothing to fix.</p> : null}
        {HEALTH.map((h) => {
          const items = status.health[h.key];
          if (!items.length) return null;
          return (
            <section key={h.key} aria-label={h.title} data-health={h.key}>
              <h4 className="flex items-center gap-2 text-sm font-semibold text-heading">
                {h.icon}
                {h.title} <span className="font-normal text-muted">{items.length}</span>
              </h4>
              <p className="mt-1 max-w-xl text-[13px] leading-snug text-muted">{h.why}</p>
              <ul className="mt-2 space-y-1 text-[13px]">
                {items.slice(0, 20).map((item) => (
                  <HealthRow key={item.path} item={item} />
                ))}
                {items.length > 20 ? <li className="text-muted">and {items.length - 20} more</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function HealthRow({ item }: { item: HealthItem }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium text-ink">{item.title || item.path}</span>
      {item.title ? <span className="truncate font-mono text-[11.5px] text-faint">{item.path}</span> : null}
      <span className="text-muted">since {formatRelative(item.since)}</span>
      {item.detail ? <span className="w-full text-muted">{item.detail}</span> : null}
    </li>
  );
}

// ---- passphrase ----------------------------------------------------------------------------------------------

function PassphraseCard({ info, onChanged }: { info: LibraryInfo; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"set" | "change" | "remove" | null>(null);
  const close = () => setDialog(null);
  const done = () => {
    setDialog(null);
    onChanged();
  };
  return (
    <Card
      title="Passphrase"
      description={
        info.encrypted
          ? "The library is encrypted. Its files can't be read without the passphrase, by anyone, including Folevi."
          : "Encrypt the library's files so the synced copy can't be read without a passphrase. If the passphrase is lost, the synced copy can't be recovered."
      }
    >
      <div className="flex flex-wrap gap-2" data-testid="library-passphrase">
        {info.encrypted ? (
          <>
            <Button onClick={() => setDialog("change")}>Change passphrase…</Button>
            <Button variant="quiet" className="text-danger" onClick={() => setDialog("remove")}>
              Remove passphrase…
            </Button>
          </>
        ) : (
          <Button onClick={() => setDialog("set")}>Encrypt with a passphrase…</Button>
        )}
      </div>
      <SetPassphraseDialog open={dialog === "set"} onClose={close} onDone={done} />
      <ChangePassphraseDialog open={dialog === "change"} onClose={close} onDone={done} />
      <RemovePassphraseDialog open={dialog === "remove"} onClose={close} onDone={done} />
    </Card>
  );
}

function SetPassphraseDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setPassphrase("");
      setConfirm("");
      setUnderstood(false);
      setProblem(null);
    }
  }, [open]);
  const submit = async () => {
    const p = passphraseProblem(passphrase, confirm, understood);
    if (p) return setProblem(p);
    setBusy(true);
    try {
      await shell()?.library.setPassphrase(passphrase);
      toast.show("The library is encrypted", { tone: "success" });
      onDone();
    } catch (e) {
      setProblem(hostError(e).message || "Couldn't encrypt the library. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Encrypt with a passphrase"
      description="Folevi rewrites every file in the library, encrypted. A large library takes a few minutes; keep Folevi open. Other devices ask for the passphrase once."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {busy ? "Encrypting…" : "Encrypt"}
          </Button>
        </>
      }
    >
      <PassphraseFields
        passphrase={passphrase}
        confirm={confirm}
        understood={understood}
        onPassphrase={(v) => (setPassphrase(v), setProblem(null))}
        onConfirm={(v) => (setConfirm(v), setProblem(null))}
        onUnderstood={(v) => (setUnderstood(v), setProblem(null))}
        problem={problem}
      />
    </Dialog>
  );
}

function ChangePassphraseDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const id = useId();
  const [current, setCurrent] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setCurrent("");
      setPassphrase("");
      setConfirm("");
      setUnderstood(false);
      setProblem(null);
    }
  }, [open]);
  const submit = async () => {
    if (!current) return setProblem("Enter the current passphrase.");
    const p = passphraseProblem(passphrase, confirm, understood);
    if (p) return setProblem(p);
    setBusy(true);
    try {
      const ok = await shell()?.library.changePassphrase(current, passphrase);
      if (!ok) return setProblem("The current passphrase isn't right.");
      toast.show("Passphrase changed", { tone: "success" });
      onDone();
    } catch (e) {
      setProblem(hostError(e).message || "Couldn't change the passphrase. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Change passphrase"
      description="Your other devices ask for the new passphrase the next time they sync."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            Change passphrase
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-[13px] text-muted" htmlFor={`${id}-current`}>
          Current passphrase
          <input id={`${id}-current`} type="password" autoComplete="current-password" value={current} onChange={(e) => (setCurrent(e.target.value), setProblem(null))} className="ui-input h-10 rounded-chip px-3 text-[15px] text-ink" />
        </label>
        <PassphraseFields
          newLabel="New passphrase"
          passphrase={passphrase}
          confirm={confirm}
          understood={understood}
          onPassphrase={(v) => (setPassphrase(v), setProblem(null))}
          onConfirm={(v) => (setConfirm(v), setProblem(null))}
          onUnderstood={(v) => (setUnderstood(v), setProblem(null))}
          problem={problem}
        />
      </div>
    </Dialog>
  );
}

function RemovePassphraseDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const id = useId();
  const [current, setCurrent] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setCurrent("");
      setProblem(null);
    }
  }, [open]);
  const submit = async () => {
    const library = shell()?.library;
    if (!library) return;
    if (!current) return setProblem("Enter the passphrase to confirm.");
    setBusy(true);
    try {
      if (!(await library.unlock(current))) return setProblem("That passphrase isn't right.");
      await library.setPassphrase(null);
      toast.show("The library isn't encrypted any more");
      onDone();
    } catch (e) {
      setProblem(hostError(e).message || "Couldn't remove the passphrase. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Remove the passphrase?"
      size="sm"
      description="Folevi rewrites every file without encryption. Anyone who can open the folder, or your account with the sync service, can then read your notes."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? "Removing…" : "Remove passphrase"}
          </Button>
        </>
      }
    >
      <label className="grid gap-1 text-[13px] text-muted" htmlFor={`${id}-p`}>
        Passphrase
        <input id={`${id}-p`} type="password" autoComplete="current-password" value={current} onChange={(e) => (setCurrent(e.target.value), setProblem(null))} className="ui-input h-10 rounded-chip px-3 text-[15px] text-ink" />
      </label>
      {problem ? (
        <p role="alert" className="mt-2 text-[13.5px] text-danger">
          {problem}
        </p>
      ) : null}
    </Dialog>
  );
}

// ---- the lock ------------------------------------------------------------------------------------------------

const LOCK_AFTER: { value: number; label: string }[] = [
  { value: 0, label: "Right away" },
  { value: 60, label: "After 1 minute" },
  { value: 300, label: "After 5 minutes" },
  { value: 900, label: "After 15 minutes" },
  { value: 3600, label: "After 1 hour" },
];

function lockName(method: ShellLockSettings["method"]): string {
  if (method === "biometric") return "your fingerprint or face";
  if (method === "screenLock") return "your screen lock";
  // No lock set up on this device: the name it would have once there is one.
  if (method === "none") return shell()?.platform === "android" ? "your fingerprint or face" : deviceWords().ios ? "Face ID" : "Touch ID";
  return method === "faceID" ? "Face ID" : method === "opticID" ? "Optic ID" : method === "passcode" ? "your passcode" : "Touch ID";
}

function LockCard() {
  const toast = useToast();
  const [settings, update] = useLockSettings();
  const [busy, setBusy] = useState(false);
  const descId = useId();
  if (!settings) return null;
  const name = lockName(settings.method);
  const unavailable = settings.method === "none";
  const change = async (patch: Partial<Pick<ShellLockSettings, "lock" | "lockAfter">>) => {
    setBusy(true);
    try {
      await update(patch);
    } catch (e) {
      // Cancelling Touch ID leaves it as it was.
      if (hostError(e).code !== "cancelled") toast.show(hostError(e).message || "Couldn't change the lock.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="App lock" description={unavailable ? `${deviceWords().Here} has no ${deviceWords().ios ? "Face ID or passcode" : shell()?.platform === "android" ? "fingerprint, face or screen lock" : "Touch ID"}, or it isn't set up in ${deviceWords().settings}, so Folevi can't lock.` : `Folevi asks for ${name} when it opens, and when you come back to it. It covers your notes until then.`}>
      <div className="grid gap-4" data-testid="library-lock">
        <div className="flex items-center justify-between gap-4">
          <span id={descId} className="text-sm text-ink">
            Lock Folevi with {name}
          </span>
          <Switch checked={settings.lock} onChange={(on) => void change({ lock: on })} label={`Lock Folevi with ${name}`} describedBy={descId} disabled={unavailable || busy} />
        </div>
        {settings.lock ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink">Ask again when you come back</span>
            <Select value={String(settings.lockAfter)} onChange={(e) => void change({ lockAfter: Number(e.target.value) })} aria-label="Ask again when you come back" className="ui-input h-9 w-48 rounded-chip px-3 text-sm" disabled={busy}>
              {LOCK_AFTER.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ---- Foli AI (WP11: set up in Settings > AI) and the account -------------------------------------------------------------------

function AiKeysCard() {
  return (
    <Card title="Foli AI" description={`In a library on your devices, Foli AI runs on ${deviceWords().onDeviceModel} on ${deviceWords().here}, or on your own OpenAI, Anthropic or Google key, called straight from ${deviceWords().here}.`}>
      <p className="text-sm text-muted" data-testid="library-ai-keys">
        Choose the model and add your keys in{" "}
        <AppLink href="/settings/ai" className="text-ink underline underline-offset-2">
          Settings, under AI
        </AppLink>
        . Keys stay {shell()?.platform === "android" ? "sealed by the Android Keystore" : "in the Keychain"} on {deviceWords().here}; Folevi never sees them.
      </p>
    </Card>
  );
}

function AccountCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    const flow = signInToFolevi();
    if (!flow) {
      toast.show("Bringing a library into a Folevi account comes in a later update. Your notes stay here meanwhile.");
      return;
    }
    setBusy(true);
    try {
      await flow();
    } catch (e) {
      toast.show(hostError(e).message || "Couldn't sign in. Try again.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Folevi account" description="Sign in to Folevi to share notes and work on them with other people. Your library comes with you into the account.">
      <Button onClick={() => void start()} disabled={busy} data-testid="library-sign-in">
        Sign in to Folevi…
      </Button>
    </Card>
  );
}
