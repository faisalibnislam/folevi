import { Icon, type IconName } from "@/components/marketing/icons";
import { BetaBadge, BetaNote } from "@/components/marketing/Beta";
import { Checks } from "@/components/marketing/Checks";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { pageMetadata } from "@/components/marketing/seo";
import { SIGN_UP_URL, WEB_APP_URL } from "@/components/marketing/site";
import { LibraryPlaces } from "@/components/marketing/mac/LibraryPlaces";
import { LinuxDownload } from "@/components/marketing/LinuxDownload";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";
import { Float, Mark, Sticker } from "@/components/marketing/fun";
import { KeysPiece, SyncPiece } from "@/components/marketing/pieces";

// Folevi for Linux (apps/desktop, Tauri; packaging/linux), in Beta (lib/beta.ts). Every claim here is in
// docs/DESKTOP_APP.md, docs/DESKTOP_PARITY.md, docs/LINUX.md or handoff/state/linux.md.

export const metadata = pageMetadata({
  title: "Folevi for Linux (Beta): a free workspace for notes, no account",
  description:
    "Docs, tasks and databases on Linux, free with no account. AppImage, .deb and .rpm for x86_64 and aarch64, signed apt and rpm repositories, and the Snap Store. In Beta.",
  path: "/linux",
});

const features: Array<{ icon: IconName; title: string }> = [
  { icon: "keyboard", title: "Quick Add on Ctrl+Alt+Space" },
  { icon: "menu", title: "A tray icon and launcher actions" },
  { icon: "mail", title: "Notifications with buttons" },
  { icon: "lock", title: "App lock with a passphrase" },
  { icon: "sync", title: "Other places sync in the background" },
  { icon: "sparkle", title: "Spell check and Tab prediction" },
];

