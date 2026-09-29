import { FileDown, Paintbrush, RefreshCw, SunMoon, WifiOff, type LucideIcon } from "lucide-react";
import { COVER_ART } from "@/lib/cover";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";
import { StyleShowcase } from "../product/StyleShowcase";
import { SIGN_UP_URL } from "../site";
import { ButtonLink, container, cx } from "../ui";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-12 pt-12 sm:pb-16 sm:pt-20">
      <div className={cx(container, "text-center")}>
        <p className="mk-chip mk-chip--raised">Free to start · On the web, Mac app coming soon</p>
        <h1 id="hero-title" className="mk-display mx-auto mt-6 max-w-[19ch] text-[44px] sm:text-[64px] lg:text-[76px]">
          A quieter place for ideas that keep growing.
        </h1>
        <p className="mk-lede mx-auto mt-6 max-w-[54ch]">
          Folevi is a notes app for documents, tasks and linked pages. Your writing is saved on your device first, so you can keep
          working offline, and it syncs when you reconnect.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
            Start writing
          </ButtonLink>
          <ButtonLink href="/mac" variant="secondary" size="lg">
            Folevi for Mac
          </ButtonLink>
        </div>
        <p className="mt-4 text-[13.5px] text-muted">
          Free plan with no card. New accounts get {TIER_NAMES[TRIAL_TIER]} free for {TRIAL_DAYS} days.
        </p>
      </div>
      <div className={cx(container, "mt-12 sm:mt-16")}>
        <StyleShowcase />
      </div>
    </section>
  );
}

const facts: Array<{ icon: LucideIcon; label: string }> = [
  { icon: WifiOff, label: "Works offline" },
  { icon: RefreshCw, label: "Real-time sync" },
  { icon: Paintbrush, label: `${COVER_ART.length} note styles` },
  { icon: FileDown, label: "Markdown, HTML and PDF export" },
  { icon: SunMoon, label: "Light and dark mode" },
];

export function ProofStrip() {
  return (
    <section aria-label="What’s included" className="border-y mk-hair">
      <ul className={cx(container, "flex flex-wrap justify-center gap-x-8 gap-y-3 py-6 sm:justify-between")}>
        {facts.map(({ icon: FactIcon, label }) => (
          <li key={label} className="flex items-center gap-2 text-[14px] text-ink">
            <FactIcon size={16} aria-hidden="true" className="flex-none text-muted" />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
