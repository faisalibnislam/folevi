import Link from "next/link";
import { PlanPicker } from "@/components/marketing/home/PlanPicker";
import { CREDIT_PACKS, CREDIT_PACK_ORDER, GB, MONTHLY_CREDITS, PACK_VALID_MONTHS, PLANS, PLAN_ORDER, PRICES, STORAGE_BYTES, TIER_NAMES, TRIAL_CREDITS, TRIAL_DAYS, TRIAL_TIER, formatPrice, yearlySavingPercent } from "@/lib/plans";
import { JsonLd, faqLd, pageMetadata } from "@/components/marketing/seo";
import { Card, PageFrame } from "@/components/marketing/cards";
import { PageHeader, cx } from "@/components/marketing/ui";

const trialName = TIER_NAMES[TRIAL_TIER];
const gb = (bytes: number) => `${bytes / GB} GB`;
const credits = (n: number) => n.toLocaleString("en-US");

export const metadata = pageMetadata({
  title: `Pricing: a free notes app, with plans from ${formatPrice(PRICES.core.month)}`,
  description: `Folevi is free to start. Core is ${formatPrice(PRICES.core.month)} a month with no AI, Pro is ${formatPrice(PRICES.pro.month)} with ${MONTHLY_CREDITS.pro} AI credits, and Pro AI is ${formatPrice(PRICES.pro_ai.month)} with unlimited AI. Try it free.`,
  path: "/pricing",
});

/** Rough costs of common AI actions, in credits (1 credit is one cent of AI cost). */
const CREDIT_EXAMPLES: Array<{ action: string; cost: string }> = [
  { action: "Rewrite or shorten a paragraph", cost: "about 1 credit" },
  { action: "Ask Foli a question about your notes", cost: "about 2 credits" },
  { action: "Make a flowchart", cost: "3 to 5 credits" },
];

const saving = (tier: "core" | "pro" | "pro_ai") => `${TIER_NAMES[tier]} is ${formatPrice(PRICES[tier].year)} a year instead of ${formatPrice(PRICES[tier].month * 12)} (save ${yearlySavingPercent(tier)}%)`;

