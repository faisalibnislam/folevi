/**
 * A note's page background, blurred (the Style panel's "Blur background"). It fills its positioned parent
 * and clips to the parent's corners; the image is drawn larger than the box so the blur has no soft edge.
 */
export function BlurredBackdrop({ background, className = "" }: { background: string; className?: string }) {
  return (
    <div aria-hidden data-backdrop-blur="" className={`pointer-events-none absolute overflow-hidden ${className || "inset-0 rounded-[inherit]"}`}>
      <div className="absolute -inset-16 blur-[32px]" style={{ background }} />
    </div>
  );
}
