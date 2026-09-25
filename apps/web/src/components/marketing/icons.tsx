import type { SVGProps } from "react";

/** A tiny, consistent stroke icon set for the marketing site (1.5px strokes on a 20px grid). */
export type IconName =
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  | "indent"
  | "outdent"
  | "check"
  | "mac"
  | "offline"
  | "sync"
  | "markdown"
  | "theme"
  | "shield"
  | "key"
  | "lock"
  | "link"
  | "clock"
  | "trash"
  | "export"
  | "eye-off"
  | "mail"
  | "search"
  | "grip"
  | "plus"
  | "sidebar"
  | "inspector"
  | "calendar"
  | "page"
  | "flag"
  | "pause"
  | "play"
  | "menu"
  | "close"
  | "window"
  | "keyboard"
  | "finder"
  | "eye"
  | "sparkle"
  | "reset"
  | "chevron-left"
  | "chevron-right";

const paths: Record<IconName, React.ReactNode> = {
  "arrow-right": <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />,
  "arrow-up": <path d="M10 16V4.5M5.5 9 10 4.5 14.5 9" />,
  "arrow-down": <path d="M10 4v11.5M5.5 11 10 15.5 14.5 11" />,
  indent: <path d="M3.5 4.5h13M9 8.5h7.5M9 12h7.5M3.5 16h13M3.5 8l3 2.2-3 2.2" />,
  outdent: <path d="M3.5 4.5h13M9 8.5h7.5M9 12h7.5M3.5 16h13M6.5 8l-3 2.2 3 2.2" />,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  mac: (
    <>
      <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
      <path d="M1.8 16h16.4" />
    </>
  ),
  offline: (
    <>
      <path d="M2.5 7.6a11 11 0 0 1 4-2.3M17.5 7.6a11 11 0 0 0-6.2-2.9M5 10.4a7 7 0 0 1 2.4-1.5M15 10.4a7 7 0 0 0-1.4-1M7.8 13.2a3.4 3.4 0 0 1 4.4 0" />
      <path d="M3.5 3.5 16.5 16.5" />
    </>
  ),
  sync: (
    <>
      <path d="M15.8 8.2A6 6 0 0 0 4.9 6.6M4.2 11.8a6 6 0 0 0 10.9 1.6" />
      <path d="M15.8 4v4.2h-4.2M4.2 16v-4.2h4.2" />
    </>
  ),
  markdown: (
    <>
      <rect x="2" y="4.5" width="16" height="11" rx="2" />
      <path d="M5 12.5v-5l2 2.4 2-2.4v5M13.5 7.5v5M11.5 10.6l2 2 2-2" />
    </>
  ),
  theme: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5v13a6.5 6.5 0 0 0 0-13Z" fill="currentColor" stroke="none" />
    </>
  ),
  shield: <path d="M10 2.8 4 5v4.6c0 3.8 2.6 6.4 6 7.6 3.4-1.2 6-3.8 6-7.6V5l-6-2.2Z" />,
  key: (
    <>
      <circle cx="7" cy="12.5" r="3.5" />
      <path d="m9.6 10 6.4-6.4M13.6 6l2 2M11.8 7.8l1.6 1.6" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="8.5" width="12" height="8.5" rx="1.8" />
      <path d="M6.8 8.5V6.3a3.2 3.2 0 0 1 6.4 0v2.2" />
    </>
  ),
  link: <path d="M8.5 11.5a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-.8.8M11.5 8.5a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l.8-.8" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.2l2.8 1.8" />
    </>
  ),
  trash: <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.2 5.5l.8 11h8l.8-11M8.4 8.5v5M11.6 8.5v5" />,
  export: <path d="M10 12.5V3M6.2 6.6 10 2.8l3.8 3.8M4 10.5v5.2c0 .6.4 1 1 1h10c.6 0 1-.4 1-1v-5.2" />,
  "eye-off": (
    <>
      <path d="M3 3l14 14M8.3 5.2A8 8 0 0 1 10 5c4.2 0 7 5 7 5a13 13 0 0 1-2.4 2.9M12 14.6a7 7 0 0 1-2 .4c-4.2 0-7-5-7-5a12.6 12.6 0 0 1 3-3.4" />
      <path d="M8.6 8.6a2 2 0 0 0 2.8 2.8" />
    </>
  ),
  eye: (
    <>
      <path d="M3 10s2.8-5 7-5 7 5 7 5-2.8 5-7 5-7-5-7-5Z" />
      <circle cx="10" cy="10" r="2.2" />
    </>
  ),
  mail: (
    <>
      <rect x="2.8" y="4.5" width="14.4" height="11" rx="1.6" />
      <path d="m3.4 5.3 6.6 5.2 6.6-5.2" />
    </>
  ),
  search: (
    <>
      <circle cx="8.8" cy="8.8" r="5" />
      <path d="m12.6 12.6 4 4" />
    </>
  ),
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="7.5" cy="5.5" r="1.2" />
      <circle cx="12.5" cy="5.5" r="1.2" />
      <circle cx="7.5" cy="10" r="1.2" />
      <circle cx="12.5" cy="10" r="1.2" />
      <circle cx="7.5" cy="14.5" r="1.2" />
      <circle cx="12.5" cy="14.5" r="1.2" />
    </g>
  ),
  plus: <path d="M10 4v12M4 10h12" />,
  sidebar: (
    <>
      <rect x="2.8" y="4" width="14.4" height="12" rx="1.8" />
      <path d="M7.8 4v12" />
    </>
  ),
  inspector: (
    <>
      <rect x="2.8" y="4" width="14.4" height="12" rx="1.8" />
      <path d="M12.2 4v12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="1.8" />
      <path d="M3 8.5h14M7 2.8v3M13 2.8v3" />
    </>
  ),
  page: (
    <>
      <path d="M5 2.8h6.5L15 6.3v10.9H5z" />
      <path d="M11.5 2.8v3.5H15M7.5 10h5M7.5 13h5" />
    </>
  ),
  flag: <path d="M5 17V3.5M5 4h9l-2 3.2 2 3.3H5" />,
  pause: <path d="M7.5 5v10M12.5 5v10" />,
  play: <path d="M6.5 4.5v11l9-5.5-9-5.5Z" />,
  menu: <path d="M3.5 6.5h13M3.5 13.5h13" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  window: (
    <>
      <rect x="2.5" y="5" width="11" height="10" rx="1.6" />
      <path d="M6.5 5V3.5h11v9H13.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="5" width="16" height="10" rx="1.8" />
      <path d="M5 8.2h.01M8 8.2h.01M11 8.2h.01M14 8.2h.01M6 12h8" />
    </>
  ),
  finder: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="3" />
      <path d="M10 3v5.5c0 1-.6 1.6-1.4 1.6M6.8 7.2v.8M13.2 7.2v.8M6.5 13c2 1.3 5 1.3 7 0" />
    </>
  ),
  sparkle: <path d="M10 3.5c.5 3.2 2.3 5 5.5 5.5-3.2.5-5 2.3-5.5 5.5-.5-3.2-2.3-5-5.5-5.5 3.2-.5 5-2.3 5.5-5.5Z" />,
  reset: <path d="M4.2 9.5a5.8 5.8 0 1 1 1.6 4.6M4 4.8v4.8h4.8" />,
  "chevron-left": <path d="M12 5 7 10l5 5" />,
  "chevron-right": <path d="m8 5 5 5-5 5" />,
};

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
