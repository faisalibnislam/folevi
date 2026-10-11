import Link from "next/link";
import type { ReactNode } from "react";
import { Brain, Languages, Lightbulb, Mail, Network, Search } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AI_LANGUAGES } from "@/components/ai/languages";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { AskDemo } from "@/components/marketing/demos/AskDemo";
import { CatchUpDemo } from "@/components/marketing/demos/CatchUpDemo";
import { EditDemo } from "@/components/marketing/demos/EditDemo";
import { FlowchartDemo } from "@/components/marketing/demos/FlowchartDemo";
import { TitleDemo } from "@/components/marketing/demos/TitleDemo";
import { WriteDemo } from "@/components/marketing/demos/WriteDemo";
import { Checks } from "@/components/marketing/Checks";
import { Feature, SmallFeature } from "@/components/marketing/featureRows";
import { ChangesPicture, MeetingPicture, ResearchPicture, StudyPicture, ThinkPicture } from "@/components/marketing/foli/pictures";
import { SignUpPanel } from "@/components/marketing/parts";
import { Play } from "@/components/marketing/Play";
import { pageMetadata } from "@/components/marketing/seo";
import { SIGN_UP_URL } from "@/components/marketing/site";
import { ButtonLink, Eyebrow, Kbd, SectionHeading } from "@/components/marketing/ui";
import { CREDIT_PACKS, MONTHLY_CREDITS, TRIAL_CREDITS, TRIAL_DAYS } from "@/lib/plans";

export const metadata = pageMetadata({
  title: "Foli AI: the assistant in Folevi",
  description:
    "Everything Foli AI does in Folevi: answers from your notes with sources, edits and tidies notes when you ask (you approve first), writing, translation, flowcharts, study cards, meeting summaries, web research and more.",
  path: "/foli-ai",
});

/** One more thing Foli AI does, as a small tile with an icon (and the plans it's on, when not every plan). */
function Extra({ icon, title, plans }: { icon: ReactNode; title: string; plans?: string }) {
  return (
    <li className="mk-card flex items-center gap-3.5 p-4">
      <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-control bg-(--glass-hover) text-(--color-heading)">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="mk-h3 text-[15.5px]">{title}</h3>
        {plans ? <p className="mt-0.5 text-[13px] text-muted">{plans}</p> : null}
      </div>
    </li>
  );
}

const PLACES: ReactNode[] = [
  <><b>Floating bar</b> in a note</>,
  <><Kbd>⌘J</Kbd> anywhere else</>,
  <><Kbd>/</Kbd> on an empty line</>,
  <><b>Select text</b> to edit it</>,
  <><b>Foli AI page</b> for every chat</>,
];

