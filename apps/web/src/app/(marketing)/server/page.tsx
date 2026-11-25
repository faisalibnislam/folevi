import { Globe, Laptop, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { Checks } from "@/components/marketing/Checks";
import { Mark, Sticker } from "@/components/marketing/fun";
import { pageMetadata } from "@/components/marketing/seo";
import { APP_STORE_URL, MAC_DOWNLOAD_URL } from "@/components/marketing/site";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";
import {
  SYNOLOGY_PACKAGE_SOURCE_URL,
  fetchServerManifest,
  formatReleaseDay,
  installCommand,
  serverFile,
  type ServerManifest,
} from "@/components/marketing/server/manifest";
import { ChipDownloads, ComingSoon, CopyLine, DownloadRow, PlatformTitle, Steps, WhichChip } from "@/components/marketing/server/parts";

export const metadata = pageMetadata({
  title: "Folevi Server: your notes on your own NAS or server",
  description:
    "Run Folevi on your Synology, QNAP, Unraid or TrueNAS, or on a Linux server. Install it from your NAS’s app store and keep using the normal Folevi apps.",
  path: "/server",
});

// Re-read the release manifest about every ten minutes (SERVER_MANIFEST_REVALIDATE in components/marketing/server/manifest.ts).
export const revalidate = 600;

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Folevi Server", path: "/server" },
];

const APPS: Array<{ icon: LucideIcon; name: string }> = [
  { icon: Laptop, name: "Mac" },
  { icon: Smartphone, name: "iPhone and Android" },
  { icon: Tablet, name: "iPad" },
  { icon: Globe, name: "Any browser" },
];

function Release({ manifest }: { manifest: ServerManifest | null }) {
  if (!manifest)
    return (
      <p className="text-[15px] leading-relaxed text-muted">
        The first beta is almost ready. The downloads appear on this page as soon as it’s out.
      </p>
    );
  return (
    <>
      <p className="mk-caps">Latest release</p>
      <p className="mk-h3 mt-1 text-[26px]">Version {manifest.version}</p>
      {manifest.releasedAt ? <p className="mt-1 text-[14px] text-muted">Released {formatReleaseDay(manifest.releasedAt)}</p> : null}
      <div className="mt-6 flex flex-wrap gap-2.5">
        <ButtonLink href="#nas">Get Folevi Server</ButtonLink>
        {manifest.notesUrl ? (
          <ButtonLink href={manifest.notesUrl} variant="secondary">
            Release notes
          </ButtonLink>
        ) : null}
      </div>
    </>
  );
}

