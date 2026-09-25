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
      <div className="flex h-12 items-center gap-2 border-b mk-hair px-4">
        {icon ? (
          <span aria-hidden="true" className="text-[14px]">
            {icon}
          </span>
        ) : null}
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-(--color-heading)">{title}</p>
        {meta}
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="mk-btn mk-btn-ghost -mr-2 h-11 gap-1.5 sm:h-9 px-3 text-[12.5px]"
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
