import { FolioStack } from "../hero/FolioStack";
import { Icon, type IconName } from "../icons";
import { SIGN_UP_URL } from "../site";
import { Bubbles, ButtonLink, container, cx, type BubbleSpec } from "../ui";

const HERO_BUBBLES: BubbleSpec[] = [
  { emoji: "🌱", size: 92, style: { top: -46, left: -62 }, className: "hidden sm:grid", dur: 10 },
  { emoji: "✏️", size: 70, style: { bottom: 120, left: -58 }, className: "hidden lg:grid", dur: 8, delay: -3 },
  { emoji: "🗓️", size: 80, style: { top: "36%", right: -34 }, className: "hidden sm:grid", dur: 11, delay: -5 },
  { emoji: "💡", size: 60, style: { top: -30, right: 96 }, className: "hidden lg:grid", dur: 9, delay: -2 },
];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative -mt-[76px] pt-[76px]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="mk-glow mk-fade-bottom" />
      </div>
      <div className={cx(container, "relative grid items-center gap-16 pb-16 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12 lg:pb-24 lg:pt-20")}>
        <div className="max-w-[600px]">
          <p className="mk-chip mk-chip--raised mk-tone--moss">
            <span aria-hidden="true" className="mk-dot" />
            Free to start · Web, Mac and iOS
          </p>
          <h1 id="hero-title" className="mk-display mt-7 text-[46px] sm:text-[66px] lg:text-[74px]">
            A quieter place for ideas that keep growing.
          </h1>
          <p className="mk-lede mt-7 max-w-[46ch]">
            Folevi is a calm workspace for notes, documents and tasks. Catch a thought in seconds, shape it into pages, and
            find it again when it matters — online or off, on the web and on your Mac.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
              Start writing
            </ButtonLink>
            <ButtonLink href="/mac" variant="secondary" size="lg">
              Folevi for Mac
            </ButtonLink>
          </div>
          <p className="mt-5 text-[13.5px] text-muted">No card, no trial clock. Your notes export to Markdown any time.</p>
        </div>
        <div className="relative mx-auto w-full max-w-[520px] lg:mr-2">
          <div aria-hidden="true" className="mk-glow mk-glow--center pointer-events-none absolute -inset-[18%] rounded-full blur-2xl" />
          <div className="relative isolate">
            <FolioStack />
          </div>
          <Bubbles items={HERO_BUBBLES} />
        </div>
      </div>
    </section>
  );
}

const proof: Array<{ icon: IconName; label: string }> = [
  { icon: "mac", label: "Native Mac app" },
  { icon: "offline", label: "Offline writing" },
  { icon: "sync", label: "Real-time sync" },
  { icon: "markdown", label: "Markdown export" },
  { icon: "theme", label: "Light & dark mode" },
];

export function ProofStrip() {
  return (
    <section aria-label="What’s included" className="relative">
      <ul className={cx(container, "flex flex-wrap justify-center gap-2 sm:gap-2.5")}>
        {proof.map((item) => (
          <li key={item.label} className="mk-chip mk-chip--raised h-9 px-3 text-[13px] sm:h-10 sm:px-4 sm:text-[14px]">
            <Icon name={item.icon} size={17} className="shrink-0 text-accent" />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
