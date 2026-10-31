"use client";
// An encrypted library this device can't read yet (docs/LOCAL_MODE_PLAN.md §3.9, §3.14 "Locked"): a device
// joining it, or one whose key went after another device changed the passphrase. The passphrase unlocks it
// (the host keeps the key from then on); nothing is read from or written to the library until then.
import { useId, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Button } from "@/components/ui/Button";
import type { LibraryControl } from "@/lib/local/store/types";
import { thisDevice } from "./LibrarySetup";
import { useSystemTheme } from "./ModeChoice";
import { NativeGate } from "@/lib/engine/NativeGate";
import { nativeChrome } from "@/lib/nativeApp";
import { BridgeError } from "@/lib/engine/validate";

export function LockedLibrary({ control, where }: { control: LibraryControl; where: string | null }) {
  useSystemTheme();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const id = useId();
  const submit = async () => {
    if (!passphrase) return setProblem("Enter the passphrase.");
    setBusy(true);
    setProblem(null);
    try {
      const ok = await control.unlock(passphrase);
      if (!ok) setProblem("That passphrase didn't open the library. Check it and try again.");
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "Folevi couldn't reach the library. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
    <NativeGate
      gate="libraryLocked"
      title="Unlock your library"
      message={where ?? ""}
      fields={[{ id: "passphrase", kind: "secret", label: "Passphrase", placeholder: "" }]}
      error={problem ? { code: "wrong_secret", message: problem } : null}
      actions={[
        {
          id: "unlock",
          label: "Unlock",
          style: "primary",
          enabled: !busy,
          run: async (v) => {
            const ok = await control.unlock(v.passphrase ?? "");
            if (!ok) {
              setProblem("That passphrase didn't open the library. Check it and try again.");
              throw new BridgeError("wrong_secret", "That passphrase didn't open the library. Check it and try again.");
            }
          },
        },
      ]}
    />
    <main id="main" tabIndex={-1} className="ui-neutral-chrome grid min-h-dvh place-items-center bg-canvas px-4 py-10 sm:px-6" data-testid="library-locked">
      <form
        className="grid w-full max-w-sm gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid justify-items-center gap-5 text-center">
          <FoleviLogo height={26} className="text-ink" />
          <span className="grid h-12 w-12 place-items-center rounded-panel bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] text-heading">
            <Lock size={22} aria-hidden />
          </span>
          <h1 className="font-display text-large-title text-heading">Enter your library's passphrase</h1>
          <p className="text-body leading-relaxed text-muted">
            This library{where ? <> in <span className="font-medium text-ink">{where}</span></> : null} is encrypted. Folevi needs the passphrase once on {thisDevice()} to read it.
          </p>
        </div>
        <label className="grid gap-1 text-subheadline text-muted" htmlFor={`${id}-p`}>
          Passphrase
          <input
            id={`${id}-p`}
            type="password"
            autoComplete="current-password"
            // (Under a native frame's own screen the page stays hidden: its field mustn't take the keyboard.)
            autoFocus={!nativeChrome()}
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
              setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            className="ui-input h-11 rounded-chip px-3 text-body text-ink"
          />
        </label>
        {problem ? (
          <p id={`${id}-problem`} role="alert" className="-mt-3 text-body text-danger">
            {problem}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="h-11 w-full text-body" disabled={busy}>
          {busy ? <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Unlock
        </Button>
        <div className="grid justify-items-center gap-2 text-center">
          <Button variant="quiet" size="sm" aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            Forgot the passphrase?
          </Button>
          {help ? (
            <p className="text-subheadline leading-relaxed text-muted">
              Nobody can reset it, Folevi included. If another device still opens this library, change the passphrase there in Settings, under Library. Without any device that opens it, the synced copy can't be read.
            </p>
          ) : null}
        </div>
      </form>
    </main>
    </>
  );
}
