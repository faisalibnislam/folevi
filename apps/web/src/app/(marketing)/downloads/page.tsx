import { BetaBadge, BetaNote } from "@/components/marketing/Beta";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { DownloadsBar } from "@/components/marketing/DownloadsBar";
import { PlatformMark, type PlatformMarkName } from "@/components/marketing/PlatformMark";
import { pageMetadata } from "@/components/marketing/seo";
import { APP_STORE_URL, COMING_SOON_NOTE, IOS_REQUIREMENT, MAC_DOWNLOAD_URL, MAC_REQUIREMENT, WEB_APP_URL } from "@/components/marketing/site";
import { fetchServerManifest, formatSize, serverFile, SERVER_ARCHES, type ServerArch, type ServerManifest, type ServerPlatform } from "@/components/marketing/server/manifest";
import { Eyebrow, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Download Folevi for Mac, iPhone and iPad",
  description: `Every Folevi download in one place: Mac, iPhone and iPad, the web app and Folevi Server (Early Beta). ${COMING_SOON_NOTE}`,
  path: "/downloads",
});

// Folevi Server's rows come from its release manifest, read again about every ten minutes (as /server does).
export const revalidate = 600;

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Downloads", path: "/downloads" },
];

/** One download. `links`, when set, are its buttons (one per kind of PC); otherwise `href` and `action`. */
type Item = { name: string; detail: string; href?: string; action: string; links?: Array<{ label: string; href: string; describe: string }> };
/** `beta`: still in beta (lib/beta.ts): a Beta badge by the title and the Beta note under the list. */
type Platform = { id: string; title: string; mark: PlatformMarkName; note?: string; beta?: boolean; items: Item[] };

/**
 * A paused app's section (Android, Windows and Linux, owner 2026-11-28): one row with the muted "Coming soon"
 * chip and no link. Their download links stay in site.ts for when they come back.
 */
function comingSoon(id: string, mark: PlatformMarkName, title: string, detail: string): Platform {
  return { id, mark, title, items: [{ name: `Folevi for ${title}`, detail, action: "Coming soon" }] };
}

/** Every download Folevi offers, one row each, then the paused apps. Links come from components/marketing/site.ts. */
function platforms(manifest: ServerManifest | null): Platform[] {
  return [
  {
    id: "mac",
    mark: "apple",
    title: "Mac",
    note: `${MAC_REQUIREMENT}. Signed and notarized by Apple, and it updates itself.`,
    items: [{ name: "Folevi for Mac", detail: "Apple silicon and Intel (.dmg)", href: MAC_DOWNLOAD_URL, action: "Download" }],
  },
  {
    id: "iphone-ipad",
    mark: "apple",
    title: "iPhone and iPad",
    note: `${IOS_REQUIREMENT}.`,
    items: [{ name: "Folevi for iPhone and iPad", detail: "On the App Store", href: APP_STORE_URL, action: "App Store" }],
  },
  {
    id: "web",
    mark: "web",
    title: "Web",
    note: "Nothing to install: sign in from any browser.",
    items: [{ name: "Folevi on the web", detail: "Chrome, Safari, Edge and Firefox", href: WEB_APP_URL, action: "Open" }],
  },
  {
    id: "server",
    mark: "server",
    title: "Folevi Server",
    beta: true,
    note: manifest
      ? `Version ${manifest.version}. Run Folevi on your own NAS or server. Checksums, the one-line install command and the container image are on the Folevi Server page.`
      : "Run Folevi on your own NAS or server. The Early Beta is almost ready; its packages appear here and on the Folevi Server page as soon as it’s out.",
    items: serverItems(manifest),
  },
  comingSoon("windows", "windows", "Windows", "Arm, Intel and AMD PCs"),
  comingSoon("linux", "linux", "Linux", "AppImage, .deb and .rpm"),
  comingSoon("android", "android", "Android", "Phones and tablets"),
  ];
}

