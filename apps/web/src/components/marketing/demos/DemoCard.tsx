import type { ReactNode } from "react";
import { Icon } from "../icons";
import { cx } from "../ui";

export function DemoCard({
  title,
  icon,
  meta,
  onReset,
  children,
  className,
  clip = true,
}: {
  title: string;
  icon?: string;
  meta?: ReactNode;
  onReset?: () => void;
  children: ReactNode;
  className?: string;
  /** Set to false when a popup (e.g. a listbox) must be able to extend past the card. */
  clip?: boolean;
}) {
  return (
    <div className={cx("mk-card", clip && "overflow-hidden", className)}>
      <div className="flex h-11 items-center gap-2 border-b mk-hair px-4">
        {icon ? (
          <span aria-hidden="true" className="text-[14px]">
            {icon}
          </span>
        ) : null}
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{title}</p>
        {meta}
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="-mr-2 inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-[12.5px] text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <Icon name="reset" size={14} />
            Reset
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
