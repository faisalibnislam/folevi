"use client";
// The first launch in the Mac app (later the iPhone and iPad app too): keep notes in a library on this person's
// devices, or sign in to Folevi (docs/LOCAL_MODE_PLAN.md, owner decisions). People handed over from the
// old Mac app never see it: the host starts them in account mode (WP2). Choosing "Keep notes on my devices"
// goes on to LibrarySetup (ShellRoot). No prices, plans or trials here, on any platform.
import { useEffect, useState } from "react";
import { ChevronRight, HardDrive, Loader2 } from "lucide-react";
import { FoleviLogo, FoleviMark } from "@/components/brand/FoleviMark";
import { shell, type Backend } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import { inAndroidApp, inIosApp } from "@/lib/nativeApp";

/**
 * The iPhone, iPad and Android apps draw the screens before the app as their own (docs/IOS_POLISH_PLAN.md §3
 * "Sign-in, first run"): the grouped background, one card style for every choice, iOS's type sizes. The Mac
 * app and the website keep theirs.
 */
export function mobileApp(): boolean {
  return inIosApp() || inAndroidApp();
}

/** The page behind the screens before the app: the grouped background in the phone and tablet apps. */
export const PRE_APP_PAGE = "ui-neutral-chrome grid min-h-dvh place-items-center px-4 py-10 sm:px-6";
export const preAppBackground = () => (mobileApp() ? "bg-[var(--iphone-grouped)]" : "bg-canvas");
/** A screen's title before the app: Spectral, 34 in the phone and tablet apps (the large title), 32 elsewhere. */
export const preAppTitle = () => (mobileApp() ? "font-display text-[34px] font-semibold leading-[41px] tracking-[-0.02em] text-heading" : "font-display text-[2rem] leading-tight text-heading");

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
    <main id="main" tabIndex={-1} data-pre-app="" className={`${PRE_APP_PAGE} ${preAppBackground()}`} data-testid="mode-choice">
      <div className="grid w-full max-w-md gap-8">
        <div className="grid justify-items-center gap-5 text-center">
          <FoleviLogo height={26} className="text-ink" />
          <h1 className={preAppTitle()}>Where should your notes live?</h1>
        </div>
        <div className="grid gap-3" role="group" aria-label="Where your notes live">
          <ChoiceButton
            icon={<FoleviMark size={24} inverse={!mobileApp()} />}
            title="Sign in to Folevi"
            detail="Your notes in your Folevi account, with sharing."
            emphasis
            busy={busy === "account"}
            disabled={busy !== null}
            onClick={() => void choose("account")}
          />
          <ChoiceButton
            icon={<HardDrive size={20} aria-hidden />}
            title="Keep notes on my devices"
            detail="Free forever. No account."
            busy={busy === "local"}
            disabled={busy !== null}
            onClick={() => void choose("local")}
          />
        </div>
        <p className={`text-center text-[13px] text-muted ${mobileApp() ? "px-4 leading-[18px]" : "leading-relaxed"}`}>
          {shell()?.platform === "android"
            ? `Notes on your devices stay on ${deviceWords().here}, or in Dropbox or Google Drive if you choose. Folevi's servers never see them.`
            : "Notes on your devices stay in a folder you pick, such as iCloud Drive or Dropbox. Folevi's servers never see them."}
        </p>
        {failed ? (
          <p role="alert" className="text-center text-[14px] text-danger">
            That didn't save. Try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}

/**
 * One of the answers: a large button with a line under its name. In the phone and tablet apps every answer is
 * the same card (the one Folevi suggests says so in a caption, rather than being drawn black).
 */
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
  if (mobileApp())
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        disabled={disabled}
        aria-busy={busy || undefined}
        className="flex min-h-[72px] w-full items-center gap-3.5 rounded-container bg-[var(--iphone-row)] px-4 py-3.5 text-left text-ink shadow-[0_0_0_0.5px_var(--iphone-separator),0_1px_3px_rgb(0_0_0/0.05)] outline-none transition-[background-color,transform] duration-150 active:scale-[0.985] active:bg-[color-mix(in_oklab,var(--iphone-row)_92%,var(--color-ink))] focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:opacity-60 motion-reduce:active:scale-100"
      >
        <span className="grid h-10 w-10 flex-none place-items-center rounded-small bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] text-heading">{icon}</span>
        <span className="min-w-0 flex-1">
          {emphasis ? <span className="block text-[13px] font-semibold uppercase leading-[18px] tracking-[0.04em] text-muted">Recommended</span> : null}
          <span className="block text-[17px] font-semibold leading-[22px] text-heading">{title}</span>
          <span className="mt-0.5 block text-[15px] leading-[20px] text-muted">{detail}</span>
        </span>
        {busy ? <Loader2 size={18} aria-hidden className="flex-none animate-spin text-muted motion-reduce:animate-none" /> : <ChevronRight size={18} strokeWidth={2.2} aria-hidden className="flex-none text-faint" />}
      </button>
    );
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
