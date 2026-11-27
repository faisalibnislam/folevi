import { Icon, type IconName } from "@/components/marketing/icons";
import { Checks } from "@/components/marketing/Checks";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { pageMetadata } from "@/components/marketing/seo";
import Link from "next/link";
import { SIGN_UP_URL, WEB_APP_URL, WINDOWS_REQUIREMENT, WINDOWS_SMARTSCREEN_NOTE } from "@/components/marketing/site";
import { LibraryPlaces } from "@/components/marketing/mac/LibraryPlaces";
import { WindowsDownload } from "@/components/marketing/WindowsDownload";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";
import { Float, Mark, Sticker } from "@/components/marketing/fun";
import { KeysPiece, SyncPiece } from "@/components/marketing/pieces";

// Folevi for Windows (apps/desktop, Tauri). Every claim here is in docs/DESKTOP_APP.md, docs/DESKTOP_PARITY.md or
// CHANGELOG.md. The installers aren't signed yet, so the SmartScreen note stays until they are.

export const metadata = pageMetadata({
  title: "Folevi for Windows: a free workspace for notes, no account",
  description:
    "Docs, tasks and databases on your PC, free with no account. Keep notes in any folder, such as OneDrive’s. Quick Add, Windows Hello lock, updates itself. For x64 and Arm PCs.",
  path: "/windows",
});

const features: Array<{ icon: IconName; title: string }> = [
  { icon: "keyboard", title: "Quick Add on Ctrl+Alt+Space" },
  { icon: "lock", title: "App lock with Windows Hello" },
  { icon: "mail", title: "Notifications you can reply to" },
  { icon: "menu", title: "New note from the Jump List" },
  { icon: "window", title: "Float a note above other apps" },
  { icon: "sync", title: "Other places sync in the background" },
  { icon: "search", title: "Search the text in images" },
  { icon: "link", title: "Share a note with Windows Share" },
  { icon: "sparkle", title: "Spell check and Tab prediction" },
];

