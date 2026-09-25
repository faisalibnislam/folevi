import { FolioStack } from "../hero/FolioStack";
import { Icon, type IconName } from "../icons";
import { SIGN_UP_URL } from "../site";
import { TopoArt } from "../TopoArt";
import { ButtonLink, container, cx } from "../ui";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative -mt-14 pt-14">
      <TopoArt />
      <div className={cx(container, "relative grid items-center gap-14 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.02fr_1fr] lg:gap-16 lg:pb-20 lg:pt-20")}>
        <div className="max-w-[560px]">
          <p className="inline-flex items-center gap-2 rounded-control border mk-hair bg-surface/70 px-2.5 py-1 text-[12.5px] font-medium text-muted">
            <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-moss" />
            Free during the preview · Web and Mac
          </p>
          <h1 id="hero-title" className="mt-6 font-display text-[48px] leading-[0.98] tracking-[-0.02em] text-ink sm:text-[68px] lg:text-[76px]">
            A quieter place for ideas that keep growing.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[18px] leading-relaxed text-muted sm:text-[19px]">
            Folevi is a calm workspace for notes, documents and tasks. Catch a thought in seconds, shape it into pages, and
            find it again when it matters — online or off, on the web and on your Mac.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href={SIGN_UP_URL} icon="arrow-right">
              Start writing
            </ButtonLink>
            <ButtonLink href="/mac" variant="secondary">
              Folevi for Mac
            </ButtonLink>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[520px] lg:mr-0">
          <FolioStack />
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
    <section aria-label="What’s included" className="relative border-y mk-hair bg-surface/60">
      <ul className={cx(container, "grid grid-cols-2 gap-x-6 gap-y-4 py-6 sm:grid-cols-3 lg:flex lg:items-center lg:gap-0 lg:divide-x lg:divide-line lg:py-5")}>
        {proof.map((item) => (
          <li key={item.label} className="flex items-center gap-2.5 text-[14.5px] text-ink lg:flex-1 lg:justify-center">
            <Icon name={item.icon} size={18} className="shrink-0 text-muted" />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
