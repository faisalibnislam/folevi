import { Icon, type IconName } from "@/components/marketing/icons";
import { MacMenuBar } from "@/components/marketing/mac/MacMenuBar";
import { ShortcutTable } from "@/components/marketing/mac/ShortcutTable";
import { ProductShot } from "@/components/marketing/ProductShot";
import { JsonLd, pageMetadata, softwareLd } from "@/components/marketing/seo";
import { SIGN_UP_URL, WEB_APP_URL } from "@/components/marketing/site";
import { Bubbles, ButtonLink, Eyebrow, SectionHeading, container, cx, type BubbleSpec } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Mac app",
  description:
    "A native Mac app for Folevi: real menus and keyboard shortcuts, multiple windows, offline editing, Quick Look, drag from Finder and menu bar Quick Add. Requires macOS 15 or later. Coming soon.",
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
    body: "Your workspace is stored on your Mac. Write on a train or a plane; changes sync when you reconnect, and the toolbar always shows whether you’re Saved, Offline or Syncing.",
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

const HERO_BUBBLES: BubbleSpec[] = [
  { emoji: "📎", size: 84, style: { top: -30, right: -22 }, className: "hidden md:grid", dur: 10 },
  { emoji: "🗂️", size: 66, style: { top: "42%", left: -30 }, className: "hidden lg:grid", dur: 9, delay: -4 },
  { emoji: "✈️", size: 70, style: { bottom: -26, right: "18%" }, className: "hidden md:grid", dur: 11, delay: -2 },
];

export default function MacPage() {
  return (
    <>
      <JsonLd data={softwareLd()} />
      <header className="relative -mt-[76px] pt-[76px]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="mk-glow mk-fade-bottom" />
        </div>
        <div className={cx(container, "relative pb-16 pt-14 sm:pt-20")}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
            <div>
              <Eyebrow>Folevi for Mac</Eyebrow>
              <h1 className="mk-display mt-6 max-w-[14ch] text-[46px] sm:text-[66px] lg:text-[74px]">Built for the Mac, not ported to it.</h1>
              <p className="mk-lede mt-6 max-w-[50ch]">
                A native app with the menus, windows and keyboard shortcuts you expect — and a workspace that stays on your
                Mac, so writing never waits for the network.
              </p>
            </div>
            <div className="mk-card rounded-[24px] p-6 sm:p-7">
              <p className="mk-chip mk-tone--marigold">
                <span aria-hidden="true" className="mk-dot" />
                Coming soon
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-muted">
                The Mac app isn’t available to download yet. Create a Folevi account and we’ll email you when it’s ready.
                Until then, everything works on the web — and your account, plan and notes carry over.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
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

          <div className="relative mt-16">
            <div className="mk-panel mk-panel--cream p-3 sm:p-6 lg:p-10">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
                <div className="mk-glow" />
              </div>
              <div className="relative">
                <MacMenuBar initial="View" />
                <ProductShot name="mac" className="relative mt-6 lg:mt-10" />
              </div>
            </div>
            <Bubbles items={HERO_BUBBLES} />
          </div>
        </div>
      </header>

      <section aria-labelledby="why-title" className="py-14 sm:py-20">
        <div className={container}>
          <SectionHeading id="why-title" eyebrow="Why native" title="It should feel like it came with your Mac." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title} className="mk-card p-6 sm:p-7">
                <span className="mk-tile">
                  <Icon name={feature.icon} size={20} />
                </span>
                <h3 className="mk-h3 mt-5 text-[17px]">{feature.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="glass-title" className="py-14 sm:py-20">
        <div className={container}>
          <div className="mk-panel mk-wash--soft grid gap-12 overflow-hidden p-6 sm:p-10 lg:grid-cols-2 lg:gap-16 lg:p-14">
            <div className="relative">
              <SectionHeading id="glass-title" eyebrow="Designed for macOS 26" title="Liquid Glass where it belongs. Solid everywhere else." />
              <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-muted">
                <p>
                  On macOS 26, toolbars, the sidebar and popovers use Liquid Glass, so Folevi sits naturally next to the
                  rest of your apps. Your writing stays on a calm, solid page — glass is for chrome, never for text.
                </p>
                <p>
                  On macOS 15, the same app uses the standard materials of that release. Every feature works the same;
                  only the finish changes.
                </p>
              </div>
            </div>
            <div className="relative self-center">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">System requirements</h3>
              <dl className="mk-card mt-4 rounded-[20px] px-5 text-[15px]">
                {[
                  ["macOS", "macOS 15 or later"],
                  ["Best on", "macOS 26, with Liquid Glass"],
                  ["Account", "A Folevi account with two-step verification"],
                  ["Availability", "Coming soon — we’ll email your account when it’s ready"],
                ].map(([term, detail], index) => (
                  <div key={term} className={cx("grid gap-1 py-4 sm:grid-cols-[110px_1fr] sm:gap-4", index > 0 && "border-t mk-hair")}>
                    <dt className="text-muted">{term}</dt>
                    <dd className="font-medium text-ink">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="keys-title" className="py-14 sm:py-20">
        <div className={cx(container, "grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16")}>
          <SectionHeading
            id="keys-title"
            eyebrow="Keyboard"
            title="Hands stay on the keys."
            lede="The shortcuts below are the ones in the menus today. You’ll find the full list, including the web equivalents, in the documentation."
            className="lg:sticky lg:top-28 lg:self-start"
          />
          <div className="mk-card rounded-[24px] p-5 sm:p-7">
            <ShortcutTable caption="Keyboard shortcuts in Folevi for Mac" />
          </div>
        </div>
      </section>

      <section aria-labelledby="web-title" className="relative py-14 sm:py-20">
        <div className={container}>
          <SectionHeading
            align="center"
            id="web-title"
            eyebrow="Also on the web"
            title="The same workspace in any browser."
            lede="Folevi on the web has the same pages, tasks and search, syncs in real time with your Mac, and keeps working offline once it’s loaded."
          />
          <div className="relative mx-auto mt-12 max-w-[1000px]">
            <div aria-hidden="true" className="mk-glow mk-glow--center pointer-events-none absolute -inset-x-[8%] -inset-y-[10%] blur-2xl" />
            <ProductShot name="web" className="relative" />
          </div>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
              Start writing
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