const SERVER_NAMES: Array<{ platform: ServerPlatform; name: string; detail: string }> = [
  { platform: "synology", name: "Synology", detail: "DSM 7.2 or later" },
  { platform: "qnap", name: "QNAP", detail: "QTS and QuTS hero" },
  { platform: "asustor", name: "ASUSTOR", detail: "ADM" },
  { platform: "terramaster", name: "TerraMaster", detail: "TOS" },
  { platform: "ugreen", name: "UGREEN", detail: "UGOS Pro" },
  { platform: "unraid", name: "Unraid", detail: "Plugin package" },
  { platform: "deb", name: ".deb", detail: "Debian and Ubuntu servers" },
  { platform: "rpm", name: ".rpm", detail: "Fedora, RHEL and openSUSE servers" },
];
const ARCH_LABEL: Record<ServerArch, string> = { x86_64: "Intel and AMD", aarch64: "ARM" };

/** One row per package the manifest has, each with a button per kind of PC; "Coming soon" with no release. */
function serverItems(manifest: ServerManifest | null): Item[] {
  const rows: Item[] = [];
  for (const { platform, name, detail } of SERVER_NAMES) {
    const files = SERVER_ARCHES.map((arch) => serverFile(manifest, platform, arch)).filter((file) => file !== null);
    if (files.length === 0) continue;
    rows.push({
      name,
      detail: `${detail} (${files.map((file) => formatSize(file.sizeBytes)).join(", ")})`,
      action: "Download",
      links: files.map((file) => ({ label: ARCH_LABEL[file.arch], href: file.url, describe: `Folevi Server for ${name}, ${ARCH_LABEL[file.arch]}` })),
    });
  }
  if (rows.length === 0) return [{ name: "Folevi Server", detail: "NAS packages, .deb and .rpm, a container image", action: "Coming soon" }];
  rows.push({ name: "Install command and container image", detail: "For Linux servers and Docker", href: "/server#linux", action: "Get it" });
  return rows;
}

export default async function DownloadsPage() {
  const PLATFORMS = platforms(await fetchServerManifest());
  return (
    <PageFrame>
      <HeaderCard crumbs={CRUMBS}>
        <Eyebrow>Downloads</Eyebrow>
        <h1 className="mk-display mt-5 text-[44px] leading-[0.98] sm:text-[64px]">Download Folevi.</h1>
        <p className="mk-lede mt-6 max-w-[56ch]">Every Folevi app and package in one list. Every app is free with every feature, and you don’t need an account. Folevi Server is free to run yourself. {COMING_SOON_NOTE} Jump to yours from the bar at the bottom.</p>
      </HeaderCard>

      {PLATFORMS.map((p) => (
        <Card key={p.id} id={p.id} aria-labelledby={`${p.id}-title`} className="scroll-mt-20">
          <h2 id={`${p.id}-title`} className="flex flex-wrap items-center gap-3 text-[24px] font-semibold text-(--color-heading)">
            <PlatformMark name={p.mark} size={26} className="shrink-0" />
            {p.title}
            {p.beta ? <BetaBadge /> : null}
          </h2>
          <ul className="mt-4">
            {p.items.map((item, i) => (
              <li key={`${item.name}-${item.detail}`} className={cx("flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3", i > 0 && "border-t mk-hair")}>
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-(--color-heading)">{item.name}</div>
                  <div className="text-[14px] text-muted">{item.detail}</div>
                </div>
                {item.links ? (
                  <div className="flex flex-wrap gap-2">
                    {item.links.map((link) => (
                      <a key={link.href} href={link.href} className="mk-btn-secondary inline-flex h-9 items-center rounded-control px-4 text-[14px] font-medium">
                        {link.label}
                        <span className="sr-only"> ({link.describe})</span>
                      </a>
                    ))}
                  </div>
                ) : item.href ? (
                  <a href={item.href} className="mk-btn-secondary inline-flex h-9 items-center rounded-control px-4 text-[14px] font-medium">
                    {item.action}
                    <span className="sr-only">
                      {" "}
                      {item.name}, {item.detail}
                    </span>
                  </a>
                ) : (
                  <span className="inline-flex h-9 items-center rounded-control border mk-hair px-4 text-[14px] font-medium text-muted">{item.action}</span>
                )}
              </li>
            ))}
          </ul>
          {p.note ? <p className="mt-3 text-[13px] text-muted">{p.note}</p> : null}
          {p.beta ? <BetaNote className="mt-2" /> : null}
        </Card>
      ))}
      <DownloadsBar items={PLATFORMS.map(({ id, title, mark, beta }) => ({ id, title, mark, beta }))} />
    </PageFrame>
  );
}
