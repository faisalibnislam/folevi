// Vault settings' layout (the Mac's, 2026-11-19): named groups, each one card of rows; a row is an icon in a small
// tile, its name, one line about it, and a single control on the right.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** The 32px tile a row's icon sits in. */
export const ROW_TILE = "grid size-8 flex-none place-items-center rounded-small bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] text-muted";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 px-1 text-footnote font-semibold text-heading">{title}</h3>
      <div className="divide-y divide-line ui-card rounded-panel">{children}</div>
    </section>
  );
}

export function SettingsRow({ icon: Icon, name, hint, children }: { icon: LucideIcon; name: string; hint: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden className={ROW_TILE}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-subheadline font-medium text-ink">{name}</span>
        <span className="block text-footnote text-muted text-pretty">{hint}</span>
      </span>
      {children ? <span className="flex flex-none items-center">{children}</span> : null}
    </div>
  );
}
