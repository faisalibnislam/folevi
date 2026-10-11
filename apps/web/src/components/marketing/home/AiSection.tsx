import Link from "next/link";
import { AiIcon } from "@/components/ai/AiIcon";
import { Icon } from "../icons";
import { AskDemo } from "../demos/AskDemo";
import { WriteDemo } from "../demos/WriteDemo";
import { FlowchartDemo } from "../demos/FlowchartDemo";
import { EditDemo } from "../demos/EditDemo";
import { CatchUpDemo } from "../demos/CatchUpDemo";
import { TitleDemo } from "../demos/TitleDemo";
import { Kbd, SectionHeading, box, container, cx } from "../ui";
import { Feature, SmallFeature } from "../featureRows";

/*
 * Foli AI on the home page, kept short: a line per feature beside its picture (HTML replicas of the app's
 * own AI surfaces), and the full list on the Foli AI page (/foli-ai).
 */

export function AiSection() {
  return (
    <section id="ai" aria-labelledby="ai-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <AiIcon size={32} />
        <SectionHeading className="mt-6" id="ai-title" eyebrow="Foli AI" title="Ask, write and draw with your notes." lede="It only reads the notes you can open, and changes nothing without your approval." />

        <div className="mt-12 space-y-10">
          <Feature
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
            reverse
            tint
            eyebrow="Edit"
            title="Select text and say what to change."
            art="art-16"
            picture={<EditDemo />}
            points={[<>Rewrite, shorten, fix spelling</>, <>Translate or explain</>, <>See the changes before they replace anything</>]}
          />
          <Feature
            eyebrow="Write"
            title="Turn a messy page into next steps."
            art="art-03"
            picture={<WriteDemo />}
            points={[<>Summaries and outlines</>, <>Action items as real to-dos</>, <>Brainstorm, continue, title</>]}
          />
          <Feature
            stacked
            tint
            eyebrow="Flowcharts"
            title="Describe a process. Get a flowchart."
            art="art-42"
            picture={<FlowchartDemo />}
            points={[<>From one sentence</>, <>Change it in words</>, <>Every shape stays editable</>]}
          />
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <SmallFeature art="art-30" picture={<CatchUpDemo />} title="Catch me up" body="A short brief of your week." />
          <SmallFeature art="art-01" picture={<TitleDemo />} title="Titles" body="A title from what the note says." />
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
