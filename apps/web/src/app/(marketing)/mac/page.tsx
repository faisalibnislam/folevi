import { Icon, type IconName } from "@/components/marketing/icons";
import { MacMenuBar } from "@/components/marketing/mac/MacMenuBar";
import { ShortcutTable } from "@/components/marketing/mac/ShortcutTable";
import { ProductShot } from "@/components/marketing/ProductShot";
import { JsonLd, pageMetadata, softwareLd } from "@/components/marketing/seo";
import { SIGN_UP_URL, WEB_APP_URL } from "@/components/marketing/site";
import { ButtonLink, Eyebrow, RegMark, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Mac app",
  description:
    "A native Mac app for Folevi: real menus and keyboard shortcuts, multiple windows, offline editing, Quick Look, drag from Finder and menu bar Quick Add. Requires macOS 15 or later. In private preview.",
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
    body: "Catch a thought from anywhere with Quick Add in the menu bar. It lands in Unsorted, ready to be shaped later.",
  },
];

export default function MacPage() {
  return (
    <>
      <JsonLd data={softwareLd()} />
      <header className="relative overflow-hidden border-b mk-hair">
        <div aria-hidden="true" className="mk-rules pointer-events-none absolute inset-0" />
        <div className={cx(container, "relative pb-16 pt-16 sm:pt-24")}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-end lg:gap-16">
            <div>
              <Eyebrow>Folevi for Mac</Eyebrow>
              <h1 className="mt-5 max-w-[15ch] font-display text-[48px] leading-[1] tracking-[-0.02em] sm:text-[72px]">
                Built for the Mac, not ported to it.
              </h1>
              <p className="mt-6 max-w-[50ch] text-[18px] leading-relaxed text-muted">
                A native app with the menus, windows and keyboard shortcuts you expect — and a workspace that stays on your
                Mac, so writing never waits for the network.
              </p>
            </div>
            <div className="rounded-card border mk-hair bg-surface p-5 sm:p-6">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <span aria-hidden="true" className="inline-block size-2 rounded-full bg-marigold" />
                In private preview
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                The Mac app isn’t available to download yet. Create a Folevi account and we’ll email you when preview builds
                are ready. Until then, everything works on the web.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href={SIGN_UP_URL} icon="arrow-right">
                  Create an account
                </ButtonLink>
                <ButtonLink href={WEB_APP_URL} variant="secondary">
                  Open the web app
                </ButtonLink>
              </div>
              <p className="mt-4 text-[13px] text-muted">Requires macOS 15 or later.</p>
            </div>
          </div>

          <div className="relative mt-16 rounded-[18px] border mk-hair bg-canvas p-3 sm:p-6 lg:p-8">
            <span aria-hidden="true" className="absolute -left-[7px] -top-[7px]">
              <RegMark />
            </span>
            <span aria-hidden="true" className="absolute -bottom-[7px] -right-[7px]">
              <RegMark />
            </span>
            <MacMenuBar initial="View" />
            <ProductShot name="mac" className="relative mt-6 lg:mt-12" />
          </div>
        </div>
      </header>

      <section aria-labelledby="why-title" className="py-20 sm:py-28">
        <div className={container}>
          <Eyebrow>Why native</Eyebrow>
          <h2 id="why-title" className="mt-5 max-w-[18ch] font-display text-[40px] leading-[1.04] tracking-[-0.015em] sm:text-[52px]">
            It should feel like it came with your Mac.
          </h2>
          <ul className="mt-14 grid gap-px overflow-hidden rounded-card border mk-hair bg-line sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title} className="bg-surface p-6 sm:p-7">
                <Icon name={feature.icon} size={20} className="text-accent" />
                <h3 className="mt-4 text-[17px] font-semibold text-ink">{feature.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="glass-title" className="border-t mk-hair bg-surface py-20 sm:py-28">
        <div className={cx(container, "grid gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div>
            <Eyebrow>Designed for macOS 26</Eyebrow>
            <h2 id="glass-title" className="mt-5 max-w-[16ch] font-display text-[40px] leading-[1.04] tracking-[-0.015em] sm:text-[52px]">
              Liquid Glass where it belongs. Solid everywhere else.
            </h2>
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
          <div>
            <h3 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">System requirements</h3>
            <dl className="mt-4 divide-y divide-line border-y mk-hair text-[15px]">
              {[
                ["macOS", "macOS 15 or later"],
                ["Best on", "macOS 26, with Liquid Glass"],
                ["Account", "A Folevi account with two-step verification"],
                ["Availability", "Private preview — builds are emailed to preview accounts"],
              ].map(([term, detail]) => (
                <div key={term} className="grid grid-cols-[120px_1fr] gap-4 py-3.5">
                  <dt className="text-muted">{term}</dt>
                  <dd className="text-ink">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="keys-title" className="border-t mk-hair py-20 sm:py-28">
        <div className={cx(container, "grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16")}>
          <div>
            <Eyebrow>Keyboard</Eyebrow>
            <h2 id="keys-title" className="mt-5 max-w-[14ch] font-display text-[40px] leading-[1.04] tracking-[-0.015em] sm:text-[52px]">
              Hands stay on the keys.
            </h2>
            <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-muted">
              The shortcuts below are the ones in the menus today. You’ll find the full list, including the web
              equivalents, in the documentation.
            </p>
          </div>
          <div className="mk-card p-5 sm:p-7">
            <ShortcutTable caption="Keyboard shortcuts in Folevi for Mac" />
          </div>
        </div>
      </section>

      <section aria-labelledby="web-title" className="border-t mk-hair bg-surface py-20 sm:py-28">
        <div className={container}>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
            <div>
              <Eyebrow>Also on the web</Eyebrow>
              <h2 id="web-title" className="mt-5 max-w-[16ch] font-display text-[40px] leading-[1.04] tracking-[-0.015em] sm:text-[52px]">
                The same workspace in any browser.
              </h2>
            </div>
            <p className="max-w-[48ch] text-[17px] leading-relaxed text-muted lg:pb-2">
              Folevi on the web has the same pages, tasks and search, syncs in real time with your Mac, and keeps
              working offline once it’s loaded.
            </p>
          </div>
          <ProductShot name="web" className="mx-auto mt-12 max-w-[980px]" />
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <ButtonLink href={SIGN_UP_URL} icon="arrow-right">
              Start writing
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
