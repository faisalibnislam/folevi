"use client";
// The first launch in the Mac app (later the iPhone and iPad app too): keep notes in a library on this person's
// devices, or sign in to Folevi (docs/LOCAL_MODE_PLAN.md, owner decisions). People handed over from the
// old Mac app never see it: the host starts them in account mode (WP2). Choosing "Keep notes on my devices"
// goes on to LibrarySetup (ShellRoot). No prices, plans or trials here, on any platform.
import { useEffect, useState } from "react";
import { ChevronRight, HardDrive, Loader2, UserRound } from "lucide-react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import type { Backend } from "@/lib/shell";

/**
 * The screens before the app (this one, LibrarySetup, LockedLibrary) follow the Mac's light or dark look as it
 * changes; the theme boot script only read it once, and the app's own appearance setting isn't loaded yet.
 */
export function useSystemTheme() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      let chosen: string | null = null;
      try {
        chosen = localStorage.getItem("folevi:appearance");
      } catch {
        // No storage: follow the system.
      }
      if (chosen !== "light" && chosen !== "dark") document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}

export function ModeChoice({ onChoose }: { onChoose: (mode: Backend) => Promise<void> }) {
  useSystemTheme();
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
    <main id="main" tabIndex={-1} className="ui-neutral-chrome grid min-h-dvh place-items-center bg-canvas px-4 py-10 sm:px-6" data-testid="mode-choice">
      <div className="grid w-full max-w-md gap-8">
        <div className="grid justify-items-center gap-5 text-center">
          <FoleviLogo height={26} className="text-ink" />
          <h1 className="font-display text-[2rem] leading-tight text-heading">Where should your notes live?</h1>
        </div>
        <div className="grid gap-3" role="group" aria-label="Where your notes live">
          <ChoiceButton
            icon={<HardDrive size={20} aria-hidden />}
            title="Keep notes on my devices"
            detail="Free forever. No account."
            emphasis
            busy={busy === "local"}
            disabled={busy !== null}
            onClick={() => void choose("local")}
          />
          <ChoiceButton
            icon={<UserRound size={20} aria-hidden />}
            title="Sign in to Folevi"
            detail="Your notes in your Folevi account, with sharing."
            busy={busy === "account"}
            disabled={busy !== null}
            onClick={() => void choose("account")}
          />
        </div>
        <p className="text-center text-[13px] leading-relaxed text-muted">Notes on your devices stay in a folder you pick, such as iCloud Drive or Dropbox. Folevi's servers never see them.</p>
        {failed ? (
          <p role="alert" className="text-center text-[14px] text-danger">
            That didn't save. Try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** One of the two answers: a large button with a line under its name. */
export function ChoiceButton({
  icon,
  title,
  detail,
  emphasis,
  busy,
  disabled,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  detail: React.ReactNode;
  emphasis?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={`group flex min-h-16 w-full items-center gap-3.5 rounded-control border px-4 py-3.5 text-left outline-none transition-[background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:opacity-60 ${
        emphasis ? "border-transparent bg-heading text-canvas hover:bg-[color-mix(in_oklab,var(--color-heading)_88%,var(--color-canvas))]" : "border-line bg-surface text-ink hover:bg-[var(--glass-hover)]"
      }`}
    >
      <span className={`grid h-10 w-10 flex-none place-items-center rounded-small ${emphasis ? "bg-[color-mix(in_oklab,var(--color-canvas)_14%,transparent)]" : "bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)]"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug">{title}</span>
        <span className={`mt-0.5 block text-[13px] leading-snug ${emphasis ? "opacity-80" : "text-muted"}`}>{detail}</span>
      </span>
      {busy ? (
        <Loader2 size={18} aria-hidden className="flex-none animate-spin motion-reduce:animate-none" />
      ) : (
        <ChevronRight size={18} aria-hidden className="flex-none opacity-60 transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}
