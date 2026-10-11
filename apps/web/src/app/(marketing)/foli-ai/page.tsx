import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpenCheck, Brain, Languages, Lightbulb, Lock, Mail, Network, Search, Sparkles, ToggleRight, Undo2, Users } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AI_LANGUAGES } from "@/components/ai/languages";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { AskDemo } from "@/components/marketing/demos/AskDemo";
import { CatchUpDemo } from "@/components/marketing/demos/CatchUpDemo";
import { EditDemo } from "@/components/marketing/demos/EditDemo";
import { FlowchartDemo } from "@/components/marketing/demos/FlowchartDemo";
import { TitleDemo } from "@/components/marketing/demos/TitleDemo";
import { WriteDemo } from "@/components/marketing/demos/WriteDemo";
import { Feature, SmallFeature } from "@/components/marketing/featureRows";
import { ChangesPicture, MeetingPicture, ResearchPicture, StudyPicture, ThinkPicture } from "@/components/marketing/foli/pictures";
import { SignUpPanel } from "@/components/marketing/parts";
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

/** One more thing Foli AI does, as a small card with an icon. */
function Extra({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="mk-card p-5">
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-control bg-(--glass-hover) text-(--color-heading)">
        {icon}
      </span>
      <h3 className="mk-h3 mt-4 text-[16.5px]">{title}</h3>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted [&_b]:font-medium [&_b]:text-ink">{children}</p>
    </li>
  );
}

