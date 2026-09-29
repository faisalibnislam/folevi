import Link from "next/link";
import { PricingCard, WorkspacePlans } from "@/components/marketing/home/Closing";
import { PLANS, TRIAL_DAYS, formatPrice } from "@/lib/plans";
import { pageMetadata } from "@/components/marketing/seo";
import { PageHeader, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Pricing",
  description: `Folevi is free to start, with 1 GB of personal storage on 2 devices. Basic adds 20 GB for ${formatPrice(PLANS.basic.monthlyCents)} a month; Pro adds unlimited AI and 100 GB for ${formatPrice(PLANS.pro.monthlyCents)} a month. Every new account gets Pro free for ${TRIAL_DAYS} days.`,
  path: "/pricing",
});

const faqs: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "How does the free trial work?",
    a: `Every new account gets Pro — AI included — free for ${TRIAL_DAYS} days, with no card. When the trial ends you stay on Free unless you choose a plan; nothing is charged automatically.`,
  },
  {
    q: "What counts toward storage?",
    a: "Your personal plan’s storage holds the files, images and attachments in your Personal. Each team workspace has its own storage from its own workspace plan, so uploads there never use your personal storage — and your personal plan never changes a workspace’s.",
  },
  {
    q: "What counts as a device?",
    a: `Each browser or app you're signed in to — say, the browser on your laptop and the one on your work computer. Free works on ${PLANS.free.devices} devices at a time; Basic and Pro work on as many as you like. At the limit, a new device asks you to sign out of another one (from right there) or upgrade. Nothing is deleted.`,
  },
  {
    q: "What happens if I run out of storage?",
    a: "Your notes and files stay put and you can keep writing. New uploads pause until you free up room or move to a plan with more storage. Nothing is deleted.",
  },
  {
    q: "Can I switch plans or cancel?",
    a: "Yes, any time from Settings → Plan & billing. If you cancel, your plan keeps working until the end of the period you paid for, then your account moves to Free.",
  },
  {
    q: "Is yearly cheaper?",
    a: `Yes. Basic is ${formatPrice(PLANS.basic.yearlyCents)} a year instead of ${formatPrice(PLANS.basic.monthlyCents * 12)}, and Pro is ${formatPrice(PLANS.pro.yearlyCents)} a year instead of ${formatPrice(PLANS.pro.monthlyCents * 12)}.`,
  },
  {
    q: "What happens to my notes if I downgrade?",
    a: (
      <>
        They stay yours. You can export any page as Markdown, HTML or PDF, or everything in your Personal as a ZIP (owners and admins can export a whole workspace), at any time —
        see <Link href="/docs#import-export">Import &amp; export</Link>.
      </>
    ),
  },
  {
    q: "How do workspace plans work?",
    a: "A workspace has its own plan, separate from anyone’s personal plan: a Pro personal plan doesn’t upgrade a workspace, and a workspace plan doesn’t change your Personal. Every workspace starts on Free. Team and Business are billed per member seat — the owner, admins and members each take one; guests and pending invitations are free — and aren’t on sale yet.",
  },
  {
    q: "Is the Mac app included?",
    a: (
      <>
        Folevi runs on the web today, on every plan. The Mac app is coming soon, and every plan, including Free, will include it. See <Link href="/mac">Folevi for Mac</Link>.
      </>
    ),
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader eyebrow="Pricing" title="Start free. Pay for room, or for AI." lede={`Three simple personal plans, on the web, with the Mac app coming soon. Try Pro free for ${TRIAL_DAYS} days — no card.`} />
      <div className={cx(container, "max-w-[1080px] pb-20 pt-4 sm:pb-28")}>
        <section aria-label="Personal plans">
          <PricingCard headingLevel="h2" />
        </section>
        <section aria-labelledby="workspaces-title" className="mt-20">
          <h2 id="workspaces-title" className="mk-h2">
            Workspaces
          </h2>
          <p className="mk-lede mt-3 max-w-[60ch]">A workspace has its own plan, storage and AI, separate from your personal plan. Team and Business are coming soon.</p>
          <div className="mt-8">
            <WorkspacePlans headingLevel="h3" />
          </div>
        </section>
        <section aria-labelledby="faq-title" className="mt-20">
          <h2 id="faq-title" className="mk-h2">
            Questions
          </h2>
          <dl className="mk-prose mk-card mt-8 max-w-none rounded-[24px] px-6 sm:px-8">
            {faqs.map((item, index) => (
              <div key={item.q} className={cx("grid gap-2 py-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10", index > 0 && "border-t mk-hair")}>
                <dt className="text-[17px] font-semibold tracking-[-0.012em] text-(--color-heading)">{item.q}</dt>
                <dd className="text-muted">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
