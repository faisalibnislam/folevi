import { Icon, type IconName } from "@/components/marketing/icons";
import { MacMenuBar } from "@/components/marketing/mac/MacMenuBar";
import { ShortcutTable } from "@/components/marketing/mac/ShortcutTable";
import { Checks } from "@/components/marketing/Checks";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { JsonLd, pageMetadata, softwareLd } from "@/components/marketing/seo";
import { MAC_DOWNLOAD_URL, SIGN_UP_URL, WEB_APP_URL } from "@/components/marketing/site";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";
import { Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { KeysPiece, SyncPiece } from "@/components/marketing/pieces";

export const metadata = pageMetadata({
  title: "Folevi for Mac: notes, Quick Add and offline",
  description:
    "Folevi for Mac is the full Folevi app in its own window, plus Quick Add from any app, a menu bar icon, Mac notifications and offline editing. Free to download. Requires macOS 15 or later.",
  path: "/mac",
});

const features: Array<{ icon: IconName; title: string }> = [
  { icon: "keyboard", title: "Keyboard first" },
  { icon: "offline", title: "Offline by design" },
  { icon: "window", title: "As many windows as you need" },
  { icon: "mail", title: "Notifications and a Dock badge" },
  { icon: "finder", title: "Drag from Finder" },
  { icon: "sparkle", title: "Quick Add from any app" },
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
              <h1 className="mk-display mt-5 max-w-[13ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
                Folevi, in a window of <Mark>its own</Mark>.
              </h1>
              <p className="mk-lede mt-6 max-w-[50ch]">Quick Add, a menu bar icon and Mac notifications.</p>
            </div>
            <div className="mk-card relative p-6 pt-12 sm:p-7 sm:pt-14">
              <p className="absolute -top-5 left-5 sm:-left-4">
                <Sticker tone="violet" rotate={-8} className="px-5 py-2.5 text-[19px] sm:text-[22px]">
                  Free
                </Sticker>
              </p>
              <p className="text-[15px] leading-relaxed text-muted">Open the download and drag Folevi to Applications. It updates itself.</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <ButtonLink href={MAC_DOWNLOAD_URL} icon="arrow-down">
                  Download for Mac
                </ButtonLink>
                <ButtonLink href={WEB_APP_URL} variant="secondary">
                  Open the web app
                </ButtonLink>
              </div>
              <p className="mt-5 text-[13px] text-muted">macOS 15 or later, Apple silicon or Intel.</p>
            </div>
          </div>
          <Float depth={0.14} delay={300} className="right-[5%] top-5 hidden xl:block [--tilt:4deg]">
            <KeysPiece keys={["⌥", "Space"]} label="Quick Add" />
          </Float>
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

        <Card tint aria-labelledby="why-title" className="relative">
          <Float depth={0.12} className="right-[10%] top-24 hidden xl:block [--tilt:3deg]">
            <SyncPiece label="Saved on this Mac" />
          </Float>
          <SectionHeading
            id="why-title"
            eyebrow="What it adds"
            title={
              <>
                Everything on the web, plus <Mark kind="circle">more</Mark>.
              </>
            }
            lede="Notes are kept on your Mac, so writing never waits."
          />
          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title} className="mk-card flex items-center gap-3.5 p-4 sm:p-5">
                <span className="mk-tile flex-none">
                  <Icon name={feature.icon} size={17} />
                </span>
                <h3 className="mk-h3 text-[16px]">{feature.title}</h3>
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="glass-title">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="relative">
              <SectionHeading id="glass-title" eyebrow="On your Mac" title="A clean window and a menu bar icon." />
              <p className="mk-lede mt-4 max-w-[54ch]">No title bar, so the page gets the whole window.</p>
              <Checks
                className="mt-6"
                items={[
                  <>Quick Add and a new note from the menu bar</>,
                  <>Recent notes, and whether everything is saved</>,
                  <>Opens at login without a window</>,
                ]}
              />
            </div>
            <div className="relative self-center">
              <h3 className="mk-caps">System requirements</h3>
              <dl className="mk-card mt-4 px-5 text-[15px]">
                {[
                  ["macOS", "macOS 15 or later"],
                  ["Mac", "Apple silicon or Intel"],
                  ["Account", "Optional: notes can stay on this Mac"],
                  ["Download", "Free, from this page. Updates install themselves"],
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

        <Card tint aria-labelledby="keys-title">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="lg:sticky lg:top-12 lg:self-start">
              <SectionHeading
                id="keys-title"
                eyebrow="Keyboard"
                title={
                  <>
                    Hands stay on the <Mark kind="squiggle">keys</Mark>.
                  </>
                }
                lede="Most work on the web too; ⌘N, ⇧⌘N and ⌥Space are Mac only."
              />
              <div aria-hidden="true" className="pointer-events-none mt-12 hidden pl-16 xl:block">
                <Hand rotate={-5} arrow="up-left">
                  try ⌥Space first
                </Hand>
              </div>
            </div>
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
            title={
              <>
                The same notes in <Mark kind="squiggle">any browser</Mark>.
              </>
            }
            lede="Syncs in real time with your Mac, and works offline once loaded."
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
