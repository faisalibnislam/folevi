import Link from "next/link";
import { FileDown, Paintbrush, RefreshCw, SunMoon, WifiOff, type LucideIcon } from "lucide-react";
import { COVER_ART } from "@/lib/cover";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";
import { SIGN_UP_URL } from "../site";
import { ButtonLink, container, cx } from "../ui";
import { HeroNote } from "./HeroNote";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-hero">
      <HeroNote title="A quieter place for ideas that keep growing." chip="Free to start · On the web, Mac app coming soon">
        <p className="mk-hero-lede mt-4">
          Folevi is a notes app for documents, tasks and linked pages. Your writing is saved on your device first, so you can keep
          working offline, and it syncs when you reconnect.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg" className="mk-hero-primary">
            Start writing
          </ButtonLink>
          <ButtonLink href="/mac" variant="secondary" size="lg" className="mk-hero-secondary">
            Folevi for Mac
          </ButtonLink>
        </div>
        <p className="mk-note-muted mt-4 text-[13.5px]">
          Free plan with no card. New accounts get {TIER_NAMES[TRIAL_TIER]} free for {TRIAL_DAYS} days.
        </p>
      </HeroNote>
    </section>
  );
}

const facts: Array<{ icon: LucideIcon; label: string; href?: string }> = [
  { icon: WifiOff, label: "Works offline", href: "/features/offline-notes" },
  { icon: RefreshCw, label: "Real-time sync" },
  { icon: Paintbrush, label: `${COVER_ART.length} note styles`, href: "/features/note-styles" },
  { icon: FileDown, label: "Markdown, HTML and PDF export", href: "/features/import-and-export" },
  { icon: SunMoon, label: "Light and dark mode" },
];

export function ProofStrip() {
  return (
    <section aria-label="What’s included" className="border-y mk-hair">
      <ul className={cx(container, "flex flex-wrap justify-center gap-x-8 gap-y-3 py-6 sm:justify-between")}>
        {facts.map(({ icon: FactIcon, label, href }) => (
          <li key={label} className="flex items-center gap-2 text-[14px] text-ink">
            <FactIcon size={16} aria-hidden="true" className="flex-none text-muted" />
            {href ? (
              <Link href={href} className="underline decoration-(--color-line-strong) underline-offset-4 transition-colors duration-150 hover:text-(--color-heading) hover:decoration-current">
                {label}
              </Link>
            ) : (
              label
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
