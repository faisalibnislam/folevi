/*
 * Release notes, newest first. The changelog page renders them, each release is an Article in its
 * structured data, and the newest date is the changelog's lastModified in the sitemap.
 */
export type Release = {
  version: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  label: string;
  intro: string;
  groups: Array<{ title: string; items: string[] }>;
};

export const RELEASES: Release[] = [
  {
    version: "0.4",
    name: "Folevi for Mac runs the web app",
    date: "2026-10-09",
    label: "9 October 2026",
    intro: "Folevi for Mac now runs the same app as the web, so every feature reaches the Mac the day it ships. It isn't available to download yet.",
    groups: [
      {
        title: "Folevi for Mac",
        items: [
          "Quick Add from any app with ⌥Space (you can change the shortcut)",
          "A menu bar icon with Quick Add, a new note, recent notes and the save state",
          "Mac notifications for comments, mentions and reminders, and the unread count on the Dock icon",
          "A window with no title bar, ⌘N for a new note, and opening at login",
          "Requires macOS 13 or later on Apple silicon",
        ],
      },
    ],
  },
  {
    version: "0.3",
    name: "New plans and AI credits",
    date: "2026-09-30",
    label: "30 September 2026",
    intro: "Four plans, the same for you and for your team, and AI counted in credits so every plan can say exactly what it includes.",
    groups: [
      {
        title: "Plans",
        items: [
          "Free (1 GB shared with the free workspaces you own, 25 AI credits a month, 2 devices)",
          "Core (20 GB, unlimited devices, and no AI: nothing is sent to an AI model)",
          "Pro (20 GB, 180 AI credits a month, unlimited devices)",
          "Pro AI (50 GB, unlimited AI with fair use: 550 credits a month, unlimited devices)",
          "The same four plans for workspaces, billed per member; guests are free",
          "Basic is now Core, the old Pro is now Pro AI, and workspaces on Team or Business move to Pro or Pro AI",
        ],
      },
      {
        title: "AI credits",
        items: [
          "Every AI request uses credits: a rewrite about 1, Ask AI about 2, a flowchart 3 to 5",
          "Monthly credits reset each billing month (on Free, each calendar month)",
          "Credit packs for Pro and Pro AI: 500 or 1,000 credits, one-time, valid for 12 months",
          "The 7-day trial for new accounts is now Pro AI, with 100 AI credits and no card",
        ],
      },
    ],
  },
  {
    version: "0.2",
    name: "Plans, AI and a new look",
    date: "2026-09-28",
    label: "28 September 2026",
    intro: "Folevi gets plans, an AI Assistant and a lighter, glassier look. They're on the web now, and the Mac app will follow.",
    groups: [
      {
        title: "Plans",
        items: [
          "Free (1 GB, 2 devices), Basic (20 GB, unlimited devices) and Pro (100 GB, unlimited devices, the AI Assistant)",
          "A 7-day Pro trial for every new account, with no card",
          "Settings → Plan & billing: your plan, storage, devices and history in one place",
          "Settings → Devices: every browser and app signed in, with one-click sign-out",
        ],
      },
      {
        title: "AI Assistant",
        items: [
          "Ask questions of your notes, with links to the notes it used",
          "Write, rewrite, summarize and continue from the slash menu, the selection toolbar or ⌘J",
          "Catch me up: a short brief of your week on Home",
          "Answers appear word by word; turn the assistant off anytime in settings",
        ],
      },
      {
        title: "Look and feel",
        items: [
          "A new logo and app icon",
          "Translucent, glassy chrome with a calmer, neutral palette so your notes carry the colour",
          "57 note styles, each colouring text, highlights and blocks from its image, or upload your own",
          "26 built-in templates with their own icons",
          "Folders that show the notes inside them",
        ],
      },
      {
        title: "Account",
        items: ["Two-step verification is now optional: turn it on or off anytime in Settings → Security"],
      },
    ],
  },
  {
    version: "0.1",
    name: "Preview",
    date: "2026-09-25",
    label: "25 September 2026",
    intro: "The first public preview of Folevi, on the web and (for preview accounts) on the Mac.",
    groups: [
      {
        title: "Writing",
        items: [
          "Block documents: text, headings (three levels), bulleted and numbered lists, checklists, toggles, quotes, callouts, dividers, code, tables, images, files and bookmarks",
          "Slash menu to insert or turn a block into any type, plus keyboard shortcuts for headings and checklists",
          "Drag or use ⌥⇧↑ / ⌥⇧↓ to move blocks; nest blocks to build outlines",
          "Inline formatting, text colours and highlights, links, dates and mentions",
          "Page style: sans, serif or mono type; narrow, default or wide width; paper, plain, tinted or grid backgrounds; five accent colours; colour, gradient and 20 artwork covers; icons",
        ],
      },
      {
        title: "Organising",
        items: [
          "Nested pages, shown as links or cards",
          "Links between pages with [[, and backlinks on the linked page",
          "Drafts for loose notes, folders, tags and starred pages",
          "Templates",
          "Search across titles and text with ⌘K",
        ],
      },
      {
        title: "Tasks",
        items: ["Checklist items with due dates, times and priority", "Today view for due and overdue tasks", "Quick Add into your Inbox page", "Calendar"],
      },
      {
        title: "Sync, offline and sharing",
        items: [
          "Offline editing on the web and the Mac, with a clear status: Saved, Saving, Offline, Syncing, Conflict or Error",
          "Real-time sync between devices, with version snapshots",
          "Private by default; public links with optional expiry and password, revocable at any time",
          "Export any page to Markdown, HTML or PDF, or the whole workspace as a ZIP",
        ],
      },
      {
        title: "Mac app (private preview)",
        items: [
          "Native menus and shortcuts, multiple windows, sidebar and inspector",
          "Quick Look, drag from Finder and menu bar Quick Add",
          "Liquid Glass on macOS 26; supports macOS 15 and later",
        ],
      },
      {
        title: "Account security",
        items: [
          "Email verification before workspace access",
          "Required two-step verification with an authenticator app, plus one-time recovery codes",
          "Account deletion with a 7-day grace period",
        ],
      },
    ],
  },
];

/** The newest release date (YYYY-MM-DD). */
export const LATEST_RELEASE_DATE = RELEASES.reduce((latest, r) => (r.date > latest ? r.date : latest), RELEASES[0]!.date);
