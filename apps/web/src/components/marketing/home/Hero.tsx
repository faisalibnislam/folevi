import { HeroNote } from "./HeroNote";
import { HeroTitle } from "./HeroTitle";
import { HeroApps } from "./GetApps";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-hero">
      <HeroNote
        title={<HeroTitle />}
        after={<HeroApps />}
      />
    </section>
  );
}

