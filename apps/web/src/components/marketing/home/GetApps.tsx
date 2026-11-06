import { Cloud, LockKeyhole, Sparkles, WifiOff } from "lucide-react";
import { APP_STORE_URL, IOS_REQUIREMENT, MAC_DOWNLOAD_URL, MAC_REQUIREMENT, WEB_APP_URL } from "../site";
import { artById, artVars, CheckMark } from "../product/Replica";
import { ButtonLink, cx } from "../ui";
import { DeviceShowcase } from "./DeviceShowcase";
import { Mark } from "../fun";

/*
 * The apps, right under the hero: the Mac, iPhone and iPad apps (free forever with no account) and the web app
 * (with an account). Each device is drawn from the site's own note pieces, not a screenshot, so it follows the
 * theme like everything else on the page.
 */

type MiniNote = { art: string; title: string; lines: string[]; todos?: Array<{ text: string; done?: boolean }> };

const MAC_NOTE: MiniNote = {
  art: "art-03",
  title: "Seed library",
  lines: ["Swap day is the first Saturday in April."],
  todos: [{ text: "Print seed labels", done: true }, { text: "Ask Ines about the tables" }],
};
const PHONE_NOTE: MiniNote = { art: "art-30", title: "Trip sketch", lines: ["A long weekend on the coast."], todos: [{ text: "Book the ferry" }] };
const PAD_NOTE: MiniNote = {
  art: "art-39",
  title: "Studio move",
  lines: ["Boxes for the plan chest and the lamp."],
  todos: [{ text: "Keys from Ines", done: true }, { text: "Measure the window" }],
};

/** A note as the apps draw it: the cover with its title, then a line or two and a few to-dos. */
function Note({ note, size }: { note: MiniNote; size: "sm" | "md" }) {
  const art = artById(note.art);
  return (
    <div className="mk-note flex h-full flex-col overflow-hidden" style={artVars(art)}>
      <div className={cx("mk-note-cover flex items-end", size === "sm" ? "min-h-[64px] px-3 pb-2 pt-6" : "min-h-[84px] px-4 pb-2.5 pt-8")} data-tone={art.tone}>
        <p className={cx("mk-note-title", size === "sm" ? "text-[17px]" : "text-[21px]")}>{note.title}</p>
      </div>
      <div className={cx("flex-1 space-y-1.5 leading-[1.5]", size === "sm" ? "px-3 pt-2.5 text-[11px]" : "px-4 pt-3 text-[13px]")} style={{ fontFamily: "var(--font-serif)" }}>
        {note.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {note.todos?.map((t) => (
          <p key={t.text} className="flex items-center gap-2">
            <span className="mk-check" data-checked={t.done ? "true" : undefined}>
              {t.done ? <CheckMark size={9} /> : null}
            </span>
            <span className={cx("min-w-0 flex-1", t.done && "mk-note-muted line-through")}>{t.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/** A Mac window: traffic lights over a note. */
export function MacPicture() {
  return (
    <div className="mk-card mx-auto flex h-[196px] w-full max-w-[300px] flex-col overflow-hidden">
      <div className="flex h-7 flex-none items-center gap-1.5 px-3">
        <span className="size-2.5 rounded-chip bg-[#ff5f57]" />
        <span className="size-2.5 rounded-chip bg-[#febc2e]" />
        <span className="size-2.5 rounded-chip bg-[#28c840]" />
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2">
        <Note note={MAC_NOTE} size="md" />
      </div>
    </div>
  );
}

/** A phone or a tablet: a rounded frame around a note. */
export function DevicePicture({ kind }: { kind: "iphone" | "ipad" }) {
  const phone = kind === "iphone";
  return (
    <div
      className={cx(
        "mk-card mx-auto overflow-hidden p-[6px] shadow-[var(--shadow-card),inset_0_0_0_1px_color-mix(in_oklab,var(--color-heading)_12%,transparent)]",
        phone ? "h-[196px] w-[104px] rounded-container" : "h-[196px] w-[150px] rounded-container",
      )}
    >
      <div className={"h-full overflow-hidden rounded-panel"}>
        <Note note={phone ? PHONE_NOTE : PAD_NOTE} size="sm" />
      </div>
    </div>
  );
}

/** What the apps promise, as chips under the heading. */
const PROMISES = [
  { icon: LockKeyhole, text: "End-to-end encryption, when you want it" },
  { icon: WifiOff, text: "Works offline" },
  { icon: Cloud, text: "Your own iCloud, Dropbox or Google Drive" },
  { icon: Sparkles, text: "Folevi Cloud and Foli AI, optional" },
];

/** The apps, inside the hero note under its text: the note and the apps are one card. */
export function HeroApps() {
  return (
    <section id="apps" aria-labelledby="apps-title" className="mk-hero-apps scroll-mt-20">
        <DeviceShowcase />
        <div className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div>
            <h2 id="apps-title" className="mk-h2">
              On your Mac, iPhone and iPad.
              <br />
              <Mark kind="circle">Free,</Mark> with no account.
            </h2>
            <p className="mk-lede mt-4 max-w-[54ch]">
              The whole workspace in native apps that open in a moment and work offline. Choose Keep notes on my devices and start: no sign-up, no trial, no limit.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {PROMISES.map((p) => (
                <li key={p.text} className="mk-chip inline-flex items-center gap-1.5">
                  <p.icon size={14} aria-hidden="true" className="text-(--mk-violet-ink)" />
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-2.5">
          <ButtonLink href={MAC_DOWNLOAD_URL} lead="mac" size="lg">
            Download for Mac
          </ButtonLink>
          <ButtonLink href={APP_STORE_URL} lead="app-store" size="lg">
            Get it on the App Store
          </ButtonLink>
          <ButtonLink href={WEB_APP_URL} variant="secondary" size="lg">
            Open the web app
          </ButtonLink>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          {MAC_REQUIREMENT}. {IOS_REQUIREMENT}. The web app needs a free Folevi account.
        </p>
    </section>
  );
}