export default function WindowsPage() {
  const art = artById("art-12");
  return (
    <PageFrame art="art-12">
      <HeaderCard>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div>
            <Eyebrow>Folevi for Windows</Eyebrow>
            <h1 className="mk-display mt-5 max-w-[13ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
              Folevi, right on your <Mark>PC</Mark>.
            </h1>
            <p className="mk-lede mt-6 max-w-[50ch]">
              Your workspace for docs, tasks and databases as a Windows app, free forever with no account. It has Quick
              Add, a tray icon and Windows notifications.
            </p>
          </div>
          <div className="mk-card relative p-6 pt-12 sm:p-7 sm:pt-14">
            <p className="absolute -top-5 left-5 sm:-left-4">
              <Sticker tone="violet" rotate={-8} className="px-5 py-2.5 text-[19px] sm:text-[22px]">
                Free
              </Sticker>
            </p>
            <p className="text-[15px] leading-relaxed text-muted">Run the installer and Folevi opens. It updates itself.</p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <WindowsDownload />
              <ButtonLink href={WEB_APP_URL} variant="secondary">
                Open the web app
              </ButtonLink>
            </div>
            <p className="mt-5 text-[13px] text-muted">{WINDOWS_REQUIREMENT}.</p>
            <p className="mt-2 text-[13px] text-muted">{WINDOWS_SMARTSCREEN_NOTE}</p>
          </div>
        </div>
        <Float depth={0.14} delay={300} className="right-[5%] top-5 hidden xl:block [--tilt:4deg]">
          <KeysPiece keys={["Ctrl", "Alt", "Space"]} label="Quick Add" />
        </Float>
      </HeaderCard>
      <Card as="div" inner="p-4 sm:p-5">
        <div className="mk-stage p-4 sm:p-8" style={{ ["--stage-art" as string]: artThumb(art) }}>
          <AppWindow
            art={art}
            note={READING_NOTE}
            sidebar="main"
            active={null}
            label="Folevi for Windows: the sidebar with Home, Drafts, Tasks and folders, and a note called Reading list open in a tab."
            className="h-[420px] sm:h-[560px]"
          />
        </div>
      </Card>

      <Card tint aria-labelledby="why-title" className="relative">
        <Float depth={0.12} className="right-[10%] top-24 hidden xl:block [--tilt:3deg]">
          <SyncPiece label="Saved on this PC" />
        </Float>
        <SectionHeading
          id="why-title"
          eyebrow="What it adds"
          title={
            <>
              Everything on the web, plus <Mark kind="circle">more</Mark>.
            </>
          }
          lede="The same Folevi you know from the web, with the parts of Windows you already use."
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

      <Card aria-labelledby="local-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
          <div className="relative">
            <SectionHeading
              id="local-title"
              eyebrow="No account"
              title={
                <>
                  Your notes, in a folder <Mark kind="squiggle">you pick</Mark>.
                </>
              }
              lede="Choose Keep notes on my devices when Folevi opens. It’s free forever and needs no account."
            />
            <Checks
              className="mt-6"
              items={[
                <>Each note is a file in your folder, with a small index beside them</>,
                <>Pick any folder, such as one OneDrive keeps in sync, or keep it on this PC in Documents</>,
                <>Folevi’s servers never see these notes</>,
                <>Foli AI runs on your own OpenAI, Anthropic or Google key, sent straight from your PC</>,
              ]}
            />
            <p className="mt-6 max-w-[54ch] text-[14px] leading-relaxed text-muted">
              Sharing, public pages, workspaces and AI credits need a Folevi account. You can sign in to Folevi Cloud or
              to <Link href="/server" className="underline underline-offset-2">your own Folevi Server</Link> instead.
            </p>
          </div>
          <LibraryPlaces className="mx-auto w-full max-w-[420px]" kinds={["folder", "device"]} />
        </div>
      </Card>

      <Card tint aria-labelledby="pc-title">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative">
            <SectionHeading id="pc-title" eyebrow="On your PC" title="Its own title bar and a tray icon." />
            <p className="mk-lede mt-4 max-w-[54ch]">Windows 11-style caption buttons, Segoe UI Variable and your accent color.</p>
            <Checks
              className="mt-6"
              items={[
                <>Can open at sign-in, waiting in the tray</>,
                <>New note, Quick Add and today’s tasks when you right-click Folevi in the taskbar</>,
                <>Your windows open again where they were, each at its page</>,
                <>Record a call with the microphone and the sound your PC plays</>,
              ]}
            />
          </div>
          <div className="relative self-center">
            <h3 className="mk-caps">System requirements</h3>
            <dl className="mk-card mt-4 px-5 text-[15px]">
              {[
                ["Windows", WINDOWS_REQUIREMENT],
                ["Account", "Not needed: notes can live in a folder you pick"],
                ["Download", "Free, from this page. Folevi checks for updates and installs them when you say so"],
                ["Store", "Not in the Microsoft Store yet"],
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

      <Card aria-labelledby="more-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-end lg:gap-16">
          <SectionHeading
            id="more-title"
            eyebrow="Also on the Mac and Linux"
            title={
              <>
                The same workspace on every <Mark>computer</Mark>.
              </>
            }
            lede="Folevi for Mac and Folevi for Linux are free with no account too. With a Folevi account, your pages sync across all of them."
          />
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink href="/mac" lead="mac">
              Folevi for Mac
            </ButtonLink>
            <ButtonLink href="/linux" variant="secondary">
              Folevi for Linux
            </ButtonLink>
            <ButtonLink href="/apps" variant="secondary">
              All the apps
            </ButtonLink>
          </div>
        </div>
      </Card>

      <Card tint aria-labelledby="web-title">
        <SectionHeading
          align="center"
          id="web-title"
          eyebrow="Also on the web"
          title={
            <>
              The same workspace in <Mark kind="squiggle">any browser</Mark>.
            </>
          }
          lede="With a Folevi account, your pages sync in real time with your PC and you can invite your team. The web app works offline once loaded."
        />
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
            Start writing
          </ButtonLink>
        </div>
      </Card>
    </PageFrame>
  );
}
