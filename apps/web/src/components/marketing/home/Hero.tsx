import "@/components/editor/editor.css";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";
import { SIGN_UP_URL } from "../site";
import { ButtonLink } from "../ui";
import { HeroNote } from "./HeroNote";
import { HeroStaticBody } from "./HeroStaticBody";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-hero">
      <HeroNote
        title="A quiet notes app for ideas that keep growing."
        chip="Free to start · On the web, Mac app coming soon"
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg" className="mk-hero-primary">
                Start writing
              </ButtonLink>
              <ButtonLink href="/mac" variant="secondary" size="lg">
                Folevi for Mac
              </ButtonLink>
            </div>
            <p className="mt-4 text-[13.5px] text-muted">
              Free plan with no card. New accounts get {TIER_NAMES[TRIAL_TIER]} free for {TRIAL_DAYS} days.
            </p>
          </>
        }
      >
        <HeroStaticBody />
      </HeroNote>
    </section>
  );
}
