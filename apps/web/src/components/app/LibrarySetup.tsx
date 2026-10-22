"use client";
// Where a new local library lives (docs/LOCAL_MODE_PLAN.md owner decisions, §3.1, WP10): right after "Keep
// notes on my devices", and whenever the host says no place is set up yet (`library.info().configured`).
//
//   1. The place: Sync with iCloud (on the Mac for now a "Folevi" folder in iCloud Drive), Sync with Dropbox,
//      Sync with Google Drive (each only when this build has its client id; signing in happens in the
//      browser), Choose a folder, or This device only. `library.setup` makes or opens the library there.
//   2. If that place already held a library (notes or other devices in it), this device joins it: no
//      welcome notes, and LocalGate shows "Joining your library…" while the catalog fills the list.
//      A brand-new library gets the welcome notes, and may be encrypted with a passphrase first.
//
// The place list is also Settings > Library's "Move library" (PlaceList).
import { useEffect, useId, useState } from "react";
import { ArrowLeft, Cloud, Folder, HardDrive, Loader2, Lock, ShieldAlert } from "lucide-react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Switch } from "@/components/ui/Switch";
import { shell } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import type { CloudProvider, LibraryInfo, LibraryKind, ShellLibrary } from "@/lib/shell/types";
import { useCloudStatus } from "@/lib/local/useLibrary";
import { holdsLibrary, hostError, placeProblem, providerName, providerOf, rememberSetupIntent } from "@/lib/local/libraryPlace";
import { ChoiceButton, useSystemTheme } from "./ModeChoice";

export const MIN_PASSPHRASE = 8;

/** Whether this host can encrypt a library with a passphrase (not in Folevi for Android yet). */
export function passphraseHere(): boolean {
  return shell()?.platform !== "android";
}

/** "this Mac" on the Mac, "this phone" in the Android app, "this device" elsewhere. */
export function thisDevice(): string {
  const platform = shell()?.platform;
  return platform === "android" || platform === "ios" ? deviceWords().here : "this Mac";
}

interface Place {
  kind: LibraryKind;
  title: string;
  detail: string;
  icon: React.ReactNode;
}

function places(available: CloudProvider[] | null): Place[] {
  const device = thisDevice();
  // Android: Dropbox, Google Drive or this phone only (docs/ANDROID_PLAN.md: no iCloud, no folder picker), and
  // the provider's sign-in opens over the app rather than in a separate browser.
  if (shell()?.platform === "android") {
    const out: Place[] = [];
    if (available?.includes("dropbox")) out.push({ kind: "dropbox", title: "Sync with Dropbox", detail: "Sign in to Dropbox. Folevi only uses its own folder, Apps › Folevi.", icon: <DropboxGlyph /> });
    if (available?.includes("googleDrive")) out.push({ kind: "gdrive", title: "Sync with Google Drive", detail: "Sign in to Google. Folevi only sees the files it makes.", icon: <DriveGlyph /> });
    out.push({ kind: "device", title: `${deviceWords().Here} only`, detail: `Your notes stay on ${deviceWords().here}. You can turn on sync later in Settings.`, icon: <HardDrive size={20} aria-hidden /> });
    return out;
  }
  const icloud = shell()?.platform === "ios" ? "The Folevi folder in iCloud Drive, on every iPhone, iPad and Mac signed in to your iCloud account." : "A Folevi folder in iCloud Drive, on every Mac signed in to your iCloud account.";
  const out: Place[] = [{ kind: "icloud", title: "Sync with iCloud", detail: icloud, icon: <Cloud size={20} aria-hidden /> }];
  if (available?.includes("dropbox")) out.push({ kind: "dropbox", title: "Sync with Dropbox", detail: `Sign in to Dropbox in ${deviceWords().signInPlace}. Folevi only uses its own folder, Apps › Folevi.`, icon: <DropboxGlyph /> });
  if (available?.includes("googleDrive")) out.push({ kind: "gdrive", title: "Sync with Google Drive", detail: `Sign in to Google in ${deviceWords().signInPlace}. Folevi only sees the files it makes.`, icon: <DriveGlyph /> });
  out.push(
    { kind: "folder", title: "Choose a folder", detail: shell()?.platform === "ios" ? "Any folder the Files app offers, such as one in Dropbox, Google Drive or OneDrive." : `Any folder on ${device}, such as one OneDrive or another app keeps in sync.`, icon: <Folder size={20} aria-hidden /> },
    { kind: "device", title: "This device only", detail: `Your notes stay on ${device}. You can turn on sync later in Settings.`, icon: <HardDrive size={20} aria-hidden /> },
  );
  return out;
}

