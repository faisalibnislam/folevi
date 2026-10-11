import "@/components/editor/editor.css";
import { HeroNote } from "./HeroNote";
import { HeroStaticBody } from "./HeroStaticBody";
import { HeroTitle } from "./HeroTitle";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-hero">
      <HeroNote
        title={<HeroTitle />}
      >
        <HeroStaticBody />
      </HeroNote>
    </section>
  );
}

