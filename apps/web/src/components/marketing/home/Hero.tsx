import "@/components/editor/editor.css";
import { HeroNote } from "./HeroNote";
import { HeroStaticBody } from "./HeroStaticBody";
import { Float, Hand, Sticker } from "../fun";
import { AiPiece, CursorPiece, SyncPiece, ThemesPiece } from "../pieces";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-hero">
      <HeroNote
        title={
          <>
            A quiet <span className="mk-hero-mark">notes app</span> for ideas that keep growing.
          </>
        }
        extras={<HeroExtras />}
      >
        <HeroStaticBody />
      </HeroNote>
    </section>
  );
}

/** Around the hero note: a nudge to try it, two stickers and a few pieces of the app drifting by. */
function HeroExtras() {
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none absolute right-5 top-6 z-10 sm:right-12 sm:top-10 lg:right-16 lg:top-12">
        <Sticker tone="violet" rotate={8}>
          Works offline
        </Sticker>
      </div>
      <Float depth={0.08} className="right-[18%] top-[150px] xl:right-[24%]">
        <CursorPiece name="Maya" />
      </Float>
      <div aria-hidden="true" className="pointer-events-none absolute right-20 top-[440px] z-10 hidden xl:block">
        <Hand rotate={-5} arrow="down-left">
          go on, type in it!
        </Hand>
      </div>
      <Float depth={0.16} delay={900} className="right-2 top-[600px] hidden xl:block [--tilt:3deg]">
        <AiPiece text="You have two tasks left before swap day." />
      </Float>
      <Float depth={0.22} delay={400} className="right-10 top-[770px] hidden xl:block [--tilt:-4deg]">
        <ThemesPiece arts={["art-49", "art-16", "art-39"]} />
      </Float>
      <Float depth={0.1} delay={1500} className="right-24 top-[880px] hidden xl:block">
        <SyncPiece label="Saved on this device" />
      </Float>
    </>
  );
}
