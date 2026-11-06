import { Check, Minus } from "lucide-react";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { Float, Mark, Sticker } from "@/components/marketing/fun";
import { DevicePicture, MacPicture } from "@/components/marketing/home/GetApps";
import { YourFiles } from "@/components/marketing/home/YourFiles";
import { FaqSection } from "@/components/marketing/parts";
import { SyncPiece } from "@/components/marketing/pieces";
import { JsonLd, pageMetadata, softwareLd, type FaqItem } from "@/components/marketing/seo";
import { APP_STORE_URL, IOS_REQUIREMENT, MAC_DOWNLOAD_URL, MAC_REQUIREMENT, WEB_APP_URL } from "@/components/marketing/site";
import { ButtonLink, Eyebrow, SectionHeading, cx } from "@/components/marketing/ui";
import { PRICES, formatPrice } from "@/lib/plans";

export const metadata = pageMetadata({
  title: "Folevi apps: free notes for Mac, iPhone and iPad",
  description:
    "Download Folevi for Mac, iPhone and iPad: free forever with no account. Notes are files in iCloud Drive, Dropbox, Google Drive or any folder, and work offline.",
  path: "/apps",
});

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Apps", path: "/apps" },
];

/** The two ways to use the apps, from the first screen they show (docs/LOCAL_MODE_PLAN.md). */
const MODES: Array<{ label: string; local: boolean | string; cloud: boolean | string }> = [
  { label: "Price", local: "Free forever", cloud: `Free plan, or from ${formatPrice(PRICES.core.month)} a month` },
  { label: "Account", local: "None", cloud: "A Folevi account" },
  { label: "Where notes live", local: "Files in a folder you pick", cloud: "Folevi Cloud, synced to every device" },
  { label: "Mac, iPhone and iPad apps", local: true, cloud: true },
  { label: "Works offline", local: true, cloud: true },
  { label: "Themes, tasks, linked pages, Foli DNA", local: true, cloud: true },
  { label: "Foli AI", local: "On your Mac: Apple Intelligence or your own key", cloud: "Foli AI credits on every device" },
  { label: "The web app", local: false, cloud: true },
  { label: "Share, comment and edit together", local: false, cloud: true },
  { label: "Public pages and workspaces", local: false, cloud: true },
];

const MAC_POINTS = [
  "Quick Add from any app, and a menu bar icon",
  "As many windows and tabs as you like",
  "Mac notifications and a Dock badge",
  "Drag files in from Finder",
  "Keyboard shortcuts for everything",
  "Updates itself",
];
const IOS_POINTS = [
  "A layout made for iPhone and one for iPad",
  "Home Screen widgets: Today, Recent notes and Quick add",
  "Share to Folevi from any app",
  "Your library in iCloud Drive and the Files app",
  "Foli DNA, the map of how your notes connect",
  "Works offline, syncs when you’re back",
];

