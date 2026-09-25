import { Icon, type IconName } from "../icons";
import { MacMenuBar } from "../mac/MacMenuBar";
import { ShortcutTable } from "../mac/ShortcutTable";
import { ProductShot } from "../ProductShot";
import { Bubbles, ButtonLink, SectionHeading, container, cx, type BubbleSpec } from "../ui";

const points: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "window", title: "Real windows", body: "Open a page in its own window with ⇧⌘N and keep two ideas side by side." },
  { icon: "keyboard", title: "Real menus", body: "Every command lives in the menu bar with its shortcut, where Mac people expect it." },
  { icon: "offline", title: "Offline first", body: "Edits are saved on your Mac and sync when you’re back online. The toolbar always says which." },
  { icon: "inspector", title: "Sidebar and inspector", body: "Pages on the left, page style and backlinks on the right. Hide either with a keystroke." },
];

const STAGE_BUBBLES: BubbleSpec[] = [
  { emoji: "📎", size: 82, style: { top: -30, right: -26 }, className: "hidden md:grid", dur: 10 },
  { emoji: "☕️", size: 66, style: { bottom: -24, left: -22 }, className: "hidden md:grid", dur: 8, delay: -4 },
];

export function MacSection() {
  return (
    <section id="mac" aria-labelledby="mac-title" className="relative scroll-mt-24 py-16 sm:py-24">
      <div className={container}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <SectionHeading id="mac-title" eyebrow="Folevi for Mac" title="Written for the Mac, not wrapped for it." />
          <div className="max-w-[52ch] lg:pb-1">
            <p className="mk-lede">
              The Mac app is a native application with real menus, multiple windows, a sidebar and an inspector — and it
              keeps working when the Wi-Fi doesn’t. It’s in private preview now.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/mac" variant="secondary" icon="arrow-right">
                Explore the Mac app
              </ButtonLink>
            </div>
          </div>
        </div>

        <div className="relative mt-14">
          <div className="mk-panel mk-panel--cream p-3 sm:p-6 lg:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
              <div className="mk-glow" />
            </div>
            <div className="relative">
              <MacMenuBar />
              <ProductShot name="mac" className="relative mt-6 lg:mt-10" />
            </div>
          </div>
          <Bubbles items={STAGE_BUBBLES} />
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          <ul className="grid content-start gap-4 sm:grid-cols-2">
            {points.map((point) => (
              <li key={point.title} className="mk-card p-5 sm:p-6">
                <span className="mk-tile">
                  <Icon name={point.icon} size={20} />
                </span>
                <h3 className="mk-h3 mt-4 text-[16.5px]">{point.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
          <div className={cx("mk-card rounded-[24px] p-5 sm:p-7")}>
            <ShortcutTable caption="Keyboard shortcuts in the Mac app" />
          </div>
        </div>
      </div>
    </section>
  );
}
