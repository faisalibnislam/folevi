// The sidebar's selected item shows its icon filled (the owner, 28 November 2026: "filled when selected"), as the
// Mac and iPhone sidebars do. Each is the same 24-unit drawing as its outline icon (Lucide), filled with the text
// colour; inner details (a door, a check, calendar dots) are cut out in the row's background colour, so they read
// on the selected row in light and dark. The stroke is the app's icon stroke (globals.css, svg.lucide).
import type { ReactNode } from "react";

/** The selected row's background behind the cut-out details. */
const CUT = "var(--glass-active-solid, var(--color-surface-raised))";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const FILLED_SIDEBAR_ICONS: Record<string, ReactNode> = {
  home: (
    <Glyph>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-4v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8H5a2 2 0 0 1-2-2z" />
    </Glyph>
  ),
  dna: (
    <Glyph>
      <circle cx="12" cy="4.5" r="2.5" />
      <path d="m10.2 6.3-3.9 3.9" fill="none" />
      <circle cx="4.5" cy="12" r="2.5" />
      <path d="M7 12h10" fill="none" />
      <circle cx="19.5" cy="12" r="2.5" />
      <path d="m13.8 17.7 3.9-3.9" fill="none" />
      <circle cx="12" cy="19.5" r="2.5" />
    </Glyph>
  ),
  bookmarks: (
    <Glyph>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </Glyph>
  ),
  drafts: (
    <Glyph>
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" fill="none" />
      <path d="M2 12h6l2 3h4l2-3h6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    </Glyph>
  ),
  notes: (
    <Glyph>
      <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" />
      <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" fill="none" />
    </Glyph>
  ),
  tasks: (
    <Glyph>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke={CUT} />
    </Glyph>
  ),
  calendar: (
    <Glyph>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4M16 2v4" fill="none" />
      <path d="M3 10h18" fill="none" stroke={CUT} />
      <g stroke="none" fill={CUT}>
        <circle cx="8" cy="14" r="1" />
        <circle cx="12" cy="14" r="1" />
        <circle cx="16" cy="14" r="1" />
        <circle cx="8" cy="18" r="1" />
        <circle cx="12" cy="18" r="1" />
        <circle cx="16" cy="18" r="1" />
      </g>
    </Glyph>
  ),
  reviews: (
    <Glyph>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" fill="none" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" fill="none" />
    </Glyph>
  ),
  shared: (
    <Glyph>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" fill="none" />
    </Glyph>
  ),
  vault: (
    <Glyph>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" />
    </Glyph>
  ),
  changes: (
    <Glyph>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M9 10h6M12 7v6M9 17h6" fill="none" stroke={CUT} />
    </Glyph>
  ),
  templates: (
    <Glyph>
      <rect x="3" y="3" width="18" height="7" rx="1" />
      <rect x="3" y="14" width="9" height="7" rx="1" />
      <rect x="16" y="14" width="5" height="7" rx="1" />
    </Glyph>
  ),
};
