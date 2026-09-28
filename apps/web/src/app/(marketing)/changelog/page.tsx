import { pageMetadata } from "@/components/marketing/seo";
import { PageHeader, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Changelog",
  description: "What’s new in Folevi. Version 0.2 brings plans (Free, Basic, Pro), the AI Assistant, 57 note styles, 26 templates, a new look and a new Devices page.",
  path: "/changelog",
});

const releases = [
  {
    version: "0.2",
    name: "Plans, AI and a new look",
    date: "2026-09-28",
    label: "28 September 2026",
    intro: "Folevi gets plans, an AI Assistant and a lighter, glassier look — on the web, with the Mac app to follow.",
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
          "Write, rewrite, summarize and continue — from the slash menu, the selection toolbar or ⌘J",
          "Catch me up: a short brief of your week on Home",
          "Answers appear word by word; turn the assistant off anytime in settings",
        ],
      },
      {
        title: "Look and feel",
        items: [
          "A new logo and app icon",
          "Translucent, glassy chrome with a calmer, neutral palette so your notes carry the colour",
          "57 note styles, each colouring text, highlights and blocks from its image — or upload your own",
          "26 built-in templates with their own icons",
          "Folders that show the notes inside them",
        ],
      },
    ],
  },
  {
    version: "0.1",
    name: "Preview",
    date: "2026-09-25",
    label: "25 September 2026",
    intro: "The first public preview of Folevi, on the web and — for preview accounts — on the Mac.",
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

export default function ChangelogPage() {
  return (
    <>
      <PageHeader eyebrow="Changelog" title="What’s new in Folevi." lede="A running record of every release, newest first." />
      <div className={cx(container, "pb-20 pt-4 sm:pb-28")}>
        {releases.map((release) => (
          <article key={release.version} aria-labelledby={`v${release.version}`} className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
            <div className="flex flex-wrap items-center gap-3 lg:sticky lg:top-28 lg:block lg:self-start">
              <p className="mk-chip mk-tone--ember">
                <span aria-hidden="true" className="mk-dot" />
                Version {release.version}
              </p>
              <p className="text-[14px] text-muted lg:mt-3 lg:pl-1">
                <time dateTime={release.date}>{release.label}</time>
              </p>
            </div>
            <div className="mk-card max-w-[760px] rounded-[28px] p-6 sm:p-10">
              <h2 id={`v${release.version}`} className="mk-h2 text-[34px] sm:text-[44px]">
                {release.version} · {release.name}
              </h2>
              <p className="mk-lede mt-4">{release.intro}</p>
              <div className="mk-prose mt-8">
                {release.groups.map((group) => (
                  <section key={group.title} aria-label={group.title}>
                    <h3>{group.title}</h3>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