/** Simple outline marks, not the providers' logos (neutral chrome, no brand art). */
function DropboxGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
      <path d="M7 3.5 2.5 6.5 7 9.5l5-3zM17 3.5l-5 3 5 3 4.5-3zM2.5 12.5 7 15.5l5-3-5-3zM17 9.5l-5 3 5 3 4.5-3zM7 17l5 3.5 5-3.5-5-3z" />
    </svg>
  );
}
function DriveGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
      <path d="M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14zM8.5 3.5l6 10.5H2.5M15.5 3.5 9.5 14l-3.5 6M21.5 14h-7l3.5 6" />
    </svg>
  );
}

type Busy = { kind: LibraryKind; connecting: CloudProvider | null } | null;

/**
 * Runs one place's setup: signs in to the provider first when it's Dropbox or Google Drive (unless it already
 * is), then `run` (library.setup or library.move). Null when the person cancelled the picker or the sign-in.
 */
async function withPlace<T>(kind: LibraryKind, library: ShellLibrary, onConnecting: (p: CloudProvider | null) => void, run: () => Promise<T | null>): Promise<T | null> {
  const provider = providerOf(kind);
  if (provider) {
    const cloud = library.cloud;
    if (!cloud) throw new Error(`${providerName(provider)} isn't in this build of Folevi.`);
    const s = await cloud.status();
    if (!(s.provider === provider && s.state === "connected")) {
      onConnecting(provider);
      try {
        await cloud.connect(provider);
      } catch (e) {
        if (hostError(e).code === "cancelled") return null;
        throw e;
      } finally {
        onConnecting(null);
      }
    }
  }
  return await run();
}

/**
 * The list of places, for the first launch and for Move library. `onPick` gets the kind once the person
 * chose (and signed in to the provider, if it's one); it does the work. `current` is left out of the list.
 */
export function PlaceList({ onPick, current, label }: { onPick: (kind: LibraryKind, onConnecting: (p: CloudProvider | null) => void) => Promise<string | null>; current?: LibraryKind; label: string }) {
  const cloud = useCloudStatus();
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ kind: LibraryKind; text: string } | null>(null);
  const list = places(cloud?.available ?? null).filter((p) => p.kind !== current);
  const pick = async (kind: LibraryKind) => {
    setProblem(null);
    setBusy({ kind, connecting: null });
    try {
      const text = await onPick(kind, (connecting) => setBusy({ kind, connecting }));
      if (text) setProblem({ kind, text });
    } catch (e) {
      setProblem({ kind, text: placeProblem(kind, e) });
    } finally {
      setBusy(null);
    }
  };
  if (busy?.connecting) return <Connecting provider={busy.connecting} />;
  return (
    <div className="grid gap-2.5">
      <div role="group" aria-label={label} className="grid gap-2.5">
        {list.map((p) => (
          <ChoiceButton key={p.kind} testId={`place-${p.kind}`} icon={p.icon} title={p.title} detail={p.detail} busy={busy?.kind === p.kind} disabled={busy !== null} onClick={() => void pick(p.kind)} />
        ))}
      </div>
      {problem ? (
        <p role="alert" className="rounded-control bg-[color-mix(in_oklab,var(--color-danger)_9%,transparent)] px-3.5 py-3 text-[13.5px] leading-snug text-ink">
          {problem.text}
        </p>
      ) : null}
    </div>
  );
}