export default async function ServerPage() {
  const manifest = await fetchServerManifest();
  const command = installCommand(manifest);
  const hasSynology = Boolean(serverFile(manifest, "synology", "x86_64") || serverFile(manifest, "synology", "aarch64"));
  return (
    <PageFrame>
      <HeaderCard crumbs={CRUMBS}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:gap-16">
          <div>
            <Eyebrow>Folevi Server</Eyebrow>
            <h1 className="mk-display mt-5 max-w-[14ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px]">
              Your notes on your own <Mark>NAS</Mark> or server.
            </h1>
            <p className="mk-lede mt-6 max-w-[52ch]">
              Folevi Server runs the whole Folevi workspace on a machine you own. It works like Plex: install it from your
              NAS’s app store, open the admin panel and add your people. Everyone keeps using the normal Folevi apps.
            </p>
            <Checks
              className="mt-6"
              items={[
                <>Email, notifications and Foli AI work out of the box</>,
                <>Nothing about your notes passes through Folevi</>,
                <>Updates come from your NAS’s app store, with a backup taken first</>,
              ]}
            />
          </div>
          <div className="mk-card relative p-6 pt-12 sm:p-7 sm:pt-14">
            <p className="absolute -top-5 left-5 sm:-left-4">
              <Sticker tone="violet" rotate={-8} className="px-5 py-2.5 text-[19px] sm:text-[22px]">
                Beta
              </Sticker>
            </p>
            <Release manifest={manifest} />
          </div>
        </div>
      </HeaderCard>

      <Card id="nas" aria-labelledby="nas-title" className="scroll-mt-20">
        <SectionHeading
          id="nas-title"
          eyebrow="Synology and QNAP"
          title={
            <>
              Install it from <Mark kind="squiggle">Package Center</Mark> or App Center.
            </>
          }
          lede="Pick the download for your NAS’s chip. Folevi asks which shared folder to keep its data in, so your NAS’s snapshots and backups cover it."
        />
        <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:gap-10 [&>*]:min-w-0">
          <div>
            <PlatformTitle name="Synology" detail="DSM 7.2 or later" />
            <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ink">
              Add Folevi’s package source once in Package Center, under Settings, then Package Sources. Folevi then shows up in
              Package Center with an Update button. You can also download the package and use Manual Install.
            </p>
            {hasSynology ? (
              <CopyLine className="mt-4" value={SYNOLOGY_PACKAGE_SOURCE_URL} label="Folevi’s Synology package source" />
            ) : (
              <p className="mt-4 flex items-center gap-3 text-[14px] text-muted">
                Package source <ComingSoon />
              </p>
            )}
            <ChipDownloads className="mt-5" manifest={manifest} platform="synology" product="Folevi Server for Synology" />
            <WhichChip where="In DSM, open Control Panel, then Info Center. The CPU line names your processor." />
          </div>
          <div>
            <PlatformTitle name="QNAP" detail="QTS 5 or QuTS hero" />
            <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ink">
              Download the package, then open App Center, click Install Manually and choose the file.
            </p>
            <p className="mk-panel mt-4 px-4 py-3 text-[14px] leading-relaxed text-ink">
              QNAP hasn’t signed Folevi yet. Until it does, turn on “Allow installation of applications without a valid
              digital signature” in App Center, under Settings, then General. Install Folevi, then turn it off again.
            </p>
            <ChipDownloads className="mt-5" manifest={manifest} platform="qnap" product="Folevi Server for QNAP" />
            <WhichChip where="In QTS, open Control Panel, then System Status. System Information names your processor." />
          </div>
        </div>
      </Card>

      <Card tint aria-labelledby="more-nas-title">
        <SectionHeading
          id="more-nas-title"
          eyebrow="More NAS brands"
          title="ASUSTOR, TerraMaster and UGREEN."
          lede="Download the package for your NAS’s chip and install it from the NAS’s app center."
        />
        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-6 [&>*]:min-w-0">
          {(
            [
              ["asustor", "ASUSTOR", "ADM 4 or later", "In App Central, choose Manual Install."],
              ["terramaster", "TerraMaster", "TOS 6", "In App Center, install from a local file."],
              ["ugreen", "UGREEN", "UGOS Pro", "In App Center, install from a local file."],
            ] as const
          ).map(([platform, name, detail, how]) => (
            <div key={platform}>
              <PlatformTitle name={name} detail={detail} />
              <p className="mt-2 text-[14px] text-muted">{how}</p>
              <ChipDownloads className="mt-4" manifest={manifest} platform={platform} product={`Folevi Server for ${name}`} />
            </div>
          ))}
        </div>
      </Card>

      <Card aria-labelledby="stores-title">
        <SectionHeading
          id="stores-title"
          eyebrow="Unraid, TrueNAS and home server systems"
          title={
            <>
              A plugin, or one click in the <Mark kind="squiggle">app store</Mark>.
            </>
          }
          lede="These systems install Folevi from their own catalogs, so there’s nothing to download first."
          wide
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="mk-card p-5 sm:p-6">
            <PlatformTitle name="Unraid" detail="plugin" />
            <div className="mt-4">
              <Steps
                items={[
                  <>Open Plugins, then Install Plugin.</>,
                  <>Paste the address below and click Install.</>,
                  <>Folevi keeps its data in /mnt/user/appdata/folevi and starts with the array.</>,
                ]}
              />
            </div>
            {manifest?.unraidPluginUrl ? (
              <CopyLine className="mt-5" value={manifest.unraidPluginUrl} label="Folevi’s Unraid plugin address" />
            ) : (
              <p className="mt-5 flex items-center gap-3 text-[14px] text-muted">
                Plugin address <ComingSoon />
              </p>
            )}
          </div>
          <div className="mk-card p-5 sm:p-6">
            <PlatformTitle name="TrueNAS" detail="Community Edition 25.04 or later" />
            <div className="mt-4">
              <Steps
                items={[
                  <>Open Apps, then Discover Apps, and search for Folevi.</>,
                  <>Click Install, pick a dataset for Folevi’s data and keep the suggested port.</>,
                  <>Open Folevi from the Apps page to finish setup.</>,
                ]}
              />
            </div>
          </div>
          <div className="mk-card p-5 sm:p-6 lg:col-span-2">
            <PlatformTitle name="ZimaOS, CasaOS and Umbrel" detail="app store" />
            <div className="mt-4">
              <Steps
                items={[
                  <>Open the App Store and search for Folevi.</>,
                  <>Click Install.</>,
                  <>Open Folevi from your home screen to finish setup.</>,
                ]}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card tint id="linux" aria-labelledby="linux-title" className="scroll-mt-20">
        <SectionHeading
          id="linux-title"
          eyebrow="Linux servers"
          title={
            <>
              On DigitalOcean, Hetzner or any <Mark>Linux</Mark> server.
            </>
          }
          lede="Run one command on Debian 12 or later, or Ubuntu 22.04 or later. It adds Folevi’s package repository, installs Folevi Server as a system service and prints the setup address. Updates come with the system’s normal updates."
          wide
        />
        <div className="mt-8 max-w-[640px]">
          {command ? (
            <CopyLine value={command} label="the install command" />
          ) : (
            <p className="flex items-center gap-3 text-[14px] text-muted">
              Install command <ComingSoon />
            </p>
          )}
        </div>
        <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-10 [&>*]:min-w-0">
          <div>
            <h3 className="mk-caps">Packages</h3>
            <div className="mt-4 grid gap-3 [&>*]:min-w-0">
              <DownloadRow manifest={manifest} platform="deb" arch="x86_64" kind=".deb" product="Folevi Server" />
              <DownloadRow manifest={manifest} platform="deb" arch="aarch64" kind=".deb" product="Folevi Server" />
              <DownloadRow manifest={manifest} platform="rpm" arch="x86_64" kind=".rpm" product="Folevi Server" />
              <DownloadRow manifest={manifest} platform="rpm" arch="aarch64" kind=".rpm" product="Folevi Server" />
            </div>
          </div>
          <div className="space-y-10">
            <div>
              <h3 className="mk-caps">Container image</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink">
                The same server as a container, for Coolify, Dokploy, Railway and other container hosts.
              </p>
              {manifest?.dockerImage ? (
                <CopyLine className="mt-4" value={manifest.dockerImage} label="the container image" />
              ) : (
                <p className="mt-4 flex items-center gap-3 text-[14px] text-muted">
                  Container image <ComingSoon />
                </p>
              )}
            </div>
            <div>
              <h3 className="mk-caps">DigitalOcean</h3>
              <div className="mk-card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-[15px] font-medium text-(--color-heading)">1-Click Droplet</p>
                  <p className="mt-0.5 text-[13px] text-muted">A Droplet with Folevi Server already installed</p>
                </div>
                <ComingSoon />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card aria-labelledby="requirements-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <SectionHeading
            id="requirements-title"
            eyebrow="Requirements"
            title="What your NAS or server needs."
            lede="Most NAS models from the last few years are fine. Memory matters most."
          />
          <dl className="mk-card self-start px-5 text-[15px]">
            {[
              ["Processor", "64-bit: x86-64 (Intel or AMD) or ARM64"],
              ["Memory", "2 GB free, 4 GB recommended"],
              ["NAS", "Synology DSM 7.2+, QNAP QTS 5 or QuTS hero, ASUSTOR, TerraMaster, UGREEN, Unraid, TrueNAS Community Edition, ZimaOS, CasaOS, Umbrel"],
              ["Server", "Debian 12+, Ubuntu 22.04+, or any host that runs containers"],
            ].map(([term, detail], index) => (
              <div key={term} className={cx("grid gap-1 py-4 sm:grid-cols-[110px_1fr] sm:gap-4", index > 0 && "border-t mk-hair")}>
                <dt className="text-muted">{term}</dt>
                <dd className="font-medium text-ink">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card tint aria-labelledby="connect-title">
        <SectionHeading
          id="connect-title"
          eyebrow="Connect your apps"
          title={
            <>
              Everyone uses the normal <Mark kind="circle">Folevi</Mark> apps.
            </>
          }
          lede="On the Mac, iPhone, iPad, Android or the web, choose Your own server and enter your server’s address. If you linked the server to your Folevi account, it appears there on its own."
        />
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {APPS.map(({ icon: AppIcon, name }) => (
            <li key={name} className="mk-card flex items-center gap-3.5 p-4 sm:p-5">
              <span className="mk-tile flex-none">
                <AppIcon size={17} aria-hidden="true" />
              </span>
              <h3 className="mk-h3 text-[16px]">{name}</h3>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <ButtonLink href={MAC_DOWNLOAD_URL} lead="mac">
            Download for Mac
          </ButtonLink>
          <ButtonLink href={APP_STORE_URL} lead="app-store">
            Get it on the App Store
          </ButtonLink>
          <ButtonLink href="/apps" variant="secondary">
            All the apps
          </ButtonLink>
        </div>
      </Card>
    </PageFrame>
  );
}
