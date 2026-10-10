"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Files, Link2, MessageSquareText, Monitor, Moon, Paintbrush, PenLine, Sparkles, Sun, SunMoon, Users, WifiOff, type LucideIcon } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { COVER_ART } from "@/lib/cover";
import { MONTHLY_CREDITS, TIER_NAMES, TRIAL_CREDITS, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";
import { ONBOARDING_NOTE_STYLES, PLAIN_STYLE, USE_CASES, isOnboardingNoteStyle, starterPagesFor, type OnboardingStep } from "@/lib/onboarding";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { errorMessage } from "@/components/ui/Toast";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { AiIcon } from "@/components/ai/AiIcon";
import { captureTemplateFromUrl, pendingTemplate } from "@/lib/pendingTemplate";
import { OnboardingPreview, artOf, artThumb, type PreviewScene } from "./onboarding/OnboardingPreview";
import "./onboarding/onboarding.css";

/** The steps, in order, and the server step each one completes (convex/lib/onboarding.ts). */
const STEPS = [
  { key: "workspace", name: "Welcome" },
  { key: "uses", name: "Your pages" },
  { key: "style", name: "Note theme" },
  { key: "appearance", name: "Appearance" },
  { key: "ai", name: "Foli" },
  { key: "welcome", name: "Ready" },
] as const;
const LAST = STEPS.length - 1;
const WELCOME = "Welcome to Folevi";
type Appearance = "light" | "dark" | "system";

function stepIndexOf(step: OnboardingStep): number {
  const i = STEPS.findIndex((s) => s.key === step);
  // "done": someone opened /onboarding again, so start from the top.
  return i < 0 ? 0 : i;
}

const styleName = (id: string | null) => (id && id !== PLAIN_STYLE ? (artOf(id)?.name ?? "Plain") : "Plain");
const listOf = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function Onboarding() {
  const { profile, setContext, setAppearance, appearance } = useAppState();
  const { navigate } = useAppRouter();
  const complete = useMutation(api.users.completeOnboardingStep);
  // A new account starts in Personal, where its first pages were added.
  const docs = useQuery(api.documents.list, { scope: { kind: "personal" }, view: "all", paginationOpts: { numItems: 50, cursor: null } });
  const welcome = docs?.page.find((d) => d.title === WELCOME) ?? null;
  // A template picked on folevi.com before signing up (lib/pendingTemplate), opened when onboarding ends.
  const [template] = useState(() => {
    if (typeof window === "undefined") return null;
    captureTemplateFromUrl(); // arriving from the confirmation email, possibly on another device
    return pendingTemplate();
  });

  const [step, setStep] = useState(() => stepIndexOf(profile.onboardingStep));
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const applied = profile.onboardingUseCases ?? [];
  const [picks, setPicks] = useState<string[]>(applied);
  const [lastPick, setLastPick] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<string>(PLAIN_STYLE);
  const [ai, setAi] = useState(profile.aiEnabled);
  // The chosen appearance (the radios follow it at once; the theme itself may change a frame later).
  const [look, setLook] = useState<Appearance>(appearance);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const first = useRef(true);

  // The Welcome page's current theme, once it has loaded (a reload resumes with it).
  const savedStyle = welcome ? (welcome.cover.kind === "art" && welcome.cover.value ? welcome.cover.value : PLAIN_STYLE) : null;
  const styleLoaded = useRef(false);
  useEffect(() => {
    if (savedStyle === null || styleLoaded.current) return;
    styleLoaded.current = true;
    setStyleId(savedStyle);
  }, [savedStyle]);

  // Each step's heading takes focus, so screen readers announce where they are.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (step === 0) return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const go = (to: number) => {
    setDir(to < step ? "back" : "forward");
    setError(null);
    setStep(Math.max(0, Math.min(LAST, to)));
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  type Args = Parameters<typeof complete>[0];
  const saveAndGo = (args: Args, to = step + 1) => void run(async () => {
    await complete(args);
    go(to);
  });

  const cont = () => {
    switch (step) {
      case 0:
        return saveAndGo({ step: "workspace" });
      case 1:
        return saveAndGo(picks.length ? { step: "uses", useCases: picks } : { step: "uses" });
      case 2:
        return saveAndGo(isOnboardingNoteStyle(styleId) ? { step: "style", noteStyle: styleId } : { step: "style" });
      case 3:
        return saveAndGo({ step: "appearance", appearance: look });
      case 4:
        return saveAndGo({ step: "ai", aiEnabled: ai });
      default:
        return void run(async () => {
          await complete({ step: "welcome" });
          setContext({ kind: "personal" });
          // A template picked on folevi.com opens next (Shell creates it); otherwise the Welcome page.
          navigate(template ? "/documents" : welcome ? `/d/${welcome.id}` : "/documents", { replace: true });
        });
    }
  };

  /** Leaves this step's choice as it was saved, and moves on. */
  const skip = () => {
    if (step === 1) setPicks(applied);
    if (step === 2 && savedStyle) setStyleId(savedStyle);
    if (step === 3) {
      setLook(profile.appearance);
      setAppearance(profile.appearance);
    }
    if (step === 4) setAi(profile.aiEnabled);
    saveAndGo({ step: STEPS[step]!.key as Exclude<Args["step"], "welcome"> });
  };

  /** Skips everything left and goes to the summary. */
  const skipAll = () => {
    setPicks(applied);
    if (savedStyle) setStyleId(savedStyle);
    setLook(profile.appearance);
    setAppearance(profile.appearance);
    setAi(profile.aiEnabled);
    saveAndGo({ step: "ai" }, LAST);
  };

  /** Switches the theme live; where supported, the new theme spreads out from the chosen card. */
  const pickAppearance = (value: Appearance, from: HTMLElement | null) => {
    if (value === look) return;
    setLook(value);
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce || !from) {
      setAppearance(value);
      return;
    }
    const r = from.getBoundingClientRect();
    const root = document.documentElement;
    root.style.setProperty("--ob-vt-x", `${r.left + r.width / 2}px`);
    root.style.setProperty("--ob-vt-y", `${r.top + r.height / 2}px`);
    root.classList.add("ob-vt");
    const t = doc.startViewTransition(() => flushSync(() => setAppearance(value)));
    void t.finished.finally(() => root.classList.remove("ob-vt"));
  };

  const pages = starterPagesFor(picks);
  const chosenArt = styleId !== PLAIN_STYLE ? styleId : null;
  const scene: PreviewScene = step === 0 ? "deck" : step === 1 ? "home" : "note";
  const ambient = step === 0 ? "art-03" : step === 1 ? (lastPick ?? (picks.length ? (USE_CASES.find((u) => u.id === picks[picks.length - 1])?.art ?? null) : null)) : chosenArt;
  const previewLabel =
    step === 0
      ? "Five note themes fanned out like cards: Cypresses, Summer sky, Irises, Poppy print and Aurora."
      : step === 1
        ? `A preview of your Home${pages.length ? ` with ${pages.length} new starter pages: ${listOf(pages.map((p) => p.title))}` : ""}.`
        : `A preview of your “${WELCOME}” page in the ${styleName(styleId)} theme${step === 4 && ai ? ", with Foli open" : ""}.`;
  const preview = (compact: boolean) => (
    <OnboardingPreview
      scene={scene}
      styleId={chosenArt}
      ambientId={ambient}
      pages={pages}
      ai={step >= 4 ? ai : profile.aiEnabled}
      highlight={step === 2 ? "style" : step === 4 ? "ai" : null}
      finished={step === LAST}
      name={profile.displayName}
      compact={compact}
      label={previewLabel}
    />
  );

  const firstName = profile.displayName.trim().split(/\s+/)[0] || profile.displayName;
  const heading = [
    `Welcome, ${firstName}.`,
    "What will you use Folevi for?",
    "Pick a theme for your first page",
    "Light or dark?",
    "Meet Foli",
    "Your Folevi is ready.",
  ][step]!;
  const lede = [
    "Folevi is a notes app for documents, tasks and linked pages. Let’s set up your Personal space. It takes about a minute.",
    "Pick any that fit. Each one adds two starter pages made from Folevi’s templates, next to the pages we already made for you.",
    `A note theme gives a page its cover, paper and text colours. This one is for “${WELCOME}”. New pages start Plain.`,
    "The app around your notes stays white, or near-black in dark mode, so your notes carry the colour. You can change this in Settings.",
    "It answers questions from your notes and links the notes it used, so you can check the answer.",
    "Here’s what we set up. Your Welcome page has a short tour and a few things to try.",
  ][step]!;

  return (
    <main id="main" tabIndex={-1} className="ob-root min-h-dvh outline-none lg:grid lg:grid-cols-[minmax(460px,600px)_minmax(0,1fr)]">
      <div className="flex min-h-dvh flex-col px-4 pt-4 sm:px-10 sm:pt-8 lg:px-14 lg:pt-10">
        <header className="flex h-9 items-center justify-between gap-3">
          <FoleviLogo height={26} className="text-heading" />
          {step < LAST ? (
            <Button variant="quiet" size="sm" disabled={busy} onClick={skipAll}>
              Skip setup
            </Button>
          ) : null}
        </header>

        <Progress step={step} />

        <div className="mt-5 h-[228px] flex-none overflow-hidden rounded-container sm:h-[300px] lg:hidden">{preview(true)}</div>

        <form
          className="flex flex-1 flex-col"
          aria-labelledby={headingId}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) cont();
          }}
        >
          <div key={step} className="ob-step flex-1 pb-8 pt-7 lg:pt-12" data-dir={dir}>
            {step === 4 ? (
              <span className="ob-ai-mark mb-5 inline-grid size-14 place-items-center rounded-container bg-surface shadow-[var(--shadow-card)]" data-on={ai}>
                <AiIcon size={30} />
              </span>
            ) : null}
            <h1 ref={headingRef} id={headingId} tabIndex={-1} className="ui-display max-w-[16ch] text-[34px] leading-[1.06] outline-none sm:text-[44px]">
              {heading}
            </h1>
            <p className="mt-3.5 max-w-[46ch] text-[15.5px] leading-relaxed text-muted">{lede}</p>

            <div className="mt-7">
              {step === 0 ? <IntroFacts /> : null}
              {step === 1 ? <UseCases headingId={headingId} picks={picks} applied={applied} onToggle={(id, on) => { setPicks((p) => (on ? [...p, id] : p.filter((x) => x !== id))); setLastPick(on ? (USE_CASES.find((u) => u.id === id)?.art ?? null) : null); }} /> : null}
              {step === 2 ? <Styles headingId={headingId} value={styleId} onPick={setStyleId} /> : null}
              {step === 3 ? (
                <>
                  <Appearances headingId={headingId} value={look} styleId={chosenArt} onPick={pickAppearance} />
                  <p className="mt-4 text-[13px] text-muted">Match system follows your device, so Folevi turns dark when your device does.</p>
                </>
              ) : null}
              {step === 4 ? <AiChoice on={ai} onChange={setAi} entitlements={profile.entitlements} /> : null}
              {step === LAST ? <Summary pages={starterPagesFor(applied).map((p) => p.title)} style={styleName(savedStyle ?? styleId)} appearance={profile.appearance} ai={profile.aiEnabled} /> : null}
            </div>
            {error ? (
              <p role="alert" className="mt-5 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur-md sm:-mx-10 sm:px-10 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-10 lg:pt-4 lg:backdrop-blur-none">
            {step > 0 ? (
              <Button variant="ghost" disabled={busy} onClick={() => go(step - 1)}>
                <ArrowLeft size={16} aria-hidden />
                Back
              </Button>
            ) : null}
            <span className="flex-1" />
            {step >= 1 && step < LAST ? (
              <Button variant="quiet" disabled={busy} onClick={skip}>
                Skip
              </Button>
            ) : null}
            <Button type="submit" variant="primary" disabled={busy || (step === LAST && !docs)} className="min-w-[112px]">
              {step === 0 ? "Get started" : step === LAST ? `Open “${template?.name ?? WELCOME}”` : "Continue"}
              <ArrowRight size={16} aria-hidden />
            </Button>
          </footer>
        </form>
      </div>

      <div className="sticky top-0 hidden h-dvh p-3 pl-0 lg:block">
        <div className="h-full overflow-hidden rounded-container">{preview(false)}</div>
      </div>
    </main>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mt-6 sm:mt-10">
      <ol aria-label="Setup progress" className="grid grid-cols-6 gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === step ? "step" : undefined}>
            <span className="ob-progress-seg block" data-state={i < step ? "done" : i === step ? "current" : "next"} />
            <span className="sr-only">
              Step {i + 1} of {STEPS.length}: {s.name}
              {i < step ? " (done)" : i === step ? " (current)" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p aria-hidden="true" className="mt-3 text-[12.5px] font-medium text-muted">
        <span className="text-heading">{step + 1}</span> of {STEPS.length} · {STEPS[step]!.name}
      </p>
    </div>
  );
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden className="grid size-9 flex-none place-items-center rounded-control bg-surface text-heading shadow-[var(--shadow-card)]">
      <Icon size={17} strokeWidth={1.75} />
    </span>
  );
}

