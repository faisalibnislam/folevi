import { BetaBadge, BetaNote } from "@/components/marketing/Beta";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { pageMetadata } from "@/components/marketing/seo";
import {
  APP_STORE_URL,
  IOS_REQUIREMENT,
  LINUX_CHECKSUMS_URL,
  LINUX_DOWNLOADS,
  MAC_DOWNLOAD_URL,
  MAC_REQUIREMENT,
  WEB_APP_URL,
  WINDOWS_DOWNLOAD_ARM64_URL,
  WINDOWS_DOWNLOAD_X64_URL,
  WINDOWS_REQUIREMENT,
} from "@/components/marketing/site";
import { Eyebrow, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Download Folevi for Mac, Windows, Linux, iPhone, iPad and Android",
  description:
    "Every Folevi download in one place: Mac, Windows, Linux (Beta: AppImage, .deb, .rpm), iPhone and iPad, Android, the web app and Folevi Server (Beta).",
  path: "/downloads",
});

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Downloads", path: "/downloads" },
];

type Item = { name: string; detail: string; href?: string; action: string };
/** `beta`: still in beta (lib/beta.ts): a Beta badge by the title and the Beta note under the list. */
type Platform = { id: string; title: string; note?: string; beta?: boolean; items: Item[] };

/** Every download Folevi offers, one row each. Links come from components/marketing/site.ts. */
const PLATFORMS: Platform[] = [
  {
    id: "mac",
    title: "Mac",
    note: `${MAC_REQUIREMENT}. Signed and notarized by Apple, and it updates itself.`,
    items: [{ name: "Folevi for Mac", detail: "Apple silicon and Intel (.dmg)", href: MAC_DOWNLOAD_URL, action: "Download" }],
  },
  {
    id: "windows",
    title: "Windows",
    note: `${WINDOWS_REQUIREMENT}. This early build isn’t signed yet, so Windows asks you to confirm it (More info, then Run anyway).`,
    items: [
      { name: "Folevi for Windows", detail: "Intel and AMD PCs (x64 installer)", href: WINDOWS_DOWNLOAD_X64_URL, action: "Download" },
      { name: "Folevi for Windows", detail: "Arm PCs (arm64 installer)", href: WINDOWS_DOWNLOAD_ARM64_URL, action: "Download" },
    ],
  },
  {
    id: "linux",
    title: "Linux",
    beta: true,
    note: "The AppImage updates itself; the .deb and .rpm update through your package manager.",
    items: [
      { name: "AppImage", detail: "Most distributions, Intel and AMD", href: LINUX_DOWNLOADS.appimage.x64, action: "Download" },
      { name: "AppImage", detail: "Most distributions, ARM", href: LINUX_DOWNLOADS.appimage.arm64, action: "Download" },
      { name: ".deb", detail: "Ubuntu, Debian and Mint, Intel and AMD", href: LINUX_DOWNLOADS.deb.x64, action: "Download" },
      { name: ".deb", detail: "Ubuntu, Debian and Mint, ARM", href: LINUX_DOWNLOADS.deb.arm64, action: "Download" },
      { name: ".rpm", detail: "Fedora and openSUSE, Intel and AMD", href: LINUX_DOWNLOADS.rpm.x64, action: "Download" },
      { name: ".rpm", detail: "Fedora and openSUSE, ARM", href: LINUX_DOWNLOADS.rpm.arm64, action: "Download" },
      { name: "Checksums", detail: "SHA-256 for every Linux package", href: LINUX_CHECKSUMS_URL, action: "View" },
    ],
  },
  {
    id: "iphone-ipad",
    title: "iPhone and iPad",
    note: `${IOS_REQUIREMENT}.`,
    items: [{ name: "Folevi for iPhone and iPad", detail: "On the App Store", href: APP_STORE_URL, action: "App Store" }],
  },
  {
    id: "android",
    title: "Android",
    note: "Until then, the web app works in your phone’s browser.",
    items: [{ name: "Folevi for Android", detail: "Phones and tablets, coming soon to Google Play", action: "Coming soon" }],
  },
  {
    id: "web",
    title: "Web",
    note: "Nothing to install: sign in from any browser.",
    items: [{ name: "Folevi on the web", detail: "Chrome, Safari, Edge and Firefox", href: WEB_APP_URL, action: "Open" }],
  },
  {
    id: "server",
    title: "Folevi Server",
    beta: true,
    note: "Run Folevi on your own NAS or server. Every package, with its checksum, is on the Folevi Server page.",
    items: [
      { name: "Synology, QNAP and other NAS", detail: "Packages for Intel and AMD or ARM", href: "/server#nas", action: "Get it" },
      { name: "Linux servers and containers", detail: "One install command, .deb and .rpm packages, a container image", href: "/server#linux", action: "Get it" },
    ],
  },
];

export default function DownloadsPage() {
  return (
    <PageFrame>
      <HeaderCard crumbs={CRUMBS}>
        <Eyebrow>Downloads</Eyebrow>
        <h1 className="mk-display mt-5 text-[44px] leading-[0.98] sm:text-[64px]">Download Folevi.</h1>
        <p className="mk-lede mt-6 max-w-[56ch]">Every Folevi app and package, for every platform, in one list.</p>
        <nav aria-label="Platforms" className="mt-7 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <a key={p.id} href={`#${p.id}`} className="rounded-control border mk-hair px-3.5 py-1.5 text-[14px] font-medium text-(--color-heading) hover:bg-(--glass-active)">
              {p.title}
              {p.beta ? <span className="text-muted"> (Beta)</span> : null}
            </a>
          ))}
        </nav>
      </HeaderCard>

      {PLATFORMS.map((p) => (
        <Card key={p.id} id={p.id} aria-labelledby={`${p.id}-title`} className="scroll-mt-20">
          <h2 id={`${p.id}-title`} className="flex flex-wrap items-center gap-3 text-[24px] font-semibold text-(--color-heading)">
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
                {item.href ? (
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
    </PageFrame>
  );
}