const PLACES: { where: ReactNode; what: string }[] = [
  { where: <b>Foli AI on a note’s floating bar</b>, what: "Write, Ask and Study, about the note you’re in." },
  { where: <><b>Ask Foli AI</b> (<Kbd>⌘J</Kbd>) everywhere else</>, what: "A chat about all your notes, or one folder." },
  { where: <><Kbd>/</Kbd> on an empty line</>, what: "The AI items: write, summarize, flowcharts and more." },
  { where: <b>Select text</b>, what: "Edit with AI: rewrite, translate, explain." },
  { where: <b>The Foli AI page</b>, what: "Every chat, to rename, pin, search, export or share." },
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
            <p className="mk-lede mt-6 max-w-[52ch]">
              Foli AI answers questions from your notes, writes and edits with you, and tidies a page when you ask. It shows every change before it happens, only reads the notes you can open, and you can switch it off.
            </p>
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
            <ul className="mt-4 space-y-3.5">
              {PLACES.map((p, i) => (
                <li key={i} className="text-[14.5px] leading-snug [&_b]:font-semibold [&_b]:text-(--color-heading)">
                  <span className="block text-ink">{p.where}</span>
                  <span className="block text-muted">{p.what}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </HeaderCard>

      <Card aria-labelledby="ask-title">
        <SectionHeading id="ask-title" eyebrow="Ask and change" title="Ask a question, or ask for a change." lede="One chat for both. Questions get an answer with the notes it came from. Requests to change your notes become a set of changes you review and approve." />
        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Ask"
            title="Answers from your notes, with sources."
            art="art-49"
            picture={<AskDemo />}
            points={[
              <>Every answer lists the notes it used. Click one to open it at the right place.</>,
              <>Ask follow-ups in the same chat, or ask about one folder so answers stay inside it.</>,
              <>
                Attach files: PDFs, images, spreadsheets and text. Numbers in a spreadsheet are worked out exactly, not guessed.
              </>,
              <>Turn on <b>Web</b> (when web research is on in Settings) to mix in what the web says, with links to the pages it read.</>,
              <>Chats are saved: rename, pin, search, export or delete them, or turn history off. Share one with your workspace; people only see it if they can open every note it cites.</>,
            ]}
          >
            Try “What am I working on this week?” or “Which tasks are still open?”. If your notes don’t have the answer, Foli AI says so before it gives a general one.
          </Feature>

          <Feature
            reverse
            tint
            eyebrow="Make changes"
            title="Ask it to fix the note. It changes the note."
            art="art-27"
            picture={<ChangesPicture />}
            points={[
              <>Fix, tidy, renumber, rename, shorten or reorganise a page. Foli AI edits the note’s own blocks, so images, embeds and links stay where they are.</>,
              <>Move notes into folders, add tags, make a note, a checklist or tasks, or merge duplicates.</>,
              <>You see every change first, as before and after. Approve all of them or only some.</>,
              <>A version of each note is saved before anything changes, and one <b>Undo</b> puts it all back.</>,
            ]}
          >
            Say what you want in the chat, like “the section numbers are messed up, please fix” or “put my travel notes in a Travel folder”. Nothing changes until you approve it.
          </Feature>
        </div>
      </Card>

      <Card aria-labelledby="write-title">
        <SectionHeading id="write-title" eyebrow="Write and edit" title="Write with it, right in the page." lede="It uses the note you’re in as context, writes as you watch, and you can stop it, try again or tweak the result before it goes in." />
        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Edit selected text"
            title="Select text and say what to change."
            art="art-16"
            picture={<EditDemo />}
            points={[
              <>Improve the writing, fix spelling and grammar, make it shorter, longer or simpler, or change the tone.</>,
              <>Translate into {AI_LANGUAGES.length} languages, or ask it to explain or summarize the selection.</>,
              <>Turn text into a list, a table or a checklist, or type your own instruction.</>,
              <>
                See the changes before they replace anything. <b>Replace</b> swaps the text; <b>Insert below</b> keeps both.
              </>,
            ]}
          >
            Select a sentence or a whole section and press <Kbd>⌘J</Kbd>, or use the AI button in the selection toolbar.
          </Feature>

          <Feature
            reverse
            tint
            eyebrow="Write"
            title="From a blank page to next steps."
            art="art-03"
            picture={<WriteDemo />}
            points={[
              <><b>Continue</b> picks up where you stopped. <b>Summarize</b> and <b>Outline</b> sum up long pages.</>,
              <><b>Action items</b> writes real to-dos, so they show up in Tasks with the rest.</>,
              <><b>Brainstorm</b> gives you a list to start from, and <b>Title</b> suggests a name for the note.</>,
              <>Or describe what you want: a paragraph, an email, or a whole page.</>,
            ]}
          >
            Open Foli AI from the floating bar, type <Kbd>/</Kbd> on an empty line, or press <Kbd>⌘J</Kbd>.
          </Feature>

          <Feature
            stacked
            eyebrow="Flowcharts"
            title="Describe a process. Get a flowchart."
            art="art-42"
            picture={<FlowchartDemo />}
            points={[
              <>Write the steps, or one sentence. Foli AI draws the shapes, decisions and arrows, and lays them out.</>,
              <>Change it in words: “add an approval step after review”.</>,
              <>Every shape stays editable, and <Kbd>⌘Z</Kbd> undoes the whole AI change.</>,
            ]}
          >
            Insert a flowchart with <Kbd>/</Kbd> and click <b>Create with AI</b>, or the <b>AI</b> button on a chart you already have.
          </Feature>
        </div>
      </Card>

      <Card aria-labelledby="think-title">
        <SectionHeading id="think-title" eyebrow="Think, study and meet" title="Decide, learn and follow up." lede="Tools that work on the note you’re in, or just the part you’ve selected." />
        <div className="mt-12 space-y-10 sm:space-y-12">
          <Feature
            eyebrow="Think it through"
            title="Nine ways to work through a decision."
            art="art-12"
            picture={<ThinkPicture />}
            points={[
              <>Pros and cons, a decision matrix, SWOT, risks and what to do about them, and a pre-mortem.</>,
              <>A mind map, “How might we” questions, SCAMPER and six thinking hats for new ideas.</>,
              <>A decision matrix’s weighted totals are worked out exactly, and a pre-mortem ends in to-dos.</>,
            ]}
          >
            Pick a framework in Foli AI’s Write tab. It reads the note, or your selection, and writes the result for you to insert.
          </Feature>

          <Feature
            reverse
            tint
            eyebrow="Study"
            title="Flashcards and quizzes from any note."
            art="art-40"
            picture={<StudyPicture />}
            points={[
              <>Foli AI writes flashcards and quiz questions into the note, as toggles you can edit.</>,
              <>The <b>Study</b> tab flips through cards (Know it or Again) and runs the quiz with explanations and a score.</>,
              <>It can use toggles you wrote yourself, too.</>,
            ]}
          >
            Good for class notes, a book you’re reading or anything you want to remember.
          </Feature>

          <Feature
            eyebrow="Meetings and voice notes"
            title="From a recording to who does what."
            art="art-38"
            picture={<MeetingPicture />}
            points={[
              <>Record a voice note in any page, then <b>Transcribe</b> it when you want to (never on its own).</>,
              <>A meeting summary lists the decisions, then the action items as to-dos.</>,
              <>Owners become mentions and the to-do’s assignee, and real dates become due dates.</>,
            ]}
          >
            Use it on a transcript, on notes you typed during the meeting, or on a pasted agenda.
          </Feature>
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
          picture={<ResearchPicture />}
          points={[
            <>Foli AI searches the web, reads the pages and your notes, and writes a report with numbered sources.</>,
            <>It works in the background for a few minutes, so you can keep writing.</>,
            <><b>Save as note</b> keeps the report, with its sources, in your notes.</>,
          ]}
        >
          Pick <b>Research</b> in the chat. It shows when web research is on in Settings.
        </Feature>
      </Card>

      <Card aria-labelledby="more-title">
        <SectionHeading id="more-title" eyebrow="Around your notes" title="And the quieter things." />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <SmallFeature art="art-30" picture={<CatchUpDemo />} title="Catch me up" body="On Home, one click writes a short brief of your week: what changed in your notes and the tasks due next, with links." />
          <SmallFeature art="art-01" picture={<TitleDemo />} title="Titles" body="Foli AI suggests a title from what the note says, and untitled notes offer it on their own." />
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Extra icon={<Languages size={17} />} title="Translate a whole note">
            Into a new note beside the original, or in place after a preview. Mentions, links and code stay as they are.
          </Extra>
          <Extra icon={<Lightbulb size={17} />} title="Suggestions under a note">
            Open questions and lines that read like tasks, found without using credits (plus related notes and likely duplicates on Pro, Pro AI and paid teams). Turn a line into a to-do or link a note in one click.
          </Extra>
          <Extra icon={<Network size={17} />} title="A graph of your notes">
            The people, projects and topics in your notes and how they connect, as a map you can explore with the mouse or the keyboard. On Pro, Pro AI and paid team workspaces.
          </Extra>
          <Extra icon={<Brain size={17} />} title="Memory you control">
            Tell Foli AI how you like answers (tone, language, length, words to use) and it remembers. Only what you save; edit or delete it in Settings.
          </Extra>
          <Extra icon={<Mail size={17} />} title="Daily or weekly digests">
            A short note in your Inbox on what changed and what’s due, at the time you choose. Off until you turn it on.
          </Extra>
          <Extra icon={<Search size={17} />} title="Search by meaning">
            On Pro, Pro AI and paid team workspaces, Foli AI finds notes by what they mean, not only the words in them.
          </Extra>
        </ul>
      </Card>

      <Card aria-labelledby="private-title">
        <SectionHeading id="private-title" eyebrow="Private and in your control" title="Your notes stay yours." />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Extra icon={<Lock size={17} />} title="Only what you can open">
            Foli AI reads only the notes you can open, and a shared chat only shows to people who can open every note it cites.
          </Extra>
          <Extra icon={<Sparkles size={17} />} title="Not used for training">
            Requests go to Google’s paid Gemini API, which doesn’t use them to train models. Folevi doesn’t train models on your notes either.
          </Extra>
          <Extra icon={<Undo2 size={17} />} title="Nothing changes on its own">
            Every change to your notes is previewed and needs your approval. A version is saved first, and one Undo reverses it.
          </Extra>
          <Extra icon={<ToggleRight size={17} />} title="Switches in Settings">
            Turn Foli AI off, turn chat history off, and choose whether it can use the web or read attached files.
          </Extra>
          <Extra icon={<Users size={17} />} title="Teams decide too">
            In a workspace, Foli AI follows its plan and members’ access. A Core workspace has no AI at all.
          </Extra>
          <Extra icon={<BookOpenCheck size={17} />} title="It says what it doesn’t know">
            When your notes don’t answer the question, Foli AI says so before it gives a general answer.
          </Extra>
        </ul>
      </Card>

      <Card aria-labelledby="plans-title">
        <SectionHeading id="plans-title" eyebrow="Plans and credits" title="Pay for the AI you use." lede="Foli AI runs on AI credits. One credit is one cent of what the AI costs to run: rewriting a paragraph is about 1 credit, a question about 2, a flowchart 3 to 5." />
        <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Free", `${MONTHLY_CREDITS.free} credits a month`],
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
        <ul className="mt-6 max-w-[70ch] space-y-2 text-[15px] leading-relaxed text-muted">
          <li>
            New accounts start with a {TRIAL_DAYS}-day Pro AI trial with {TRIAL_CREDITS} credits.
          </li>
          <li>
            On Pro and Pro AI you can add a pack of {CREDIT_PACKS.credits_500.credits.toLocaleString("en-US")} or {CREDIT_PACKS.credits_1000.credits.toLocaleString("en-US")} credits, used after the monthly ones and valid for 12 months.
          </li>
          <li>In a paid team workspace, every member gets the plan’s credits for that workspace.</li>
        </ul>
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

      <SignUpPanel title="Ask your notes something." body="Create an account, write a few notes, and ask Foli AI about them. The Free plan includes AI credits every month." />
    </PageFrame>
  );
}