function FactList({ items }: { items: { icon: LucideIcon; title: string; body: ReactNode }[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={item.title} className="ob-rise flex gap-3.5" style={{ ["--i" as string]: i }}>
          <IconTile icon={item.icon} />
          <div className="min-w-0 pt-0.5">
            <p className="text-[14.5px] font-semibold text-heading">{item.title}</p>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IntroFacts() {
  return (
    <FactList
      items={[
        { icon: WifiOff, title: "Works offline", body: "Your writing is saved on this device first, and syncs when you reconnect." },
        { icon: Link2, title: "Pages that link up", body: "Type [[ to link one page to another. The page you link to shows a backlink." },
        { icon: Users, title: "Yours, and easy to share", body: "Personal is your own space. Share single pages with anyone, or start a workspace for a team any time." },
      ]}
    />
  );
}

function CheckGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UseCases({ headingId, picks, applied, onToggle }: { headingId: string; picks: string[]; applied: string[]; onToggle: (id: string, on: boolean) => void }) {
  const pages = starterPagesFor(picks).filter((p) => !starterPagesFor(applied).some((a) => a.template === p.template));
  return (
    <>
      <fieldset aria-labelledby={headingId}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {USE_CASES.map((u, i) => {
            const added = applied.includes(u.id);
            return (
              <label key={u.id} className="ob-choice ob-rise items-center gap-3 p-2 pr-3" style={{ ["--i" as string]: i }}>
                <input type="checkbox" className="ob-input" checked={picks.includes(u.id)} disabled={added} onChange={(e) => onToggle(u.id, e.target.checked)} />
                <span aria-hidden className="size-12 flex-none overflow-hidden rounded-control shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]">
                  <span className="ob-art block size-full" style={{ ["--ob-art" as string]: artThumb(u.art) }} />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[14px] font-semibold text-heading">{u.label}</span>
                  <span className="mt-1 block text-[12.5px] leading-snug text-muted">{added ? "Added" : listOf(u.pages.map((p) => p.title))}</span>
                </span>
                <span aria-hidden className="ob-check">
                  <CheckGlyph />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p aria-live="polite" className="mt-4 min-h-5 text-[13px] text-muted">
        {pages.length ? `Adds ${pages.length} ${pages.length === 1 ? "page" : "pages"}: ${listOf(pages.map((p) => p.title))}.` : applied.length ? "Those pages are in your Personal." : "Nothing picked yet. You can skip this and add templates any time."}
      </p>
    </>
  );
}

function Styles({ headingId, value, onPick }: { headingId: string; value: string; onPick: (id: string) => void }) {
  const ids = [PLAIN_STYLE, ...ONBOARDING_NOTE_STYLES];
  return (
    <>
      <fieldset aria-labelledby={headingId}>
        <div className="grid grid-cols-3 gap-x-3 gap-y-3.5">
          {ids.map((id, i) => (
            <label key={id} className="ob-tile-wrap ob-rise" style={{ ["--i" as string]: i }}>
              <input type="radio" name="note-style" value={id} className="ob-input" checked={value === id} onChange={() => onPick(id)} />
              <span
                aria-hidden
                className="ob-tile"
                style={{ background: id === PLAIN_STYLE ? "var(--color-surface)" : `${artThumb(id)} center / cover no-repeat`, boxShadow: id === PLAIN_STYLE ? "inset 0 0 0 1px var(--color-line)" : undefined }}
              >
                {id === PLAIN_STYLE ? <span className="grid h-full place-items-center font-[family-name:var(--font-display)] text-[26px] font-semibold text-heading">Aa</span> : null}
                <span className="ob-badge">
                  <Check size={13} strokeWidth={2.6} />
                </span>
              </span>
              <span className="mt-1.5 block truncate text-center text-[12.5px] font-medium text-ink">{styleName(id)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-[13px] text-muted">
        {COVER_ART.length} themes in all. Change any page’s theme from Style in the page tools.
      </p>
    </>
  );
}

/** A tiny window in fixed light or dark colours, with the Welcome page in its chosen theme. */
function MiniWindow({ mode, styleId }: { mode: "light" | "dark"; styleId: string | null }) {
  const art = artOf(styleId);
  const paper = art ? (mode === "light" ? art.paper : art.paperDark) : mode === "light" ? "#ffffff" : "#1c1c1e";
  return (
    <span className="absolute inset-0 flex gap-[5%] p-[6%]" style={{ background: "var(--m-bg)" }}>
      <span className="flex w-[26%] flex-col gap-[9%] pt-[4%]">
        <span className="h-[5%] w-3/4 rounded-chip" style={{ background: "var(--m-muted)" }} />
        <span className="h-[5%] w-full rounded-chip" style={{ background: "var(--m-muted)" }} />
        <span className="h-[5%] w-2/3 rounded-chip" style={{ background: "var(--m-muted)" }} />
        <span className="h-[5%] w-5/6 rounded-chip" style={{ background: "var(--m-muted)" }} />
      </span>
      <span className="flex flex-1 flex-col overflow-hidden rounded-tiny shadow-[0_2px_8px_rgb(0_0_0/0.15)]" style={{ background: paper }}>
        {art ? <span className="h-[34%] flex-none" style={{ background: `${artThumb(art.id)} center / cover no-repeat` }} /> : null}
        <span className="flex flex-col gap-[7%] p-[9%]">
          <span className="h-[9px] w-2/3 rounded-tiny" style={{ background: "var(--m-ink)", opacity: 0.85 }} />
          <span className="h-[4px] w-full rounded-tiny" style={{ background: "var(--m-ink)", opacity: 0.25 }} />
          <span className="h-[4px] w-5/6 rounded-tiny" style={{ background: "var(--m-ink)", opacity: 0.25 }} />
        </span>
      </span>
    </span>
  );
}

function Appearances({ headingId, value, styleId, onPick }: { headingId: string; value: Appearance; styleId: string | null; onPick: (v: Appearance, from: HTMLElement | null) => void }) {
  const options: { value: Appearance; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "Match system", icon: Monitor },
  ];
  return (
    <fieldset aria-labelledby={headingId}>
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {options.map((o, i) => (
          <label key={o.value} className="ob-choice ob-rise flex-col gap-2.5 p-2" style={{ ["--i" as string]: i }}>
            <input type="radio" name="appearance" value={o.value} className="ob-input" checked={value === o.value} onChange={(e) => onPick(o.value, e.currentTarget.closest("label"))} />
            <span aria-hidden className="ob-mini block" data-mode={o.value === "dark" ? "dark" : "light"}>
              {o.value === "system" ? (
                <>
                  <MiniWindow mode="light" styleId={styleId} />
                  <span className="ob-mini absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]" data-mode="dark">
                    <MiniWindow mode="dark" styleId={styleId} />
                  </span>
                </>
              ) : (
                <MiniWindow mode={o.value} styleId={styleId} />
              )}
            </span>
            <span className="flex items-center gap-2 px-1 pb-0.5 text-[13.5px] font-semibold text-heading">
              <o.icon size={15} aria-hidden className="flex-none text-muted" />
              <span className="truncate">{o.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Entitlements = ReturnType<typeof useAppState>["profile"]["entitlements"];

function AiChoice({ on, onChange, entitlements }: { on: boolean; onChange: (next: boolean) => void; entitlements: Entitlements }) {
  const descId = useId();
  const ends = entitlements.trialEndsAt ? new Date(entitlements.trialEndsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
  // AI is counted in credits: the trial's fixed allowance, then the plan's monthly credits. Core has none.
  const plan =
    entitlements.ai && entitlements.aiSource === "trial"
      ? `Included in your ${TRIAL_DAYS}-day ${TIER_NAMES[TRIAL_TIER]} trial, with ${TRIAL_CREDITS} AI credits${ends ? ` until ${ends}` : ""}. After that, Free includes ${MONTHLY_CREDITS.free} AI credits a month, and you can choose a plan with more in Settings.`
      : entitlements.ai
        ? `Your plan includes ${entitlements.monthlyCredits} AI credits a month.`
        : `Your plan, ${TIER_NAMES.core}, has no AI: nothing is sent to an AI model. You can change plans in Settings.`;
  return (
    <>
      <FactList
        items={[
          { icon: MessageSquareText, title: "Ask Foli", body: "Ask a question about your notes and get an answer with links to its sources." },
          { icon: Sparkles, title: "Catch me up", body: "On Home, a short brief of your week: recent notes and what’s due." },
          { icon: PenLine, title: "Writing help", body: "Rewrite, shorten, fix or summarize the text you select, or press ⌘J in a note." },
        ]}
      />
      <div className="ob-rise mt-6 flex items-start gap-4 rounded-panel bg-surface p-4 shadow-[var(--shadow-card)]" style={{ ["--i" as string]: 3 }}>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold text-heading">Foli {on ? "on" : "off"}</p>
          <p id={descId} className="mt-1 text-[13px] leading-relaxed text-muted">
            When you use it, your request and the notes it needs are sent to Google Gemini. Nothing is sent while it’s off, and Foli's buttons are hidden.
          </p>
        </div>
        <Switch checked={on} onChange={onChange} label="Foli" describedBy={descId} />
      </div>
      <p className="mt-3.5 text-[13px] text-muted">{plan}</p>
    </>
  );
}

function Summary({ pages, style, appearance, ai }: { pages: string[]; style: string; appearance: Appearance; ai: boolean }) {
  const rows: { icon: ReactNode; title: string; body: string }[] = [
    { icon: <IconTile icon={Files} />, title: pages.length ? `${pages.length} starter ${pages.length === 1 ? "page" : "pages"}` : "Starter pages", body: pages.length ? listOf(pages) : "None this time. You’ll find templates in the sidebar." },
    { icon: <IconTile icon={Paintbrush} />, title: WELCOME, body: style === "Plain" ? "Plain, like every new page" : `In the ${style} theme` },
    { icon: <IconTile icon={SunMoon} />, title: "Appearance", body: appearance === "system" ? "Matches your system" : appearance === "dark" ? "Dark" : "Light" },
    { icon: <AiIconTile />, title: "Foli", body: ai ? "On. Press ⌘J in a note to ask." : "Off. Turn it on in Settings any time." },
  ];
  return (
    <ul className="space-y-2.5">
      {rows.map((row, i) => (
        <li key={row.title} className="ob-rise flex items-center gap-3.5 rounded-panel bg-surface p-3 pr-4 shadow-[var(--shadow-card)]" style={{ ["--i" as string]: i }}>
          {row.icon}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-heading">{row.title}</p>
            <p className="mt-0.5 text-[13px] text-muted">{row.body}</p>
          </div>
          <span aria-hidden className="ob-draw grid size-6 flex-none place-items-center rounded-chip bg-heading text-canvas" style={{ ["--i" as string]: i }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AiIconTile() {
  return (
    <span aria-hidden className="grid size-9 flex-none place-items-center rounded-control bg-surface shadow-[var(--shadow-card)]">
      <AiIcon size={17} />
    </span>
  );
}
