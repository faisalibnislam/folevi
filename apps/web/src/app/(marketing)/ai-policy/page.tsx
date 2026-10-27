import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { PageHeader } from "@/components/marketing/ui";
import { PageFrame } from "@/components/marketing/cards";

export const metadata = pageMetadata({
  title: "Foli AI policy",
  description: "What Foli AI, Folevi’s AI assistant, helps with and what it won’t: sensitive topics, medical, legal and financial questions, harmful requests, and what happens when someone keeps asking.",
  path: "/ai-policy",
});

const toc = [
  { id: "helps", label: "What it helps with" },
  { id: "sensitive", label: "Sensitive topics" },
  { id: "advice", label: "Medical, legal and money" },
  { id: "wont", label: "What it won’t do" },
  { id: "crisis", label: "If you’re struggling" },
  { id: "writing", label: "Writing about dark subjects" },
  { id: "refusals", label: "When it says no" },
];

// docs/AI_GUARDRAILS.md is the source of this page: keep the two in step.
export default function AiPolicyPage() {
  return (
    <PageFrame>
      <PageHeader eyebrow="Legal" title="Foli AI policy" lede="What Folevi’s AI assistant helps with, and what it won’t. The same rules apply on every plan, in every workspace." />
      <DocShell toc={toc}>
        <h2 id="helps">What it helps with</h2>
        <p>
          Foli AI is there for your notes and your writing: answering questions from your notes, summarising, editing,
          drafting, translating and organising. If your notes don’t have the answer, it gives a short general answer and
          says that it didn’t come from your notes.
        </p>

        <h2 id="sensitive">Sensitive topics</h2>
        <p>
          For legal but sensitive subjects, such as alcohol, gambling, cannabis where it’s legal, sexual health and harm
          reduction, Foli AI answers factually and neutrally, with safety information where it matters. It never promotes
          or glamorises them.
        </p>

        <h2 id="advice">Medical, legal and money questions</h2>
        <p>
          Foli AI can explain general information, but it isn’t a doctor, lawyer or financial adviser, and it says so. For
          decisions about your own health, a legal matter or your money, talk to a professional. If something sounds like a
          medical emergency, it will tell you to contact emergency services straight away. AI can be wrong: check what it
          says before relying on it.
        </p>

        <h2 id="wont">What it won’t do</h2>
        <p>Foli AI won’t give real, usable instructions or help for:</p>
        <ul>
          <li>making drugs, weapons or explosives;</li>
          <li>committing crimes, fraud or scams;</li>
          <li>hacking, tracking or stalking other people;</li>
          <li>self-harm or suicide methods;</li>
          <li>any sexual content involving minors.</li>
        </ul>
        <p>
          That holds however a request is put, including as fiction, role-play, a hypothetical or “for research”. When it
          declines, it says so in a sentence and, where it can, points you to something useful instead.
        </p>

        <h2 id="crisis">If you’re struggling</h2>
        <p>
          If you write to Foli AI about self-harm or suicide, or seem to be in crisis, it will respond with care, keep talking
          with you, and point you to a crisis line. You can find one for your country at{" "}
          <a href="https://findahelpline.com" rel="noopener noreferrer">findahelpline.com</a>. If you’re in immediate danger,
          contact your local emergency number.
        </p>

        <h2 id="writing">Writing about dark subjects</h2>
        <p>
          Crime novels, journalism, research on addiction, history: Foli AI helps you write, edit and summarise them. It
          won’t add real step-by-step instructions for causing harm, even inside a story.
        </p>

        <h2 id="refusals">When it says no</h2>
        <ul>
          <li>A short refusal doesn’t use any AI credits.</li>
          <li>
            We count refusals by kind for each account, to spot misuse. We never keep the question, the answer or your notes
            for this.
          </li>
          <li>
            If an account asks for harmful things again and again (five times within an hour), Foli AI is paused for that
            account for 24 hours. Conversations about being in crisis never count towards a pause. If you think a pause was a
            mistake, <Link href="/support">contact support</Link>.
          </li>
        </ul>
        <p>
          These rules sit alongside our <Link href="/terms#use">Acceptable use</Link> terms and the{" "}
          <Link href="/privacy#ai">privacy policy</Link>.
        </p>
      </DocShell>
    </PageFrame>
  );
}
