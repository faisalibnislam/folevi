// The website's Early Beta badge and note, for Folevi Server (owner, 2026-11-26; "Early Beta" and Linux paused,
// 2026-11-28). The note and the feedback link are lib/beta.ts, shared with the badges inside Folevi Server
// (components/ui/Beta.tsx).
import { BETA_FEEDBACK_LABEL, BETA_FEEDBACK_URL, BETA_NOTE } from "@/lib/beta";
import { cx } from "./ui";

/** An "Early Beta" chip (Folevi Server, owner 2026-11-28), the marketing chip (like "Coming soon") in the site's violet. */
export function BetaBadge({ className }: { className?: string }) {
  return <span className={cx("mk-chip flex-none whitespace-nowrap font-semibold text-(--mk-violet-ink)", className)}>Early Beta</span>;
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

/** A muted "Coming soon" chip, for the paused Android, Windows and Linux apps (owner, 2026-11-28). */
export function ComingSoonBadge({ className }: { className?: string }) {
  return <span className={cx("mk-chip flex-none whitespace-nowrap font-medium text-muted", className)}>Coming soon</span>;
}
