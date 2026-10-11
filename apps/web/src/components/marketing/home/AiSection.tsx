import Link from "next/link";
import { AiIcon } from "@/components/ai/AiIcon";
import { Icon } from "../icons";
import { AskDemo } from "../demos/AskDemo";
import { EditDemo } from "../demos/EditDemo";
import { Kbd, SectionHeading, box, container, cx } from "../ui";
import { Feature } from "../featureRows";
import { Float, Mark } from "../fun";
import { CursorPiece } from "../pieces";

/*
 * Foli AI on the home page, kept short: two features (Ask and Edit), side by side, each picture over a few points
 * (HTML replicas of the app's own AI surfaces), and the full list on the Foli AI page (/foli-ai).
 */

export function AiSection() {
  return (
    <section id="ai" aria-labelledby="ai-title" className={cx(container, "scroll-mt-20")}>
      <div className={cx(box, "relative")}>
        <Float depth={0.12} className="right-[30%] top-24">
          <CursorPiece name="Foli AI" />
        </Float>
        <AiIcon size={32} />
        <SectionHeading className="mt-6" id="ai-title" eyebrow="Foli AI" title={
            <>
              Ask, write and draw with <Mark>your notes</Mark>.
            </>
          } lede="It only reads notes you can open, and asks before changes." />

        <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-8">
          <Feature
            column
            eyebrow="Ask"
            title="Answers from your notes, with sources."
            art="art-49"
            picture={<AskDemo />}
            points={[
              <>
                <Kbd>⌘J</Kbd> anywhere
              </>,
              <>Links to the notes it used</>,
              <>Ask for changes, approve them first</>,
            ]}
          />
          <Feature
            column
            eyebrow="Edit"
            title="Select text and say what to change."
            art="art-16"
            picture={<EditDemo />}
            points={[<>Rewrite, shorten, fix spelling</>, <>Translate or explain</>, <>See the changes before they replace anything</>]}
          />
        </div>

        <p className="mt-8 text-[15px]">
          <Link href="/foli-ai" className="mk-link inline-flex min-h-11 items-center gap-1.5">
            Everything Foli AI does <Icon name="arrow-right" size={15} />
          </Link>
        </p>
      </div>
    </section>
  );
}
