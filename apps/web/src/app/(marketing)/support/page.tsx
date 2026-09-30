import Link from "next/link";
import { SupportForm } from "@/components/support/SupportForm";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL, SUPPORT_EMAIL, WEB_APP_URL, absoluteUrl } from "@/components/marketing/site";
import { PageHeader, container, cx } from "@/components/marketing/ui";
import { MONTHLY_CREDITS, PLANS, TRIAL_CREDITS, TRIAL_DAYS, formatPrice } from "@/lib/plans";

export const metadata = pageMetadata({
  title: "Support",
  description:
    "Contact Folevi support, or find quick answers about your account, sync and offline editing, plans and billing, two-step verification, exporting your notes, sharing and deleting your account.",
  path: "/support",
});

type Faq = { q: string; a: string; link?: { label: string; href: string } };

// Every answer states what the product does today (see /docs, /pricing and /security). The same text
// feeds the FAQPage structured data, so answers are plain sentences.
const faqs: Faq[] = [
  {
    q: "I didn’t get the confirmation email.",
    a: "Check your spam or junk folder first. The confirmation link expires after 24 hours and works once. On the “Check your inbox” screen you can send a new link to the same address.",
  },
  {
    q: "How do I reset my password?",
    a: "Choose “Forgot your password?” on the sign-in page and enter your account’s address. The reset link expires after an hour and works once. If you didn’t ask for it, ignore the email and your password keeps working.",
  },
  {
    q: "I lost the phone with my authenticator app.",
    a: "When you sign in, choose “Use a backup code instead” and enter one of the backup codes you saved when you turned on two-step verification. Each code works once. Then, in Settings → Security, turn two-step verification off and on again with your new phone. If you have no backup codes left, write to us from the address on your account.",
  },
  {
    q: "Does Folevi work offline?",
    a: "Yes. Every change is saved on your device first, then synced. With no connection the page shows Offline and counts the edits waiting on this device; they sync when you reconnect. Saved means everything has reached our servers.",
    link: { label: "Sync & offline in the docs", href: "/docs/sync-and-offline" },
  },
  {
    q: "A page says Conflict. What happened?",
    a: "The same block was changed in two places before they could sync. Folevi keeps both versions, throws nothing away, and shows you the conflict so you can choose.",
  },
  {
    q: "What do the plans cost?",
    a: `Free includes 1 GB of storage, ${MONTHLY_CREDITS.free} AI credits a month and ${PLANS.free.devices} devices. Core is ${formatPrice(PLANS.core.monthlyCents)} a month (or ${formatPrice(PLANS.core.yearlyCents)} a year) with 20 GB and no AI. Pro is ${formatPrice(PLANS.pro.monthlyCents)} a month (or ${formatPrice(PLANS.pro.yearlyCents)} a year) with 20 GB and ${MONTHLY_CREDITS.pro} AI credits a month. Pro AI is ${formatPrice(PLANS.pro_ai.monthlyCents)} a month (or ${formatPrice(PLANS.pro_ai.yearlyCents)} a year) with 50 GB and unlimited AI, fair use. Team plans cost the same per member. Every new account gets Pro AI free for ${TRIAL_DAYS} days, with ${TRIAL_CREDITS} AI credits and no card; after that you stay on Free unless you choose a plan.`,
    link: { label: "See pricing", href: "/pricing" },
  },
  {
    q: "How do I change or cancel my plan?",
    a: "Open Settings → Plan & billing. If you cancel, your plan keeps working until the end of the period you paid for, then your account moves to Free. Your notes and files stay put.",
  },
  {
    q: "How do I export my notes?",
    a: "Export any page as Markdown, HTML or PDF, or download everything in your Personal as a ZIP archive. Owners and admins can export a whole workspace.",
    link: { label: "Import & export in the docs", href: "/docs/import-and-export" },
  },
  {
    q: "How do I share a page?",
    a: "Use the page’s Share menu. You can invite people by email to view, comment or edit, or create a public link. A link can expire, require a password, and be revoked at any time.",
    link: { label: "Sharing & permissions in the docs", href: "/docs/sharing-and-permissions" },
  },
  {
    q: "How do I delete my account?",
    a: "Open Settings → Security → Delete account. Deletion waits 7 days in case it was a mistake, and you can cancel by signing in. If you own a workspace other people use, transfer it or delete it first. After the 7 days, your account, your Personal and any workspace only you use are deleted permanently.",
  },
  {
    q: "Can I change the email address on my account?",
    a: "Not from the app yet. Write to us from the address currently on your account and tell us the new one.",
  },
  {
    q: "Can Folevi support read my notes?",
    a: "No. Our admin tools have no way to open your pages, blocks, comments or files, so please don’t paste private notes into a support request unless you want us to see them.",
    link: { label: "Who can see your notes", href: "/security#access" },
  },
];

function faqLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: absoluteUrl("/support"),
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

const elsewhere: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Email",
    body: (
      <>
        Write to <a className="mk-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. It lands in the same place as this form.
      </>
    ),
  },
  {
    title: "Signed in?",
    body: (
      <>
        Use <strong className="font-semibold text-(--color-heading)">Contact support</strong> in the app’s Help page, so your request is linked to your account and our replies show up there too. <a className="mk-link" href={`${WEB_APP_URL}/help`}>Open Help</a>
      </>
    ),
  },
  {
    title: "Documentation",
    body: (
      <>
        How Folevi works, from shortcuts to sync. <Link className="mk-link" href="/docs">Read the docs</Link>
      </>
    ),
  },
  {
    title: "Status",
    body: (
      <>
        What the sync status on a page means, and how to tell if something is wrong. <Link className="mk-link" href="/status">Check status</Link>
      </>
    ),
  },
  {
    title: "Security reports",
    body: (
      <>
        Found a vulnerability? Email <a className="mk-link" href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>. More on the <Link className="mk-link" href="/security">Security</Link> page.
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <>
      <JsonLd data={faqLd()} />
      <PageHeader
        eyebrow="Support"
        title="How can we help?"
        lede={
          <>
            Send us a message and a person on the Folevi team will reply by email. Many questions are answered below, and the <Link className="mk-link" href="/docs">documentation</Link> covers the rest.
          </>
        }
      />
      <div className={cx(container, "pb-20 sm:pb-28")}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-14">
          <section aria-labelledby="contact-title" className="mk-card relative p-6 sm:p-8">
            <h2 id="contact-title" className="mk-h3 text-[22px]">
              Contact support
            </h2>
            <p className="mt-1.5 text-[15px] text-muted">We’ll confirm by email with a request number. Reply to that email to add details.</p>
            <div className="mt-6">
              <SupportForm variant="site" />
            </div>
          </section>

          <aside aria-labelledby="elsewhere-title">
            <h2 id="elsewhere-title" className="mk-caps">
              Other ways to get help
            </h2>
            <ul className="mt-4 space-y-5">
              {elsewhere.map((item) => (
                <li key={item.title} className="border-t mk-hair pt-5 first:border-t-0 first:pt-0">
                  <h3 className="text-[16px] font-semibold tracking-[-0.012em] text-(--color-heading)">{item.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <section aria-labelledby="faq-title" className="mt-20">
          <h2 id="faq-title" className="mk-h2">
            Common questions
          </h2>
          <dl className="mk-prose mk-card mt-8 max-w-none px-6 sm:px-8 [&>div]:mt-0">
            {faqs.map((item, index) => (
              <div key={item.q} className={cx("grid gap-2 py-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10", index > 0 && "border-t mk-hair")}>
                <dt className="text-[16.5px] font-semibold tracking-[-0.012em] text-(--color-heading)">{item.q}</dt>
                <dd className="text-muted">
                  {item.a}
                  {item.link ? (
                    <>
                      {" "}
                      <Link href={item.link.href}>{item.link.label}</Link>
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
