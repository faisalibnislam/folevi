import { AppWindow, READING_NOTE, artById, artThumb } from "../product/Replica";
import { Icon, type IconName } from "../icons";
import { MacMenuBar } from "../mac/MacMenuBar";
import { ShortcutTable } from "../mac/ShortcutTable";
import { ButtonLink, SectionHeading, box, container, cx } from "../ui";

const points: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "window", title: "Separate windows", body: "Open a page in its own window with ⇧⌘N and keep two pages side by side." },
  { icon: "keyboard", title: "Menus with shortcuts", body: "Every command is in the menu bar, with its shortcut next to it." },
  { icon: "offline", title: "Works offline", body: "Edits are saved on your Mac and sync when you’re back online. The toolbar shows which." },
  { icon: "inspector", title: "Sidebar and inspector", body: "Pages on the left, the page’s style and backlinks on the right. Hide either with a keystroke." },
];

export function MacSection() {
  const art = artById("art-39");
  return (
    <section id="mac" aria-labelledby="mac-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <SectionHeading id="mac-title" eyebrow="Folevi for Mac" title="A native Mac app, coming soon." />
          <div className="max-w-[52ch] lg:pb-1">
            <p className="mk-lede">
              The Mac app has the menus, windows and shortcuts of a Mac app. Your notes are stored on the Mac, so it keeps working
              without Wi-Fi.
            </p>
            <div className="mt-6">
              <ButtonLink href="/mac" variant="secondary" icon="arrow-right">
                About the Mac app
              </ButtonLink>
            </div>
          </div>
        </div>

        <div className="mk-stage mt-12 p-3 sm:p-8" style={{ ["--stage-art" as string]: artThumb(art) }}>
          <MacMenuBar />
          <AppWindow
            art={art}
            note={READING_NOTE}
            sidebar="main"
            chrome="mac"
            active={null}
            label="The Folevi Mac app: the sidebar with Home, Drafts, Tasks and folders, and a note called Reading list open in a tab."
            className="mt-4 h-[460px] sm:mt-6 sm:h-[540px]"
          />
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          <ul className="grid content-start gap-x-8 gap-y-8 sm:grid-cols-2">
            {points.map((point) => (
              <li key={point.title}>
                <span className="mk-tile">
                  <Icon name={point.icon} size={17} />
                </span>
                <h3 className="mk-h3 mt-3.5 text-[15.5px]">{point.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
          <div className="mk-card p-5 sm:p-7">
            <ShortcutTable caption="Keyboard shortcuts in the Mac app" />
          </div>
        </div>
      </div>
    </section>
  );
}
