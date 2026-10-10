import { Icon, type IconName } from "@/components/marketing/icons";
import { MacMenuBar } from "@/components/marketing/mac/MacMenuBar";
import { ShortcutTable } from "@/components/marketing/mac/ShortcutTable";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { JsonLd, pageMetadata, softwareLd } from "@/components/marketing/seo";
import { SIGN_UP_URL, WEB_APP_URL } from "@/components/marketing/site";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Folevi for Mac: notes, Quick Add and offline (coming soon)",
  description:
    "Folevi for Mac is the full Folevi app in its own window, plus Quick Add from any app, a menu bar icon, Mac notifications and offline editing. Requires macOS 13 or later on Apple silicon. Coming soon.",
  path: "/mac",
});

const features: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "keyboard",
    title: "Keyboard first",
    body: "Press ⌘N for a new note from anywhere in the app, and use the same shortcuts as on the web to search, move blocks and change headings without leaving the keys.",
  },
  {
    icon: "offline",
    title: "Offline by design",
    body: "Your notes are kept on your Mac, as they are in the browser. Write on a train or a plane; changes sync when you reconnect, and the menu bar icon shows whether everything is saved.",
  },
  {
    icon: "window",
    title: "As many windows as you need",
    body: "Open pages in separate windows with ⇧⌘N, put them side by side, and use full screen and Spaces the way you already do.",
  },
  {
    icon: "mail",
    title: "Notifications and a Dock badge",
    body: "Comments, mentions and reminders arrive as Mac notifications while Folevi is in the background, and the Dock icon shows how many are unread.",
  },
  {
    icon: "finder",
    title: "Drag from Finder",
    body: "Drop images and files from Finder straight onto a page. They upload in the background, even if you go offline midway.",
  },
  {
    icon: "sparkle",
    title: "Quick Add from any app",
    body: "Press ⌥Space in any app, or pick Quick Add in the menu bar, to add a task without switching to Folevi. You can change the shortcut in Settings.",
  },
];

export default function MacPage() {
  const art = artById("art-39");
  return (
    <>
      <JsonLd data={softwareLd()} />
      <PageFrame art="art-39">
        <HeaderCard>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
            <div>
              <Eyebrow>Folevi for Mac</Eyebrow>
              <h1 className="mk-display mt-4 max-w-[15ch] text-[44px] sm:text-[60px] lg:text-[68px]">Folevi, in a window of its own.</h1>
              <p className="mk-lede mt-6 max-w-[50ch]">
                Folevi for Mac is the same app as the web, with every feature, plus Quick Add from any app, a menu bar icon and
                Mac notifications. Notes are kept on your Mac, so writing never waits for the network.
              </p>
            </div>
            <div className="mk-card p-6 sm:p-7">
              <p className="mk-chip">Coming soon</p>
              <p className="mt-4 text-[15px] leading-relaxed text-muted">
                The Mac app isn’t available to download yet. Create a Folevi account and we’ll email you when it’s ready.
                Until then, everything works on the web, and your account, plan and notes carry over.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <ButtonLink href={SIGN_UP_URL} icon="arrow-right">
                  Create an account
                </ButtonLink>
                <ButtonLink href={WEB_APP_URL} variant="secondary">
                  Open the web app
                </ButtonLink>
              </div>
              <p className="mt-5 text-[13px] text-muted">Requires macOS 13 or later on a Mac with Apple silicon.</p>
            </div>
          </div>

        </HeaderCard>
        <Card as="div" inner="p-4 sm:p-5">
          <div className="mk-stage p-4 sm:p-8" style={{ ["--stage-art" as string]: artThumb(art) }}>
            <MacMenuBar initial="File" />
            <AppWindow
              art={art}
              note={READING_NOTE}
              sidebar="main"
              chrome="mac"
              active={null}
              label="Folevi for Mac: the sidebar with Home, Drafts, Tasks and folders, and a note called Reading list open in a tab."
              className="mt-4 h-[420px] sm:mt-6 sm:h-[560px]"
            />
          </div>
        </Card>

        <Card aria-labelledby="why-title">
          <SectionHeading id="why-title" eyebrow="What it adds" title="Everything on the web, plus a few things for the Mac." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title} className="mk-card p-6 sm:p-7">
                <span className="mk-tile">
                  <Icon name={feature.icon} size={17} />
                </span>
                <h3 className="mk-h3 mt-4 text-[16px]">{feature.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{feature.body}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="glass-title">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="relative">
              <SectionHeading id="glass-title" eyebrow="On your Mac" title="A clean window, and Folevi in the menu bar." />
              <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-muted">
                <p>
                  The window has no title bar. The close, minimize and full screen buttons sit at the top of the sidebar,
                  so the page gets the whole window.
                </p>
                <p>
                  The menu bar icon has Quick Add, a new note, your recent notes and whether everything is saved. Folevi
                  can open at login without a window, so Quick Add is ready when you need it.
                </p>
              </div>
            </div>
            <div className="relative self-center">
              <h3 className="mk-caps">System requirements</h3>
              <dl className="mk-card mt-4 px-5 text-[15px]">
                {[
                  ["macOS", "macOS 13 or later"],
                  ["Mac", "Apple silicon (M1 or later)"],
                  ["Account", "A Folevi account"],
                  ["Availability", "Coming soon. We’ll email your account when it’s ready"],
                ].map(([term, detail], index) => (
                  <div key={term} className={cx("grid gap-1 py-4 sm:grid-cols-[110px_1fr] sm:gap-4", index > 0 && "border-t mk-hair")}>
                    <dt className="text-muted">{term}</dt>
                    <dd className="font-medium text-ink">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="keys-title">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <SectionHeading
              id="keys-title"
              eyebrow="Keyboard"
              title="Hands stay on the keys."
              lede="Most of these work on the web too. ⌘N, ⇧⌘N and ⌥Space are the Mac app’s own; on the web, ⌥⌘N makes a new note."
              className="lg:sticky lg:top-12 lg:self-start"
            />
            <div className="mk-card p-5 sm:p-7">
              <ShortcutTable caption="Keyboard shortcuts in Folevi for Mac" />
            </div>
          </div>
        </Card>

        <Card aria-labelledby="web-title">
          <SectionHeading
            align="center"
            id="web-title"
            eyebrow="Also on the web"
            title="The same notes in any browser."
            lede="Folevi on the web has the same pages, tasks and search, syncs in real time with your Mac, and keeps working offline once it’s loaded."
          />
          <div className="mx-auto mt-12 max-w-[1080px]">
            <AppWindow
              art={artById("art-03")}
              label="Folevi on the web: the page sidebar with the note’s table of contents, and a note called Seed library in the Irises theme."
              className="h-[440px] sm:h-[560px]"
            />
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
              Start writing
            </ButtonLink>
          </div>
        </Card>
      </PageFrame>
    </>
  );
}
