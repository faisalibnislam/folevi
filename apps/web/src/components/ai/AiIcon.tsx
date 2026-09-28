/**
 * Folevi's AI mark: a four-point star with three speed lines. Drawn in currentColor, so it takes the
 * colour of whatever it sits in. The mark is wider than it is tall (339×208), so `size` sets its visual
 * weight to match a square icon of that size.
 */
export function AiIcon({ size = 16, className, "aria-hidden": ariaHidden = true }: { size?: number; className?: string; "aria-hidden"?: boolean }) {
  const width = Math.round(size * 1.3);
  const height = Math.round((width * 208) / 339);
  return (
    <svg width={width} height={height} viewBox="0 0 339 208" fill="none" aria-hidden={ariaHidden} className={className}>
      <path
        d="M267.95 78.3245C268.517 83.2788 271.113 87.7762 275.121 90.7442L325.242 127.864L263.276 134.95C258.321 135.517 253.824 138.114 250.856 142.121L213.736 192.242L206.65 130.276C206.083 125.322 203.487 120.824 199.479 117.856L149.358 80.7363L211.324 73.65C216.279 73.0834 220.776 70.4869 223.744 66.4795L260.864 16.3585L267.95 78.3245Z"
        stroke="currentColor"
        strokeWidth="22"
        strokeLinejoin="round"
      />
      <path d="M178.5 13H10M154 195H10M94 104H10" stroke="currentColor" strokeWidth="22" strokeLinecap="round" />
    </svg>
  );
}
