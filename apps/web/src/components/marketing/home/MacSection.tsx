import { Icon, type IconName } from "../icons";
import { MacMenuBar } from "../mac/MacMenuBar";
import { ShortcutTable } from "../mac/ShortcutTable";
import { ProductShot } from "../ProductShot";
import { ButtonLink, Eyebrow, RegMark, container, cx } from "../ui";

const points: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "window", title: "Real windows", body: "Open a page in its own window with ⇧⌘N and keep two ideas side by side." },
  { icon: "keyboard", title: "Real menus", body: "Every command lives in the menu bar with its shortcut, where Mac people expect it." },
  { icon: "offline", title: "Offline first", body: "Edits are saved on your Mac and sync when you’re back online. The toolbar always says which." },
  { icon: "inspector", title: "Sidebar and inspector", body: "Pages on the left, page style and backlinks on the right. Hide either with a keystroke." },
];

export function MacSection() {
  return (
    <section id="mac" aria-labelledby="mac-title" className="relative scroll-mt-14 overflow-hidden border-t mk-hair bg-surface py-20 sm:py-28">
      <div className={container}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <div>
            <Eyebrow>Folevi for Mac</Eyebrow>
            <h2 id="mac-title" className="mt-5 max-w-[15ch] font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[60px]">
              Written for the Mac, not wrapped for it.
            </h2>
          </div>
          <div className="max-w-[52ch] lg:pb-2">
            <p className="text-[17px] leading-relaxed text-muted">
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

        <div className="relative mt-14 rounded-[18px] border mk-hair bg-canvas p-3 sm:p-6 lg:p-8">
          <div aria-hidden="true" className="mk-rules pointer-events-none absolute inset-0 rounded-[18px]" />
          <span aria-hidden="true" className="absolute -left-[7px] -top-[7px]">
            <RegMark />
          </span>
          <span aria-hidden="true" className="absolute -bottom-[7px] -right-[7px]">
            <RegMark />
          </span>
          <div className="relative">
            <MacMenuBar />
            <ProductShot name="mac" className="relative mt-6 lg:mt-12" />
          </div>
        </div>

        <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <ul className="grid content-start gap-x-8 gap-y-8 sm:grid-cols-2">
            {points.map((point) => (
              <li key={point.title}>
                <span className="flex size-9 items-center justify-center rounded-control border mk-hair bg-raised text-ink">
                  <Icon name={point.icon} size={18} />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{point.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
          <div className={cx("mk-card p-5 sm:p-6")}>
            <ShortcutTable caption="Keyboard shortcuts in the Mac app" />
          </div>
        </div>
      </div>
    </section>
  );
}
