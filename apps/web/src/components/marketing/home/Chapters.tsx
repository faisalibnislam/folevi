import type { ReactNode } from "react";
import { CaptureDemo } from "../demos/CaptureDemo";
import { ConnectDemo } from "../demos/ConnectDemo";
import { ReturnDemo } from "../demos/ReturnDemo";
import { ShapeDemo } from "../demos/ShapeDemo";
import { Eyebrow, Kbd, RegMark, container, cx } from "../ui";

type Tone = "moss" | "marigold" | "plum" | "accent";

const toneText: Record<Tone, string> = {
  moss: "text-moss-ink",
  marigold: "text-marigold-ink",
  plum: "text-plum-ink",
  accent: "text-accent-soft-ink",
};

function Chapter({
  id,
  number,
  name,
  tone,
  title,
  children,
  hint,
  demo,
  reverse = false,
}: {
  id: string;
  number: string;
  name: string;
  tone: Tone;
  title: string;
  children: ReactNode;
  hint: ReactNode;
  demo: ReactNode;
  reverse?: boolean;
}) {
  return (
    <article id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t mk-hair py-16 sm:py-20 lg:py-24">
      <div
        className={cx(
          "grid items-center gap-10 lg:gap-16",
          reverse ? "lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]" : "lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]",
        )}
      >
        <div className={cx("max-w-[480px]", reverse && "lg:order-2")}>
          <p className={cx("flex items-baseline gap-3", toneText[tone])}>
            <span className="font-display text-[40px] leading-none">{number}</span>
            <span className="text-[12px] font-medium uppercase tracking-[0.16em]">{name}</span>
          </p>
          <h3 id={`${id}-title`} className="mt-5 font-display text-[38px] leading-[1.04] tracking-[-0.015em] text-ink sm:text-[46px]">
            {title}
          </h3>
          <div className="mt-5 space-y-4 text-[17px] leading-relaxed text-muted">{children}</div>
          <p className="mt-6 text-[13.5px] leading-8 text-muted [&_kbd]:mx-0.5">{hint}</p>
        </div>
        <div className={cx("mk-field relative p-3 sm:p-6 lg:p-8", `mk-field--${tone}`, reverse && "lg:order-1")}>
          <span aria-hidden="true" className="absolute -left-[7px] -top-[7px]">
            <RegMark />
          </span>
          <span aria-hidden="true" className="absolute -bottom-[7px] -right-[7px]">
            <RegMark />
          </span>
          {demo}
        </div>
      </div>
    </article>
  );
}

export function Chapters() {
  return (
    <section id="chapters" aria-labelledby="chapters-title" className="scroll-mt-14 pt-20 sm:pt-28">
      <div className={container}>
        <div className="grid gap-6 pb-14 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-16">
          <div>
            <Eyebrow>How a page grows</Eyebrow>
            <h2 id="chapters-title" className="mt-5 max-w-[14ch] font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
              Four movements of a good idea.
            </h2>
          </div>
          <p className="max-w-[52ch] self-end text-[17px] leading-relaxed text-muted lg:pb-2">
            Most thoughts start small and untidy. Folevi keeps up with them as they change — from a line typed in a hurry
            to a page you’ll come back to for years. Each chapter below is a working miniature of the real editor. Try
            them.
          </p>
        </div>

        <Chapter
          id="capture"
          number="01"
          name="Capture"
          tone="moss"
          title="Catch it before it drifts."
          hint={
            <>
              <span>Try it:</span> type <Kbd>/</Kbd> then <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> and <Kbd>↵</Kbd>
            </>
          }
          demo={<CaptureDemo />}
        >
          <p>
            Open a page and start typing. Everything is a block, and <span className="text-ink">/</span> turns the line
            you’re on into a heading, a checklist, a quote or a callout — without reaching for the mouse.
          </p>
          <p>Nothing asks you to file it first. Loose notes can live in Unsorted until they find a home.</p>
        </Chapter>

        <Chapter
          id="shape"
          number="02"
          name="Shape"
          tone="marigold"
          title="Give it a spine."
          reverse
          hint={
            <>
              <span>Try it:</span> drag a handle, or select a line and press <Kbd>⌥⇧↑</Kbd> <Kbd>⌥⇧↓</Kbd> to move, <Kbd>⌥⇧→</Kbd> to nest
            </>
          }
          demo={<ShapeDemo />}
        >
          <p>
            Blocks move as easily as index cards. Drag one into place or move it from the keyboard, then nest it under
            another to turn a loose list into an outline.
          </p>
          <p>Children travel with their parent, so the structure you build stays intact as you rearrange.</p>
        </Chapter>

        <Chapter
          id="connect"
          number="03"
          name="Connect"
          tone="plum"
          title="Let pages find each other."
          hint={
            <>
              <span>Try it:</span> type <Kbd>[[</Kbd> and pick a page
            </>
          }
          demo={<ConnectDemo />}
        >
          <p>
            Type <span className="text-ink">[[</span> to link any page in your workspace. Links run both ways: the page
            you mention shows a backlink, so the context travels with the idea.
          </p>
          <p>Sub-pages nest inside their parents, and a page can appear as a simple link or a card.</p>
        </Chapter>

        <Chapter
          id="return"
          number="04"
          name="Return"
          tone="accent"
          title="Come back to where you left it."
          reverse
          hint={
            <>
              <span>Try it:</span> search for <span className="text-ink">labels</span> or{" "}
              <span className="text-ink">printer</span>, then tick off a task
            </>
          }
          demo={<ReturnDemo />}
        >
          <p>
            Search looks through titles and text across your whole workspace. Tasks with dates gather in Today, so the
            next small step is waiting when you open Folevi again.
          </p>
          <p>A calendar and daily notes keep the rest of the week in view.</p>
        </Chapter>
      </div>
    </section>
  );
}