const FAQS: FaqItem[] = [
  {
    q: "Are the apps free?",
    a: "Yes. Choose Keep notes on my devices when the app opens and Folevi is free forever on your Mac, iPhone and iPad: no account, no trial and no limit on notes.",
  },
  {
    q: "Can I sign in to my Folevi account in the apps?",
    a: "Yes. Choose Sign in to Folevi instead, and the apps open your Folevi Cloud notes, with sharing, workspaces and Foli AI credits from your plan.",
  },
  {
    q: "How do I sync without an account?",
    a: "Keep your library in iCloud Drive and it appears on every iPhone, iPad and Mac signed in to your iCloud account. Dropbox, Google Drive and other folders work the same way.",
  },
  {
    q: "Can I switch later?",
    a: "Yes, both ways. Sign in to move a library on your devices to Folevi Cloud, or export your account’s notes into a folder and keep them on your devices.",
  },
  {
    q: "Why is the Mac app not on the Mac App Store?",
    a: "Folevi for Mac is downloaded from folevi.com, signed and notarized by Apple, and it updates itself. The iPhone and iPad app is on the App Store.",
  },
  {
    q: "What do the apps need?",
    a: `Folevi for Mac needs ${MAC_REQUIREMENT}, on Apple silicon or Intel. Folevi for iPhone and iPad needs ${IOS_REQUIREMENT}.`,
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check size={18} aria-label="Yes" className="text-(--mk-violet-ink)" />;
  if (value === false) return <Minus size={18} aria-label="No" className="text-muted" />;
  return <span>{value}</span>;
}

function AppCard({ id, eyebrow, title, lede, points, picture, actions, requirement }: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  lede: string;
  points: string[];
  picture: React.ReactNode;
  actions: React.ReactNode;
  requirement: string;
}) {
  return (
    <Card id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
        <div>
          <SectionHeading id={`${id}-title`} eyebrow={eyebrow} title={title} lede={lede} />
          <ul className="mt-7 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {points.map((p) => (
              <li key={p} className="flex gap-2.5 text-[15px] leading-snug">
                <Check size={16} aria-hidden="true" className="mt-0.5 flex-none text-(--mk-violet-ink)" />
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2.5">{actions}</div>
          <p className="mt-4 text-[13px] text-muted">{requirement}</p>
        </div>
        <div role="img" aria-label={`Folevi ${eyebrow.toLowerCase()} with a note open`} className="mk-mini-stage flex items-center justify-center" style={{ height: 300 }}>
          <div aria-hidden="true" className="contents">
            {picture}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function AppsPage() {
  return (
    <>
      <JsonLd data={softwareLd()} />
      <PageFrame>
        <HeaderCard crumbs={CRUMBS}>
          <Float depth={0.05} className="right-[4%] top-6 max-xl:hidden [--tilt:4deg]">
            <SyncPiece label="Saved to iCloud Drive" />
          </Float>
          <div className="pointer-events-none absolute bottom-10 right-[8%] z-10 hidden lg:block">
            <Sticker tone="violet" rotate={7}>
              Free forever. No account.
            </Sticker>
          </div>
          <Eyebrow>Folevi apps</Eyebrow>
          <h1 className="mk-display mt-5 max-w-[15ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
            Folevi on your Mac, iPhone and <Mark>iPad.</Mark>
          </h1>
          <p className="mk-lede mt-6 max-w-[56ch]">
            Native apps, free forever with no account. Your notes are files in a folder you pick, and they work offline.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <ButtonLink href={MAC_DOWNLOAD_URL} icon="arrow-down" size="lg">
              Download for Mac
            </ButtonLink>
            <ButtonLink href={APP_STORE_URL} icon="arrow-right" size="lg">
              Get it on the App Store
            </ButtonLink>
            <ButtonLink href={WEB_APP_URL} variant="secondary" size="lg">
              Open the web app
            </ButtonLink>
          </div>
        </HeaderCard>

        <Card aria-labelledby="modes-title">
          <SectionHeading
            id="modes-title"
            eyebrow="Two ways to use them"
            title={
              <>
                Keep notes on your devices, or <Mark kind="squiggle">sign in</Mark>.
              </>
            }
            lede="The apps ask once, when they first open. You can change your mind later."
          />
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b mk-hair">
                  <th scope="col" className="py-3 pr-4 font-medium text-muted">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th scope="col" className="w-[34%] py-3 pr-4 text-[16px] font-semibold text-(--color-heading)">Keep notes on my devices</th>
                  <th scope="col" className="w-[34%] py-3 text-[16px] font-semibold text-(--color-heading)">Sign in to Folevi</th>
                </tr>
              </thead>
              <tbody>
                {MODES.map((row, i) => (
                  <tr key={row.label} className={cx(i > 0 && "border-t mk-hair")}>
                    <th scope="row" className="py-3 pr-4 font-medium text-(--color-heading)">
                      {row.label}
                    </th>
                    <td className="py-3 pr-4 text-muted">
                      <Cell value={row.local} />
                    </td>
                    <td className="py-3 text-muted">
                      <Cell value={row.cloud} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <AppCard
          id="mac"
          eyebrow="For Mac"
          title={
            <>
              A Mac app that feels <Mark>at home</Mark>.
            </>
          }
          lede="Folevi in windows of its own, with the keyboard, the menu bar and Finder close at hand."
          points={MAC_POINTS}
          picture={<MacPicture />}
          actions={
            <>
              <ButtonLink href={MAC_DOWNLOAD_URL} icon="arrow-down">
                Download for Mac
              </ButtonLink>
              <ButtonLink href="/mac" variant="secondary">
                More about the Mac app
              </ButtonLink>
            </>
          }
          requirement={`${MAC_REQUIREMENT}, Apple silicon or Intel. Signed and notarized by Apple.`}
        />

        <AppCard
          id="iphone-ipad"
          eyebrow="For iPhone and iPad"
          title={
            <>
              Your notes, everywhere you <Mark>go.</Mark>
            </>
          }
          lede="New on the App Store: the same calm notes on your iPhone and iPad, with widgets and the Share sheet."
          points={IOS_POINTS}
          picture={
            <div className="flex items-end gap-5">
              <DevicePicture kind="iphone" />
              <DevicePicture kind="ipad" />
            </div>
          }
          actions={
            <ButtonLink href={APP_STORE_URL} icon="arrow-right">
              Get it on the App Store
            </ButtonLink>
          }
          requirement={`${IOS_REQUIREMENT}.`}
        />

        <YourFiles />

        <FaqSection faqs={FAQS} path="/apps" collapsed />
      </PageFrame>
    </>
  );
}
