"use client";

/**
 * A person's round picture, or their initial on a neutral disc when they have none. Decorative by
 * default (the name is always written next to it); pass `label` when it stands alone.
 */
export function Avatar({ name, url, size = 24, label, className = "" }: { name: string; url?: string | null; size?: number; label?: string; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) };
  const a11y = label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- signed file URL from our own backend
    return <img src={url} alt="" {...a11y} style={style} className={`flex-none rounded-full object-cover ${className}`} />;
  }
  return (
    <span {...a11y} style={style} className={`grid flex-none select-none place-items-center rounded-full bg-sunken font-semibold uppercase text-heading shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_8%,transparent)] ${className}`}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
