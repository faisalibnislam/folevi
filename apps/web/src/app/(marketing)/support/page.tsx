import Link from "next/link";
import { SupportForm } from "@/components/support/SupportForm";
import { FaqSection } from "@/components/marketing/parts";
import { pageMetadata, type FaqItem } from "@/components/marketing/seo";
import { SECURITY_EMAIL, SUPPORT_EMAIL, WEB_APP_URL } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";
import { Float, Hand, Mark } from "@/components/marketing/fun";
import { MentionPiece } from "@/components/marketing/pieces";
import { MONTHLY_CREDITS, PLANS, TRIAL_CREDITS, TRIAL_DAYS, formatPrice, sizeLabel } from "@/lib/plans";
import { HeaderCard, PageFrame } from "@/components/marketing/cards";

export const metadata = pageMetadata({
  title: "Folevi support: contact us and quick answers",
  description:
    "Contact Folevi support, or find quick answers about your account, sync, plans and billing, two-step verification, export and deleting your account.",
  path: "/support",
});

// Every answer states what the product does today (see /docs, /pricing and /security). The same text
// feeds the FAQPage structured data, so answers are plain sentences. They open on click.
const faqs: FaqItem[] = [
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
  },
  {
    q: "A page says Conflict. What happened?",
    a: "The same block was changed in two places before they could sync. Folevi keeps both versions, throws nothing away, and shows you the conflict so you can choose.",
  },
  {
    q: "What do the plans cost?",
    a: `Free includes ${sizeLabel(PLANS.free.storageBytes)} of storage and ${PLANS.free.devices} devices, with Foli AI during the trial. Core is ${formatPrice(PLANS.core.monthlyCents)} a month (or ${formatPrice(PLANS.core.yearlyCents)} a year) with ${sizeLabel(PLANS.core.storageBytes)} and no AI. Pro is ${formatPrice(PLANS.pro.monthlyCents)} a month (or ${formatPrice(PLANS.pro.yearlyCents)} a year) with ${sizeLabel(PLANS.pro.storageBytes)} and ${MONTHLY_CREDITS.pro} AI credits a month. Pro AI is ${formatPrice(PLANS.pro_ai.monthlyCents)} a month (or ${formatPrice(PLANS.pro_ai.yearlyCents)} a year) with ${sizeLabel(PLANS.pro_ai.storageBytes)} and unlimited AI, fair use. Team plans cost the same per member. Every new account gets Pro AI free for ${TRIAL_DAYS} days, with ${TRIAL_CREDITS} AI credits and no card; after that you stay on Free unless you choose a plan.`,
  },
  {
    q: "How do I change or cancel my plan?",
    a: "Open Settings → Plan & billing. If you cancel, your plan keeps working until the end of the period you paid for, then your account moves to Free. Your notes and files stay put.",
  },
  {
    q: "How do I export my notes?",
    a: "Export any page as Markdown, HTML or PDF, or download everything in your Personal as a ZIP archive. Owners and admins can export a whole workspace.",
  },
  {
    q: "How do I share a page?",
    a: "Use the page’s Share menu. You can invite people by email to view, comment or edit, or create a public link. A link can expire, require a password, and be revoked at any time.",
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
  },
];

const elsewhere: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Email",
    body: (
      <a className="mk-link" href={`mailto:${SUPPORT_EMAIL}`}>
        {SUPPORT_EMAIL}
      </a>
    ),
  },
  {
    title: "Signed in?",
    body: (
      <>
        Ask from Help in the app, linked to your account.{" "}
        <a className="mk-link" href={`${WEB_APP_URL}/help`}>
          Open Help
        </a>
      </>
    ),
  },
  {
    title: "Documentation",
    body: (
      <Link className="mk-link" href="/docs">
        Read the docs
      </Link>
    ),
  },
  {
    title: "Status",
    body: (
      <Link className="mk-link" href="/status">
        Check status
      </Link>
    ),
  },
  {
    title: "Security reports",
    body: (
      <a className="mk-link" href={`mailto:${SECURITY_EMAIL}`}>
        {SECURITY_EMAIL}
      </a>
    ),
  },
];

export default function SupportPage() {
  return (
    <PageFrame>
      <HeaderCard>
        <Float depth={0.08} className="bottom-[18%] right-[24%] max-xl:hidden [--tilt:-3deg]">
          <MentionPiece name="Folevi" />
        </Float>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-12 right-[8%] z-10 hidden lg:block">
          <Hand rotate={-5} arrow="up-left">
            real people, promise
          </Hand>
        </div>
        <Eyebrow>Support</Eyebrow>
        <h1 className="mk-display mt-5 max-w-[15ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
          How can we <Mark kind="circle">help?</Mark>
        </h1>
        <p className="mk-lede mt-6 max-w-[60ch]">A person on the Folevi team replies by email.</p>
      </HeaderCard>
      <div className={cx(container, "grid gap-(--mk-stack-gap) lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]")}>
        <section aria-labelledby="contact-title" className="mk-box relative px-5 py-8 sm:p-8 lg:p-10">
          <h2 id="contact-title" className="mk-display text-[30px] leading-[1.05] sm:text-[36px]">
            Contact <Mark>support</Mark>
          </h2>
          <p className="mt-1.5 text-[15px] text-muted">We’ll confirm by email with a request number.</p>
          <div className="mt-6">
            <SupportForm variant="site" />
          </div>
        </section>

        <aside aria-labelledby="elsewhere-title" className="mk-box self-start px-5 py-8 sm:p-8">
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

      <FaqSection title="Common questions" faqs={faqs} path="/support" collapsed />
    </PageFrame>
  );
}
