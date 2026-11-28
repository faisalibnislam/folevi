// The Beta badge and its one-line note inside the product: Folevi for Linux (Settings > About) and Folevi Server's
// own setup and admin pages. The website draws its own (components/marketing/Beta.tsx) with the same words, lib/beta.ts.
import { BETA_FEEDBACK_LABEL, BETA_FEEDBACK_URL, BETA_LABEL, BETA_NOTE } from "@/lib/beta";

/** A small "Early Beta" chip, styled like the admin panel's "Admin" chip. */
export function BetaBadge({ className = "" }: { className?: string }) {
  return <span className={`inline-flex flex-none items-center rounded-chip bg-[var(--glass-hover)] px-2 py-0.5 text-footnote font-semibold text-muted ${className}`}>{BETA_LABEL}</span>;
}

/**
 * "Early Beta: works, but expect rough edges. Send feedback", the link opening Folevi's support page. A block-level span,
 * so it can sit inside a paragraph (a settings card's description) as well as on its own.
 */
export function BetaNote({ className = "", badge = false }: { className?: string; badge?: boolean }) {
  return (
    <span className={`block text-footnote text-muted ${className}`}>
      {badge ? <BetaBadge className="mr-1.5 align-middle" /> : null}
      {BETA_NOTE}{" "}
      <a href={BETA_FEEDBACK_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-heading">
        {BETA_FEEDBACK_LABEL}
      </a>
    </span>
  );
}
