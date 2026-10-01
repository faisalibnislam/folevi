import { Icon, type IconName } from "@/components/marketing/icons";
import { MacMenuBar } from "@/components/marketing/mac/MacMenuBar";
import { ShortcutTable } from "@/components/marketing/mac/ShortcutTable";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { JsonLd, pageMetadata, softwareLd } from "@/components/marketing/seo";
import { SIGN_UP_URL, WEB_APP_URL } from "@/components/marketing/site";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Mac notes app: native and offline (coming soon)",
  description:
    "A native Mac app for Folevi, with real menus, keyboard shortcuts, windows and offline editing. Requires macOS 15 or later. Coming soon.",
  path: "/mac",
});

const features: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "keyboard",
    title: "Keyboard first",
    body: "Every command is in the menu bar with its shortcut. Create, search, move blocks and change headings without leaving the keys.",
  },
  {
    icon: "offline",
    title: "Offline by design",
    body: "Your notes are stored on your Mac. Write on a train or a plane; changes sync when you reconnect, and the toolbar always shows whether you’re Saved, Offline or Syncing.",
  },
  {
    icon: "window",
    title: "As many windows as you need",
    body: "Open pages in separate windows with ⇧⌘N, put them side by side, and use full screen and Spaces the way you already do.",
  },
  {
    icon: "eye",
    title: "Quick Look",
    body: "Press Space on an attached file to preview it with Quick Look, without opening another app.",
  },
  {
    icon: "finder",
    title: "Drag from Finder",
    body: "Drop images and files from Finder straight onto a page. They upload in the background, even if you go offline midway.",
  },
  {
    icon: "sparkle",
    title: "Quick Add from the menu bar",
    body: "Catch a thought from anywhere with Quick Add in the menu bar. It lands in Drafts, ready to be shaped later.",
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
              <h1 className="mk-display mt-4 max-w-[15ch] text-[44px] sm:text-[60px] lg:text-[68px]">Folevi as a native Mac app.</h1>
              <p className="mk-lede mt-6 max-w-[50ch]">
                The Mac app has the menus, windows and keyboard shortcuts you expect. Notes are stored on your Mac, so writing
                never waits for the network.
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
              <p className="mt-5 text-[13px] text-muted">Requires macOS 15 or later.</p>
            </div>
          </div>

        </HeaderCard>
        <Card as="div" inner="p-3 sm:p-5">
          <div className="mk-stage p-3 sm:p-8" style={{ ["--stage-art" as string]: artThumb(art) }}>
            <MacMenuBar initial="View" />
            <AppWindow
              art={art}
              note={READING_NOTE}
              sidebar="main"
              chrome="mac"
              active={null}
              label="The Folevi Mac app: the sidebar with Home, Drafts, Tasks and folders, and a note called Reading list open in a tab."
              className="mt-4 h-[420px] sm:mt-6 sm:h-[560px]"
            />
          </div>
        </Card>

        <Card aria-labelledby="why-title">
          <SectionHeading id="why-title" eyebrow="Why native" title="It should feel like it came with your Mac." />
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
              <SectionHeading id="glass-title" eyebrow="Designed for macOS 26" title="Liquid Glass where it belongs. Solid everywhere else." />
              <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-muted">
                <p>
                  On macOS 26, toolbars, the sidebar and popovers use Liquid Glass, so Folevi sits naturally next to the
                  rest of your apps. Your writing stays on a calm, solid page. Glass is for chrome, never for text.
                </p>
                <p>
                  On macOS 15, the same app uses the standard materials of that release. Every feature works the same;
                  only the finish changes.
                </p>
              </div>
            </div>
            <div className="relative self-center">
              <h3 className="mk-caps">System requirements</h3>
              <dl className="mk-card mt-4 px-5 text-[15px]">
                {[
                  ["macOS", "macOS 15 or later"],
                  ["Best on", "macOS 26, with Liquid Glass"],
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
              lede="The shortcuts below are the ones in the menus today. You’ll find the full list, including the web equivalents, in the documentation."
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
              label="Folevi on the web: the page sidebar with the note’s table of contents, and a note called Seed library in the Irises style."
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
