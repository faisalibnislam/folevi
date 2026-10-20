"use client";
// The first launch in the Mac app (and later the iPhone and iPad app): keep notes on this device's library, or
// sign in to Folevi (docs/LOCAL_MODE_PLAN.md, owner decisions). A placeholder for the shell build (WP1): the
// mode UI work package (WP10) replaces it with the designed screen and the library setup that follows it.
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import type { Backend } from "@/lib/shell";

export function ModeChoice({ onChoose }: { onChoose: (mode: Backend) => Promise<void> }) {
  const [busy, setBusy] = useState<Backend | null>(null);
  const [failed, setFailed] = useState(false);
  const choose = async (mode: Backend) => {
    setBusy(mode);
    setFailed(false);
    try {
      await onChoose(mode);
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };
  return (
    <main id="main" tabIndex={-1} className="ui-neutral-chrome grid min-h-dvh place-items-center bg-canvas px-6" data-testid="mode-choice">
      <div className="grid w-full max-w-sm justify-items-center gap-8 text-center">
        <FoleviLogo height={28} className="text-ink" />
        <h1 className="font-display text-3xl leading-tight text-ink">Where should your notes live?</h1>
        <div className="grid w-full gap-3">
          <Button variant="primary" className="h-auto min-h-14 w-full flex-col gap-0.5 py-3" disabled={busy !== null} onClick={() => void choose("local")}>
            <span className="text-[15px] font-medium">Keep notes on my devices</span>
            <span className="text-[13px] opacity-80">Free forever. No account.</span>
          </Button>
          <Button variant="secondary" className="h-auto min-h-12 w-full py-3 text-[15px]" disabled={busy !== null} onClick={() => void choose("account")}>
            Sign in to Folevi
          </Button>
        </div>
        {failed ? (
          <p role="alert" className="text-[14px] text-muted">
            That didn’t save. Try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}
