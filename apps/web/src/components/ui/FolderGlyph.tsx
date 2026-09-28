import { folderHex } from "@/lib/folderColors";

/**
 * A folder in the folder's colour, drawn upright like the big folder cards: a lighter back cover offset
 * to the right and a filled front cover with the stepped tab at its top-right. `size` is the height.
 */
export function FolderGlyph({ color, size = 18, className = "" }: { color: string | null | undefined; size?: number; className?: string }) {
  const base = folderHex(color);
  return (
    <svg width={size * (80 / 112)} height={size} viewBox="0 0 80 112" aria-hidden className={`flex-none ${className}`}>
      <rect x="9" y="4" width="69" height="106" rx="7" fill={`color-mix(in oklab, ${base} 70%, #eef0f3)`} stroke="rgb(0 0 0 / 0.16)" strokeWidth="2.5" />
      <path
        d="M9 2 H68 Q76 2 76 10 V23 Q76 27 72.5 29 L70.5 30.2 Q67 32.2 67 36.2 V102 Q67 110 59 110 H9 Q2 110 2 103 V9 Q2 2 9 2 Z"
        fill={base}
        stroke="rgb(0 0 0 / 0.16)"
        strokeWidth="2.5"
      />
    </svg>
  );
}
