// The website's Beta badge and note, for Folevi for Linux and Folevi Server (owner, 2026-11-26). The words and the
// feedback link are lib/beta.ts, shared with the badges inside the Linux app and Folevi Server (components/ui/Beta.tsx).
import { BETA_FEEDBACK_LABEL, BETA_FEEDBACK_URL, BETA_NOTE } from "@/lib/beta";
import { cx } from "./ui";

/** A "Beta" chip, the marketing chip (like "Coming soon") in the site's violet. */
export function BetaBadge({ className }: { className?: string }) {
  return <span className={cx("mk-chip flex-none whitespace-nowrap font-semibold text-(--mk-violet-ink)", className)}>Beta</span>;
}

/** "Beta: works, but expect rough edges. Send feedback", the link opening the support page. */
export function BetaNote({ className, badge = false }: { className?: string; badge?: boolean }) {
  return (
    <span className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted", className)}>
      {badge ? <BetaBadge /> : null}
      <span>
        {BETA_NOTE}{" "}
        <a href={BETA_FEEDBACK_URL} className="underline underline-offset-2 hover:text-(--color-heading)">
          {BETA_FEEDBACK_LABEL}
        </a>
      </span>
    </span>
  );
}