export default function FoliPage() {
  return (
    <PageFrame art="art-49">
      <HeaderCard
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Foli AI", path: "/foli-ai" },
        ]}
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div>
            <AiIcon size={36} />
            <Eyebrow className="mt-6">Foli AI</Eyebrow>
            <h1 className="mk-display mt-4 max-w-[16ch] text-[44px] sm:text-[60px] lg:text-[68px]">The assistant that knows your notes.</h1>
            <p className="mk-lede mt-6 max-w-[52ch]">Answers from your notes, and edits you approve first.</p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <ButtonLink href={SIGN_UP_URL} icon="arrow-right">
                Start writing
              </ButtonLink>
              <ButtonLink href="/docs/ai-assistant" variant="secondary">
                Read the Foli AI guide
              </ButtonLink>
            </div>
          </div>
          <div className="mk-card p-6 sm:p-7">
            <p className="mk-caps">Where to find it</p>
            <ul className="mt-3">
              {PLACES.map((place, i) => (
                <li key={i} className="border-t py-2.5 text-[15px] text-ink mk-hair first:border-t-0 [&_b]:font-semibold [&_b]:text-(--color-heading)">
                  {place}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </HeaderCard>

      <Card aria-labelledby="ask-title">
        <SectionHeading id="ask-title" eyebrow="Ask and change" title="Ask a question, or ask for a change." lede="One chat for both." />
        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Ask"
            title="Answers from your notes, with sources."
            art="art-49"
            picture={<AskDemo />}
            points={[
              <>Click a source to open the note</>,
              <>Attach PDFs, images and spreadsheets</>,
              <>Turn on <b>Web</b> for web sources</>,
            ]}
          />

          <Feature
            reverse
            tint
            eyebrow="Make changes"
            title="Ask it to fix the note. It changes the note."
            art="art-27"
            picture={
              <Play>
                <ChangesPicture />
              </Play>
            }
            points={[
              <>Fix, tidy or reorganise a page</>,
              <>Approve each change first</>,
              <>One <b>Undo</b> puts it all back</>,
            ]}
          />
        </div>
      </Card>

      <Card aria-labelledby="write-title">
        <SectionHeading id="write-title" eyebrow="Write and edit" title="Write with it, right in the page." lede="It uses the note you’re in as context." />
        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Edit selected text"
            title="Select text and say what to change."
            art="art-16"
            picture={<EditDemo />}
            points={[
              <>Rewrite, shorten or change the tone</>,
              <>Translate into {AI_LANGUAGES.length} languages</>,
              <>Preview before it replaces anything</>,
            ]}
          />

          <Feature
            reverse
            tint
            eyebrow="Write"
            title="From a blank page to next steps."
            art="art-03"
            picture={<WriteDemo />}
            points={[
              <><b>Continue</b>, <b>Summarize</b> or <b>Outline</b></>,
              <><b>Action items</b> become to-dos</>,
              <>Or describe what you want</>,
            ]}
          />

          <Feature
            stacked
            eyebrow="Flowcharts"
            title="Describe a process. Get a flowchart."
            art="art-42"
            picture={<FlowchartDemo />}
            points={[
              <>Write the steps, or one sentence</>,
              <>Change it in words</>,
              <>Every shape stays editable</>,
            ]}
          />
        </div>
      </Card>

      <Card aria-labelledby="think-title">
        <SectionHeading id="think-title" eyebrow="Think, study and meet" title="Decide, learn and follow up." lede="On the note you’re in, or just a selection." />
        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Think it through"
            title="Nine ways to work through a decision."
            art="art-12"
            picture={
              <Play>
                <ThinkPicture />
              </Play>
            }
            points={[
              <>Pros and cons, SWOT and a decision matrix</>,
              <>Mind map, SCAMPER and six thinking hats</>,
              <>Weighted totals worked out exactly</>,
            ]}
          />

          <Feature
            reverse
            tint
            eyebrow="Study"
            title="Flashcards and quizzes from any note."
            art="art-40"
            picture={
              <Play>
                <StudyPicture />
              </Play>
            }
            points={[
              <>Written into the note as toggles</>,
              <>Flip cards: <b>Know it</b> or <b>Again</b></>,
              <>Quizzes with explanations and a score</>,
            ]}
          />

          <Feature
            eyebrow="Meetings and voice notes"
            title="From a recording to who does what."
            art="art-38"
            picture={
              <Play>
                <MeetingPicture />
              </Play>
            }
            points={[
              <><b>Transcribe</b> recordings when you choose</>,
              <>Decisions, then to-dos</>,
              <>Owners and due dates filled in</>,
            ]}
          />
        </div>
      </Card>

      <Card aria-labelledby="research-title">
        <h2 id="research-title" className="sr-only">
          Research
        </h2>
        <Feature
          reverse
          eyebrow="Research"
          title="A report from the web and your notes."
          art="art-30"
          picture={
            <Play>
              <ResearchPicture />
            </Play>
          }
          points={[
            <>Numbered sources from both</>,
            <>Runs in the background while you write</>,
            <><b>Save as note</b> keeps it</>,
          ]}
        />
      </Card>

      <Card aria-labelledby="more-title">
        <SectionHeading id="more-title" eyebrow="Around your notes" title="And the quieter things." />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <SmallFeature art="art-30" picture={<CatchUpDemo />} title="Catch me up" body="A short brief of your week, from Home." />
          <SmallFeature art="art-01" picture={<TitleDemo />} title="Titles" body="A title from what the note says." />
        </div>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Extra icon={<Languages size={17} />} title="Translate a whole note" />
          <Extra icon={<Lightbulb size={17} />} title="Suggestions under a note" />
          <Extra icon={<Brain size={17} />} title="Memory you control" />
          <Extra icon={<Mail size={17} />} title="Daily or weekly digests" />
          <Extra icon={<Network size={17} />} title="A graph of your notes" plans="Pro, Pro AI and paid teams" />
          <Extra icon={<Search size={17} />} title="Search by meaning" plans="Pro, Pro AI and paid teams" />
        </ul>
      </Card>

      <Card aria-labelledby="private-title">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-16">
          <SectionHeading id="private-title" eyebrow="Private and in your control" title="Your notes stay yours." lede="Foli AI reads only the notes you can open." />
          <Checks
            className="lg:text-[16px]"
            items={[
              <>Not used to train AI models</>,
              <>Every change needs your approval</>,
              <>Switch it off in Settings</>,
            ]}
          />
        </div>
      </Card>

      <Card aria-labelledby="plans-title">
        <SectionHeading id="plans-title" eyebrow="Plans and credits" title="Pay for the AI you use." lede="One credit is one cent of what the AI costs." />
        <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Free", `${TRIAL_CREDITS} in the ${TRIAL_DAYS}-day trial`],
            ["Core", "No AI at all"],
            ["Pro", `${MONTHLY_CREDITS.pro} credits a month`],
            ["Pro AI", `${MONTHLY_CREDITS.pro_ai} credits a month`],
          ].map(([plan, credits]) => (
            <div key={plan} className="mk-card p-5">
              <dt className="mk-caps">{plan}</dt>
              <dd className="mk-h3 mt-2 text-[19px]">{credits}</dd>
            </div>
          ))}
        </dl>
        <Checks
          className="mt-8"
          items={[
            <>
              New accounts get a {TRIAL_DAYS}-day Pro AI trial with {TRIAL_CREDITS} credits
            </>,
            <>
              Packs of {CREDIT_PACKS.credits_500.credits.toLocaleString("en-US")} or {CREDIT_PACKS.credits_1000.credits.toLocaleString("en-US")} credits on Pro and Pro AI
            </>,
            <>Paid team members each get the plan’s credits</>,
          ]}
        />
        <p className="mt-6 flex flex-wrap gap-x-8 gap-y-1 text-[15px]">
          <Link href="/pricing" className="mk-link inline-flex min-h-11 items-center">
            See pricing
          </Link>
          <Link href="/blog/what-an-ai-credit-is" className="mk-link inline-flex min-h-11 items-center">
            What an AI credit is
          </Link>
          <Link href="/features/ai-notes" className="mk-link inline-flex min-h-11 items-center">
            Foli AI on the features page
          </Link>
        </p>
      </Card>

      <SignUpPanel title="Ask your notes something." body={`Every new account gets ${TRIAL_CREDITS} AI credits to try it, free for ${TRIAL_DAYS} days.`} />
    </PageFrame>
  );
}