/** Waiting for the provider's sign-in in the browser, with a way out. */
function Connecting({ provider }: { provider: CloudProvider }) {
  const [cancelling, setCancelling] = useState(false);
  const name = providerName(provider);
  return (
    <div role="status" aria-live="polite" className="grid justify-items-center gap-4 rounded-control border border-line bg-surface px-5 py-8 text-center" data-testid="cloud-connecting">
      <Loader2 size={22} aria-hidden className="animate-spin text-heading motion-reduce:animate-none" />
      <div className="grid gap-1.5">
        <p className="text-[15px] font-semibold text-heading">Finish signing in to {name} in {deviceWords().ios ? "the sign-in sheet" : "your browser"}</p>
        <p className="text-[13.5px] leading-snug text-muted">Folevi opened {name}'s sign-in page. Once you allow access there, come back here. Folevi only gets its own folder.</p>
      </div>
      <Button
        disabled={cancelling}
        onClick={() => {
          setCancelling(true);
          void shell()
            ?.library.cloud?.cancel()
            .finally(() => setCancelling(false));
        }}
      >
        Cancel
      </Button>
    </div>
  );
}

/** The passphrase fields and their warnings, for a new library here and for Settings > Library. */
export function PassphraseFields({
  passphrase,
  confirm,
  understood,
  onPassphrase,
  onConfirm,
  onUnderstood,
  problem,
  newLabel = "Passphrase",
}: {
  passphrase: string;
  confirm: string;
  understood: boolean;
  onPassphrase: (v: string) => void;
  onConfirm: (v: string) => void;
  onUnderstood: (v: boolean) => void;
  problem: string | null;
  newLabel?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-3">
      <div className="flex gap-2.5 rounded-control bg-[color-mix(in_oklab,var(--color-danger)_9%,transparent)] px-3.5 py-3 text-[13.5px] leading-snug text-ink" id={`${id}-warning`}>
        <ShieldAlert size={18} aria-hidden className="mt-px flex-none text-danger" />
        <p>
          <strong className="font-semibold">If you lose this passphrase, nobody can open the synced copy of your notes.</strong> Folevi can't reset it or recover it. Write it down and keep it somewhere safe.
        </p>
      </div>
      <label className="grid gap-1 text-[13px] text-muted" htmlFor={`${id}-p`}>
        {newLabel}
        <input id={`${id}-p`} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => onPassphrase(e.target.value)} className="ui-input h-10 rounded-chip px-3 text-[15px] text-ink" aria-describedby={`${id}-hint`} />
      </label>
      <label className="grid gap-1 text-[13px] text-muted" htmlFor={`${id}-c`}>
        Type it again
        <input id={`${id}-c`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} className="ui-input h-10 rounded-chip px-3 text-[15px] text-ink" />
      </label>
      <p id={`${id}-hint`} className="text-[12.5px] text-muted">
        Use at least {MIN_PASSPHRASE} characters. A few unrelated words are easy to remember and hard to guess.
      </p>
      <Checkbox checked={understood} onChange={onUnderstood} describedBy={`${id}-warning`}>
        I understand Folevi can't recover a lost passphrase
      </Checkbox>
      {problem ? (
        <p role="alert" className="text-[13.5px] text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** What's wrong with a new passphrase, or null. */
export function passphraseProblem(passphrase: string, confirm: string, understood: boolean): string | null {
  if (passphrase.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  if (passphrase !== confirm) return "The two passphrases don't match.";
  if (!understood) return "Tick the box to say you understand a lost passphrase can't be recovered.";
  return null;
}

/**
 * The first-launch setup. `onDone` opens the product (the host may reload into local mode first). `onBack`
 * goes back to the choice between local mode and an account; absent when there's nothing to go back to.
 */
export function LibrarySetup({ onDone, onBack }: { onDone: (result: { joining: boolean }) => Promise<void>; onBack?: () => void }) {
  useSystemTheme();
  const library = shell()?.library ?? null;
  // A new library, set up and waiting for "Open Folevi" (and maybe a passphrase first).
  const [made, setMade] = useState<LibraryInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = async (kind: LibraryKind, onConnecting: (p: CloudProvider | null) => void): Promise<string | null> => {
    if (!library) return "There's no library on this device to set up.";
    const info = await withPlace(kind, library, onConnecting, () => library.setup({ kind }));
    if (!info) return null;
    if (await holdsLibrary(library)) {
      rememberSetupIntent("join");
      await onDone({ joining: true });
      return null;
    }
    rememberSetupIntent("new");
    setMade(info);
    return null;
  };

  return (
    <main id="main" tabIndex={-1} className="ui-neutral-chrome grid min-h-dvh place-items-center bg-canvas px-4 py-10 sm:px-6" data-testid="library-setup">
      <div className="grid w-full max-w-md gap-7">
        <div className="grid justify-items-center gap-5 text-center">
          <FoleviLogo height={26} className="text-ink" />
          {made ? (
            <>
              <h1 className="font-display text-[2rem] leading-tight text-heading">Your library is ready</h1>
              <p className="text-[14px] leading-relaxed text-muted">
                Folevi keeps your notes as files in <span className="font-medium text-ink">{made.displayPath}</span>.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-[2rem] leading-tight text-heading">Where should your library live?</h1>
              <p className="text-[14px] leading-relaxed text-muted">Folevi keeps your notes as files in one folder. Pick where that folder goes. If the place already holds your Folevi library, Folevi opens it.</p>
            </>
          )}
        </div>
        {made ? (
          <NewLibrary
            info={made}
            onOpen={async (passphrase) => {
              setFailed(null);
              try {
                if (passphrase && library) await library.setPassphrase(passphrase);
                await onDone({ joining: false });
              } catch (e) {
                setFailed(hostError(e).message || "That didn't work. Try again.");
              }
            }}
            onElsewhere={() => setMade(null)}
            failed={failed}
          />
        ) : (
          <PlaceList label="Where your library lives" onPick={pick} />
        )}
        {onBack && !made ? (
          <div className="flex justify-center">
            <Button
              variant="quiet"
              onClick={() => {
                // A sign-in still waiting in the browser stops too.
                void shell()?.library.cloud?.cancel().catch(() => undefined);
                onBack();
              }}
            >
              <ArrowLeft size={15} aria-hidden /> Back
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** A brand-new library: optional encryption, then into the app. */
function NewLibrary({ info, onOpen, onElsewhere, failed }: { info: LibraryInfo; onOpen: (passphrase: string | null) => Promise<void>; onElsewhere: () => void; failed: string | null }) {
  const [encrypt, setEncrypt] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const descId = useId();
  useEffect(() => setProblem(null), [passphrase, confirm, understood, encrypt]);
  const synced = info.kind !== "device";
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (encrypt) {
          const p = passphraseProblem(passphrase, confirm, understood);
          if (p) return setProblem(p);
        }
        setBusy(true);
        void onOpen(encrypt ? passphrase : null).finally(() => setBusy(false));
      }}
    >
      {passphraseHere() ? <section className="grid gap-3 rounded-control border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-small bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] text-ink">
            <Lock size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-heading" aria-hidden>
              Encrypt with a passphrase
            </p>
            <p id={descId} className="mt-0.5 text-[13px] leading-snug text-muted">
              {synced ? "Optional. The synced copy can't be read without it, by anyone, including Folevi." : "Optional. The library's files can't be read without it, by anyone, including Folevi."}
            </p>
          </div>
          <Switch checked={encrypt} onChange={setEncrypt} label="Encrypt with a passphrase" describedBy={descId} />
        </div>
        {encrypt ? <PassphraseFields passphrase={passphrase} confirm={confirm} understood={understood} onPassphrase={setPassphrase} onConfirm={setConfirm} onUnderstood={setUnderstood} problem={problem} /> : null}
      </section> : null}
      {failed ? (
        <p role="alert" className="text-center text-[13.5px] text-danger">
          {failed}
        </p>
      ) : null}
      <div className="grid gap-2">
        <Button type="submit" variant="primary" className="h-11 w-full text-[15px]" disabled={busy}>
          {busy ? <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {busy && encrypt ? "Encrypting…" : "Open Folevi"}
        </Button>
        <Button variant="quiet" onClick={onElsewhere} disabled={busy}>
          Choose another place
        </Button>
      </div>
    </form>
  );
}

/** Settings > Library's "Move library": the same places, then `library.move`. */
export async function movePlace(kind: LibraryKind, onConnecting: (p: CloudProvider | null) => void): Promise<LibraryInfo | null> {
  const library = shell()?.library;
  if (!library) throw new Error("There's no library on this device.");
  return await withPlace(kind, library, onConnecting, () => library.move({ kind }));
}
