import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * What a list or view shows when there's nothing in it, everywhere in the app: a quiet centred block with an
 * optional icon in a soft tile, a short heading, one muted line of help, an optional fainter hint, and an
 * optional action. "page" fills a view (Tasks, Changes, a note list); "inline" sits inside a card, a panel or
 * a Home section, at the size of the text around it.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  hint,
  action,
  size = "page",
  heading,
  className = "",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  /** A second, fainter line (how to get started, when that needs saying). */
  hint?: ReactNode;
  /** A button or link under the text. */
  action?: ReactNode;
  size?: "page" | "inline";
  /** The title's element. A view's empty state is a heading (h2); inline ones are plain text unless asked. */
  heading?: "h2" | "h3" | "p";
  className?: string;
}) {
  const page = size === "page";
  const Title = heading ?? (page ? "h2" : "p");
  return (
    <div className={`mx-auto flex max-w-md flex-col items-center text-center ${page ? "px-6 py-16" : "px-4 py-8"} ${className}`} data-empty-state="">
      {Icon ? (
        <span aria-hidden className={`grid place-items-center rounded-chip bg-[var(--glass-hover)] text-heading ${page ? "mb-4 h-11 w-11" : "mb-3 h-9 w-9"}`}>
          <Icon size={page ? 19 : 16} strokeWidth={1.9} />
        </span>
      ) : null}
      <Title className={page ? "ui-display text-title-1" : "text-body font-semibold text-heading"}>{title}</Title>
      {body ? <p className={page ? "mt-2 text-body leading-relaxed text-muted" : "mt-1 text-subheadline leading-snug text-muted"}>{body}</p> : null}
      {hint ? <p className={`${page ? "mt-3 text-subheadline" : "mt-2 text-subheadline"} leading-relaxed text-faint`}>{hint}</p> : null}
      {action ? <div className={page ? "mt-6" : "mt-4"}>{action}</div> : null}
    </div>
  );
}
