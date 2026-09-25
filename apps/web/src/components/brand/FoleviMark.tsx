/**
 * The Folevi mark: two offset leaves — a tall page forming the stem and top of an "F", and a smaller
 * leaf set slightly apart as the middle bar. Monochrome by default (currentColor); legible at 16px.
 */
export function FoleviMark({
  size = 24,
  accent,
  title,
  className,
}: {
  size?: number;
  /** Optional color for the offset middle leaf (e.g. "var(--color-accent)"). */
  accent?: string;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      fill="currentColor"
    >
      {title ? <title>{title}</title> : null}
      <path d="M6 28V10.5C6 6.9 8.9 4 12.5 4H26.5C26.5 8 23.3 11.2 19.3 11.2H14V28H6Z" />
      <path d="M16.2 14.4H23.6C23.6 18 20.7 20.9 17.1 20.9H16.2V14.4Z" fill={accent ?? "currentColor"} />
    </svg>
  );
}

export function FoleviWordmark({ className, markSize = 22 }: { className?: string; markSize?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <FoleviMark size={markSize} accent="var(--color-accent)" />
      <span className="font-display text-[1.35em] leading-none tracking-[-0.01em]">Folevi</span>
    </span>
  );
}