export default function LinuxPage() {
  const art = artById("art-16");
  return (
    <PageFrame art="art-16">
      <HeaderCard>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>Folevi for Linux</Eyebrow>
              <BetaBadge />
            </div>
            <h1 className="mk-display mt-5 max-w-[13ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
              Folevi, at home on <Mark>Linux</Mark>.
            </h1>
            <p className="mk-lede mt-6 max-w-[50ch]">
              Your workspace for docs, tasks and databases as a Linux app, free forever with no account. It has Quick
              Add, a tray icon and desktop notifications.
            </p>
          </div>
          <div className="mk-card relative p-6 pt-12 sm:p-7 sm:pt-14">
            <p className="absolute -top-5 left-5 sm:-left-4">
              <Sticker tone="violet" rotate={-8} className="px-5 py-2.5 text-[19px] sm:text-[22px]">
                Free
              </Sticker>
            </p>
            <p className="text-[15px] leading-relaxed text-muted">
              An AppImage, .deb or .rpm, for Intel and AMD or ARM computers. Pick yours below.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <ButtonLink href="#download">Download for Linux</ButtonLink>
              <ButtonLink href={WEB_APP_URL} variant="secondary">
                Open the web app
              </ButtonLink>
            </div>
            <BetaNote className="mt-5" />
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
            label="Folevi for Linux: the sidebar with Home, Drafts, Tasks and folders, and a note called Reading list open in a tab."
            className="h-[420px] sm:h-[560px]"
          />
        </div>
      </Card>

      <Card tint id="download" aria-labelledby="download-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div>
            <SectionHeading
              id="download-title"
              eyebrow="Download"
              title={
                <>
                  Pick the package for your <Mark kind="squiggle">system</Mark>.
                </>
              }
              lede="Each comes for x86_64 (Intel and AMD) and aarch64 (ARM)."
            />
            <div className="mt-8">
              <LinuxDownload />
            </div>
          </div>
          <div className="self-center">
            <h3 className="mk-caps">Updates</h3>
            <Checks
              className="mt-4"
              items={[
                <>The AppImage updates itself: Folevi asks, then installs and restarts</>,
                <>The .deb and .rpm add Folevi’s signed apt or rpm repository, so updates come through Software Updater, dnf or zypper</>,
                <>Folevi is also in the Snap Store, which keeps it up to date</>,
              ]}
            />
            <p className="mt-6 max-w-[54ch] text-[14px] leading-relaxed text-muted">Folevi isn’t on Flathub yet.</p>
          </div>
        </div>
      </Card>

      <Card aria-labelledby="why-title" className="relative">
        <Float depth={0.12} className="right-[10%] top-24 hidden xl:block [--tilt:3deg]">
          <SyncPiece label="Saved on this computer" />
        </Float>
        <SectionHeading
          id="why-title"
          eyebrow="What it adds"
          title={
            <>
              Everything on the web, plus <Mark kind="circle">more</Mark>.
            </>
          }
          lede="The same Folevi you know from the web, at home on your desktop."
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
        <p className="mt-8 max-w-[64ch] text-[14px] leading-relaxed text-muted">
          On Wayland, your desktop asks once before Folevi can use the Quick Add keys (GNOME 48 or later, KDE Plasma
          5.27 or later). On older GNOME, Settings &gt; Desktop app shows a command to add as a custom shortcut. Folevi
          for Linux doesn’t have Share or text in images yet, and it records the microphone only.
        </p>
      </Card>

      <Card tint aria-labelledby="local-title">
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
                <>Pick any folder, or keep it on this computer in Documents</>,
                <>Folevi’s servers never see these notes</>,
                <>Foli AI runs on your own OpenAI, Anthropic or Google key, sent straight from your computer</>,
              ]}
            />
            <p className="mt-6 max-w-[54ch] text-[14px] leading-relaxed text-muted">
              Sharing, public pages, workspaces and AI credits need a Folevi account. You can sign in to Folevi Cloud or
              to your own Folevi Server instead.
            </p>
          </div>
          <LibraryPlaces
            className="mx-auto w-full max-w-[420px]"
            kinds={["folder", "device"]}
            details={{ folder: "Any folder, such as one a sync app keeps up to date." }}
          />
        </div>
      </Card>

      <Card aria-labelledby="desktop-title">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative">
            <SectionHeading id="desktop-title" eyebrow="On your desktop" title="Fits in with your desktop." />
            <p className="mk-lede mt-4 max-w-[54ch]">Folevi uses your window manager’s title bar and your desktop’s own file dialogs.</p>
            <Checks
              className="mt-6"
              items={[
                <>New note, Quick Add and today’s tasks when you right-click Folevi in the launcher</>,
                <>Your windows open again where they were, each at its page</>,
                <>Notifications with Mark as read, Complete and Snooze</>,
                <>Can open at sign-in, waiting in the tray</>,
              ]}
            />
          </div>
          <div className="relative self-center">
            <h3 className="mk-caps">System requirements</h3>
            <dl className="mk-card mt-4 px-5 text-[15px]">
              {[
                ["Systems", "Ubuntu 22.04, Debian 12, Linux Mint 21, Fedora 40, RHEL, Alma and Rocky 9 or later, openSUSE Leap 15.6 and Tumbleweed, and Arch with the AppImage"],
                ["Computer", "x86_64 (Intel and AMD) or aarch64 (ARM)"],
                ["Account", "Not needed: notes can live in a folder you pick"],
                ["Download", "Free, from this page or the Snap Store"],
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

      <Card tint aria-labelledby="more-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-end lg:gap-16">
          <SectionHeading
            id="more-title"
            eyebrow="Also on the Mac and Windows"
            title={
              <>
                The same workspace on every <Mark>computer</Mark>.
              </>
            }
            lede="Folevi for Mac and Folevi for Windows are free with no account too. With a Folevi account, your pages sync across all of them."
          />
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink href="/mac" lead="mac">
              Folevi for Mac
            </ButtonLink>
            <ButtonLink href="/windows" variant="secondary">
              Folevi for Windows
            </ButtonLink>
            <ButtonLink href="/apps" variant="secondary">
              All the apps
            </ButtonLink>
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
              The same workspace in <Mark kind="squiggle">any browser</Mark>.
            </>
          }
          lede="With a Folevi account, your pages sync in real time with your computer and you can invite your team. The web app works offline once loaded."
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
