import type { ReactNode } from "react";
import { Checks } from "@/components/marketing/Checks";
import { Icon } from "@/components/marketing/icons";
import { Play } from "@/components/marketing/Play";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { PageHeader, container, cx } from "@/components/marketing/ui";
import { PageFrame } from "@/components/marketing/cards";

export const metadata = pageMetadata({
  title: "Security and privacy for your notes",
  description:
    "How Folevi protects your notes: verified email, two-step verification, encryption in transit and at rest, private sharing, full export and subprocessors.",
  path: "/security",
});

const subprocessors = [
  {
    name: "Convex",
    role: "Database and backend",
    data: "Your account record, workspaces, pages, blocks, tasks, uploaded files and the sync operations that keep your devices up to date.",
  },
  {
    name: "Vercel",
    role: "Web hosting",
    data: "Serves folevi.com and the web app. Processes requests to our servers, including IP addresses and standard request logs.",
  },
  {
    name: "Mailtrap",
    role: "Transactional email",
    data: "Your email address and the content of the emails we send you, such as verification, security notices and share invitations. Open and click tracking is turned off.",
  },
  {
    name: "Google (Gemini API)",
    role: "Foli AI (AI assistant)",
    data: "Only when you use Foli AI: your request and the notes it needs to answer (the open note, or notes found by search that you can already read). Never sent while Foli AI is off.",
  },
  {
    name: "Polar",
    role: "Payments (merchant of record)",
    data: "For paid plans and AI credit packs: your email address, billing details, the plan or pack, and internal account ids that link a payment to your account or workspace. Never the content of your notes. Card numbers go straight to Polar; Folevi never sees or stores them.",
  },
];

/** One card of the page: its title, one lead line, then checkmark lines (the ids keep old /security#… links working). */
function Section({
  id,
  title,
  lead,
  items = [],
  className,
  children,
}: {
  id: string;
  title: string;
  lead: ReactNode;
  items?: ReactNode[];
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("mk-box scroll-mt-8 px-5 py-8 sm:p-8 lg:p-10", className)}>
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="mk-h3 text-[22px]">
          {title}
        </h2>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">{lead}</p>
        <Checks items={items} className="mt-5" />
      </div>
      {children}
    </section>
  );
}

/** A two-step code arriving digit by digit, as on the sign-in screen. */
function CodePicture() {
  return (
    <Play className="mt-7">
      <div role="img" aria-label="Signing in asks for the 6-digit code from your authenticator app." className="mk-panel rounded-panel p-4 sm:p-5">
        <p className="text-[12.5px] font-medium text-muted">6-digit code</p>
        <div className="mt-2 flex gap-1.5">
          {["4", "8", "1", "9", "2", "7"].map((digit, i) => (
            <span
              key={i}
              data-step
              className="grid h-11 w-9 place-items-center rounded-control border border-(--color-line) bg-(--color-surface) font-mono text-[17px] text-(--color-heading)"
            >
              {digit}
            </span>
          ))}
        </div>
      </div>
    </Play>
  );
}

/** A public link as the Share dialog lists it: expiry, password, and Revoke. */
function LinkPicture() {
  return (
    <Play>
      <div
        role="img"
        aria-label="A public link in the Share dialog: it expires on a set date, is password protected, and has a Revoke button."
        className="mk-panel rounded-panel p-4 sm:p-6"
      >
        <div className="mk-app-pop rounded-panel p-4 text-[13px]">
          <p data-step className="flex items-center gap-2 font-semibold text-(--color-heading)">
            <Icon name="link" size={15} /> Public link
          </p>
          <p data-step className="mt-3 truncate rounded-chip border border-(--color-line) px-3 py-2 font-mono text-[12px] text-ink">
            …/s/k3Jd••••••••
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span data-step className="mk-chip gap-1.5">
              <Icon name="clock" size={13} /> Expires 12 Oct
            </span>
            <span data-step className="mk-chip gap-1.5">
              <Icon name="lock" size={13} /> Password protected
            </span>
            <span data-step className="ml-auto text-[12.5px] font-medium text-coral-ink">
              Revoke
            </span>
          </div>
        </div>
      </div>
    </Play>
  );
}

export default function SecurityPage() {
  return (
    <PageFrame>
      <PageHeader eyebrow="Security" title="Private by default. Plain about the rest." lede="What protects your account and notes today, stated plainly." />
      <div className={cx(container, "grid gap-(--mk-stack-gap) lg:grid-cols-2")}>
        <Section
          id="account"
          title="Your account"
          lead="A verified email, plus an optional second step."
          items={[
            <>Email verified before you can open Folevi</>,
            <>Two-step codes from an authenticator app (TOTP)</>,
            <>One-time recovery codes, for a lost phone</>,
          ]}
        >
          <CodePicture />
        </Section>
        <div className="grid gap-(--mk-stack-gap)">
          <Section
            id="encryption"
            title="Encryption"
            lead="Encrypted on the way to us, and where it’s stored."
            items={[<>TLS on every connection, with HSTS</>, <>Encrypted at rest by our hosting providers</>]}
          />
          <Section
            id="e2ee"
            title="Not end-to-end encrypted"
            lead="Our servers process your notes, so search, sharing and sync work."
            items={[<>For notes no provider may ever read, use an end-to-end encrypted tool</>]}
          />
        </div>

        <Section
          id="sharing"
          title="Sharing"
          lead="Nothing is public until you make a link."
          items={[<>Give a link an expiry date</>, <>Require a password</>, <>Revoke it, and it stops working at once</>]}
          className="grid items-center gap-8 lg:col-span-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
        >
          <LinkPicture />
        </Section>

        <Section
          id="access"
          title="Who can see your notes"
          lead="You, and the people you share with."
          items={[<>Admin tools have no content viewer</>, <>Sync logs never hold your text, titles or files</>]}
        />
        <Section
          id="export"
          title="Export and deletion"
          lead="Your writing is never locked in."
          items={[
            <>Any page as Markdown, HTML or PDF</>,
            <>Your Personal, or a workspace you own or admin, as a ZIP</>,
            <>Account deletion waits 7 days, then it’s permanent</>,
          ]}
        />
        <Section
          id="web"
          title="This website"
          lead="No third-party scripts, trackers, ad pixels or remote fonts."
          items={[<>A strict Content Security Policy allows only our own code</>, <>Pages can’t be embedded in other sites</>]}
        />

        <Section
          id="disclosure"
          title="Reporting a vulnerability"
          lead={
            <>
              Email{" "}
              <a href={`mailto:${SECURITY_EMAIL}`} className="mk-link">
                {SECURITY_EMAIL}
              </a>{" "}
              with what you found and how to reproduce it.
            </>
          }
          items={[
            <>Test only accounts and workspaces you own or may test</>,
            <>Leave other people’s data alone, and don’t load-test or spam</>,
            <>Give us a fair chance to fix it before going public</>,
          ]}
        />

        <Section id="subprocessors" title="Subprocessors" lead="These companies process data on our behalf to run Folevi." className="lg:col-span-2">
          <div className="mk-prose mt-6 max-w-none">
            <div className="mk-table-card overflow-x-auto" role="region" aria-label="Subprocessors table" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">What it processes</th>
                  </tr>
                </thead>
                <tbody>
                  {subprocessors.map((s) => (
                    <tr key={s.name}>
                      <th scope="row" className="whitespace-nowrap font-semibold text-ink">
                        {s.name}
                      </th>
                      <td className="whitespace-nowrap">{s.role}</td>
                      <td>{s.data}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

      </div>
    </PageFrame>
  );
}