// `text` is the plain answer for the FAQPage structured data, where the shown answer has links.
const faqs: Array<{ q: string; a: React.ReactNode; text?: string }> = [
  {
    q: "How does the free trial work?",
    a: `Every new account gets ${trialName} free for ${TRIAL_DAYS} days, with ${TRIAL_CREDITS} AI credits and no card. When the trial ends you move to Free, with ${MONTHLY_CREDITS.free} AI credits a month, unless you choose a plan. Nothing is charged automatically.`,
  },
  {
    q: "What does “Unlimited AI, fair use” mean?",
    a: `${TIER_NAMES.pro_ai} is for people who use AI every day. Fair use means ${credits(MONTHLY_CREDITS.pro_ai)} credits a month for each person, which is about ${credits(Math.floor(MONTHLY_CREDITS.pro_ai / 2))} questions to Foli. If you reach it, buy a credit pack or wait for your credits to reset. There is also an hourly limit that stops automated use.`,
  },
  {
    q: "Why does Core have no AI?",
    a: "Some people want more room and no AI at all. On Core, nothing you write is sent to an AI model: Foli is off in your Personal, and in a Core workspace it’s off for everyone there.",
  },
  {
    q: "When do AI credits reset?",
    a: `Every month. On paid plans, monthly credits reset each billing month, counted from the day your plan started (yearly plans reset monthly too). On Free they reset on the first day of each calendar month (UTC). Unused monthly credits don’t carry over.`,
  },
  {
    q: "Do credit packs expire?",
    a: `Yes, ${PACK_VALID_MONTHS} months after you buy them. Packs are one-time purchases for ${TIER_NAMES.pro} and ${TIER_NAMES.pro_ai}, and their credits are used only after your monthly credits run out.`,
  },
  {
    q: "What happens when I run out of AI credits?",
    a: `AI requests pause until your credits reset. On ${TIER_NAMES.pro} and ${TIER_NAMES.pro_ai} you can buy a credit pack to keep going right away; on Free you can upgrade. Everything else in Folevi keeps working.`,
  },
  {
    q: "How does storage work?",
    a: `Free has ${gb(STORAGE_BYTES.free)} in total, shared by your Personal and every free workspace you own; uploads by anyone in those workspaces count toward it. Paid plans give each person their own room: ${gb(STORAGE_BYTES.core)} on ${TIER_NAMES.core} and ${TIER_NAMES.pro}, ${gb(STORAGE_BYTES.pro_ai)} on ${TIER_NAMES.pro_ai}. In a paid workspace, each member’s uploads count against their own storage there.`,
  },
  {
    q: "What happens if I run out of storage?",
    a: "Your notes and files stay put and you can keep writing. New uploads pause until you free up room or move to a plan with more storage. Nothing is deleted.",
  },
  {
    q: "How are team plans billed?",
    a: "Per member. On a paid team plan the owner, admins and members each take a seat, and each gets the plan’s storage and AI credits in that workspace. A free workspace bills nobody, and its members use their own personal AI credits there.",
  },
  {
    q: "Do guests cost anything?",
    a: "No. Guests are free on every plan. When a guest uses AI, it comes from their own personal plan.",
  },
  {
    q: "Are personal and team plans connected?",
    a: "No. A workspace has its own plan, separate from anyone’s personal plan: a paid personal plan doesn’t upgrade a workspace, and a workspace plan doesn’t change your Personal. Every workspace starts on Free.",
  },
  {
    q: "What counts as a device?",
    a: `Each browser or app you’re signed in to. Free works on ${PLANS.free.devices} devices at a time; ${TIER_NAMES.core}, ${TIER_NAMES.pro} and ${TIER_NAMES.pro_ai} work on as many as you like. At the limit, a new device asks you to sign out of another one (from right there) or upgrade. Nothing is deleted.`,
  },
  {
    q: "Can I switch plans or cancel?",
    a: "Yes, any time from Settings → Plan & billing. If you cancel, your plan keeps working until the end of the period you paid for, then moves to Free.",
  },
  {
    q: "Is yearly cheaper?",
    a: `Yes. ${saving("core")}, ${saving("pro")}, and ${saving("pro_ai")}.`,
  },
  {
    q: "How are taxes and payments handled?",
    a: "Prices are in US dollars. Payments are processed by Polar, our merchant of record, which adds any sales tax or VAT at checkout and sends your receipts.",
  },
  {
    q: "What happens to my notes if I downgrade?",
    a: (
      <>
        They stay yours. You can export any page as Markdown, HTML or PDF, or everything in your Personal as a ZIP (owners and admins can export a whole workspace), at any time. See <Link href="/docs/import-and-export">Import &amp; export</Link>.
      </>
    ),
    text: "They stay yours. You can export any page as Markdown, HTML or PDF, or everything in your Personal as a ZIP (owners and admins can export a whole workspace), at any time.",
  },
  {
    q: "Is the Mac app included?",
    a: (
      <>
        Folevi runs on the web today, on every plan. The Mac app is coming soon, and every plan, including Free, will include it. See <Link href="/mac">Folevi for Mac</Link>.
      </>
    ),
    text: "Folevi runs on the web today, on every plan. The Mac app is coming soon, and every plan, including Free, will include it.",
  },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd data={faqLd("/pricing", faqs.map((f) => ({ q: f.q, a: f.text ?? (typeof f.a === "string" ? f.a : "") })).filter((f) => f.a))} />
      <PageFrame>
        <PageHeader
          eyebrow="Pricing"
          title="Start free. Pay for room, or for AI."
          lede={`Four plans, for you or for your team, on the web with the Mac app coming soon. Try ${trialName} free for ${TRIAL_DAYS} days with ${TRIAL_CREDITS} AI credits, no card needed.`}
        />
          <Card aria-label="Plans">
            <PlanPicker headingLevel="h2" />
            <p className="mt-5 text-[13.5px] text-muted">Prices in US dollars. Any sales tax or VAT is added at checkout.</p>
          </Card>

          <Card aria-labelledby="credits-title">
            <h2 id="credits-title" className="mk-h2">
              AI credits
            </h2>
            <p className="mk-lede mt-3 max-w-[60ch]">AI use is counted in credits. Each plan with AI includes credits every month, and you can buy more on {TIER_NAMES.pro} and {TIER_NAMES.pro_ai}.</p>
            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              <div className="mk-card p-6 sm:p-7">
                <h3 className="text-[16px] font-semibold text-(--color-heading)">What’s an AI credit?</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink">A credit is one cent of what the AI costs us to run. Short requests use about one credit; longer ones use a few. For example:</p>
                <dl className="mt-4 border-y mk-hair text-[14.5px]">
                  {CREDIT_EXAMPLES.map((e, i) => (
                    <div key={e.action} className={cx("flex items-baseline justify-between gap-4 py-2.5", i > 0 && "border-t mk-hair")}>
                      <dt className="text-ink">{e.action}</dt>
                      <dd className="flex-none text-muted">{e.cost}</dd>
                    </div>
                  ))}
                </dl>
                <h4 className="mt-6 text-[14.5px] font-semibold text-(--color-heading)">Credits each month</h4>
                <ul className="mt-2 space-y-1.5 text-[14.5px] text-ink">
                  {PLAN_ORDER.map((tier) => (
                    <li key={tier} className="flex items-baseline justify-between gap-4">
                      <span>{TIER_NAMES[tier]}</span>
                      <span className="text-muted">{MONTHLY_CREDITS[tier] === 0 ? "No AI" : tier === "pro_ai" ? `${credits(MONTHLY_CREDITS[tier])}, fair use` : credits(MONTHLY_CREDITS[tier])}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[13.5px] leading-relaxed text-muted">
                  On team plans, each member gets these credits in the workspace. The {TRIAL_DAYS}-day trial includes {TRIAL_CREDITS} credits.
                </p>
              </div>
              <div className="mk-card flex flex-col p-6 sm:p-7">
                <h3 className="text-[16px] font-semibold text-(--color-heading)">Credit packs</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink">
                  Need more AI than your plan includes? On {TIER_NAMES.pro} and {TIER_NAMES.pro_ai}, buy a pack of credits once, whenever you need it.
                </p>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {CREDIT_PACK_ORDER.map((id) => {
                    const pack = CREDIT_PACKS[id];
                    return (
                      <li key={id} className="rounded-[8px] bg-(--color-surface-sunken) p-4">
                        <p className="text-[14.5px] font-semibold text-(--color-heading)">{credits(pack.credits)} credits</p>
                        <p className="mk-display mt-2 text-[32px] leading-none">{formatPrice(pack.priceCents)}</p>
                        <p className="mt-1.5 text-[13px] text-muted">One-time</p>
                      </li>
                    );
                  })}
                </ul>
                <ul className="mt-5 space-y-1.5 text-[14px] leading-relaxed text-muted">
                  <li>Valid for {PACK_VALID_MONTHS} months from purchase.</li>
                  <li>Used after your monthly credits run out.</li>
                  <li>Not a subscription: nothing renews.</li>
                  <li>On a team plan, a pack adds credits to your own seat in that workspace.</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card aria-labelledby="faq-title" inner="px-5 pt-8 pb-2 sm:px-10 sm:pt-10 sm:pb-4 lg:px-14 lg:pt-12">
            <h2 id="faq-title" className="mk-h2">
              Questions
            </h2>
            <dl className="mk-prose mt-4 max-w-none [&>div]:mt-0">
              {faqs.map((item, index) => (
                <div key={item.q} className={cx("grid gap-2 py-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10", index > 0 && "border-t mk-hair")}>
                  <dt className="text-[16.5px] font-semibold tracking-[-0.012em] text-(--color-heading)">{item.q}</dt>
                  <dd className="text-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
          </Card>
      </PageFrame>
    </>
  );
}
