import Link from "next/link";
import type { ReactNode } from "react";
import { FileDown, Paintbrush, RefreshCw, SunMoon, WifiOff, type LucideIcon } from "lucide-react";
import { COVER_ART } from "@/lib/cover";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";
import { SIGN_UP_URL } from "../site";
import { ButtonLink, container } from "../ui";
import { HeroNote } from "./HeroNote";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-hero">
      <HeroNote
        title="A quieter place for ideas that keep growing."
        chip="Free to start · On the web, Mac app coming soon"
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg" className="mk-hero-primary">
                Start writing
              </ButtonLink>
              <ButtonLink href="/mac" variant="secondary" size="lg">
                Folevi for Mac
              </ButtonLink>
            </div>
            <p className="mt-3 text-[13.5px] text-muted">
              Free plan with no card. New accounts get {TIER_NAMES[TRIAL_TIER]} free for {TRIAL_DAYS} days.
            </p>
          </>
        }
      >
        {/* The note's blocks, drawn with the editor's block styles (editor.css) in the style's colours. */}
        <p className="mk-hb">
          Folevi is a notes app for documents, tasks and linked pages. Your writing is saved on your device first, so you can keep
          working offline, and it syncs when you reconnect.
        </p>
        <h2 className="mk-hb mk-hb-h">First things to try</h2>
        <ul className="mk-hb-list" aria-label="A to-do list">
          <Todo done>Write a page while offline</Todo>
          <Todo done>Pick a style for this note</Todo>
          <Todo>
            Link another page with <code className="mk-hb-code">[[</code>
          </Todo>
          <Todo due="Oct 9">Give a to-do a due date</Todo>
        </ul>
        <div role="note" className="mk-hb mk-hb-callout">
          <span className="mk-hb-callout-icon" aria-hidden="true">
            ✳︎
          </span>
          <p className="min-w-0">Everything you type is saved on this device first. When the status says Saved, the server has it.</p>
        </div>
      </HeroNote>
    </section>
  );
}

/** A to-do as the editor draws it: its checkbox, the text (struck through when done) and a due date chip. */
function Todo({ done = false, due, children }: { done?: boolean; due?: string; children: ReactNode }) {
  return (
    <li className="mk-hb mk-hb-todo" data-checked={done ? "true" : undefined}>
      <span className="mk-hb-check" role="img" aria-label={done ? "Done" : "Not done"} />
      <span className="mk-hb-todo-text">{children}</span>
      {due ? (
        <span className="mk-hb-due">
          <span className="sr-only">Due </span>
          {due}
        </span>
      ) : null}
    </li>
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
    <section aria-label="What’s included" className={container}>
      <ul className="mk-box flex flex-wrap justify-center gap-x-8 gap-y-3 px-6 py-5 sm:justify-between sm:px-10 lg:px-14">
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
