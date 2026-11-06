import { PlanPicker } from "@/components/marketing/home/PlanPicker";
import {
  CREDIT_PACKS,
  CREDIT_PACK_ORDER,
  MONTHLY_CREDITS,
  PACK_VALID_MONTHS,
  PLANS,
  PLAN_ORDER,
  PRICES,
  STORAGE_BYTES,
  TIER_NAMES,
  TRIAL_CREDITS,
  TRIAL_DAYS,
  TRIAL_TIER,
  formatPrice,
  yearlySavingPercent,
  sizeLabel,
} from "@/lib/plans";
import { pageMetadata, type FaqItem } from "@/components/marketing/seo";
import { APP_STORE_URL, IOS_REQUIREMENT, MAC_DOWNLOAD_URL, MAC_REQUIREMENT } from "@/components/marketing/site";
import { LibraryPlaces } from "@/components/marketing/mac/LibraryPlaces";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { Checks } from "@/components/marketing/Checks";
import { FaqSection } from "@/components/marketing/parts";
import { Play } from "@/components/marketing/Play";
import { Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { CursorPiece, TaskPiece } from "@/components/marketing/pieces";
import { ButtonLink, Eyebrow, cx } from "@/components/marketing/ui";

const trialName = TIER_NAMES[TRIAL_TIER];
const gb = sizeLabel;
const credits = (n: number) => n.toLocaleString("en-US");

export const metadata = pageMetadata({
  title: `Pricing: free apps, and Folevi Cloud from ${formatPrice(PRICES.core.month)} a month`,
  description: `Folevi for Mac, iPhone and iPad is free forever with no account. Folevi Cloud adds the web app, sharing and Foli AI, from ${formatPrice(PRICES.core.month)} a month.`,
  path: "/pricing",
});

/** Rough costs of common AI actions, in credits (1 credit is one cent of AI cost). */
const CREDIT_EXAMPLES: Array<{ action: string; cost: string }> = [
  { action: "Rewrite or shorten a paragraph", cost: "about 1 credit" },
  { action: "Ask Foli AI a question about your notes", cost: "about 2 credits" },
  { action: "Make a flowchart", cost: "3 to 5 credits" },
];

const saving = (tier: "core" | "pro" | "pro_ai") =>
  `${TIER_NAMES[tier]} is ${formatPrice(PRICES[tier].year)} a year instead of ${formatPrice(PRICES[tier].month * 12)} (save ${yearlySavingPercent(tier)}%)`;

// Plain answers: the same text feeds the FAQPage structured data. They open on click.
const faqs: FaqItem[] = [
  {
    q: "Are the apps free?",
    a: `Yes. Folevi for Mac, iPhone and iPad is free forever when you keep notes on your devices, with no account and no limit on notes. The Mac app is a download from folevi.com (${MAC_REQUIREMENT}); the iPhone and iPad app is on the App Store (${IOS_REQUIREMENT}).`,
  },
  {
    q: "Do I need an account?",
    a: "Not for the apps. Choose Keep notes on my devices and your notes are a folder of files in a place you pick: iCloud Drive, Dropbox, Google Drive, any folder, or this device only. Folevi’s servers never see them. You need a Folevi account for the web app and for sharing.",
  },
  {
    q: "What do paid plans add?",
    a: `A Folevi account (free to make) adds the web app, sharing and public pages, comments with others, workspaces, email-in, the web clipper and the API. Paid plans add room and AI credits: ${TIER_NAMES.core} has more storage and no device limit, ${TIER_NAMES.pro} and ${TIER_NAMES.pro_ai} add Foli AI credits every month.`,
  },
  {
    q: "Can I move my notes between the two?",
    a: "Yes. From a library on your devices you can sign in and upload it to your account, and from an account you can export everything into a folder. Your notes are never stuck in one place.",
  },
  {
    q: "How does the free trial work?",
    a: `Every new account gets ${trialName} free for ${TRIAL_DAYS} days, with ${TRIAL_CREDITS} AI credits and no card. When the trial ends you move to Free, which has no AI, unless you choose a plan. Nothing is charged automatically.`,
  },
  {
    q: `How much AI does ${TIER_NAMES.pro_ai} include?`,
    a: `${TIER_NAMES.pro_ai} is for people who use AI every day: ${credits(MONTHLY_CREDITS.pro_ai)} credits a month for each person, which is about ${credits(Math.floor(MONTHLY_CREDITS.pro_ai / 2))} questions to Foli AI. If you reach it, buy a credit pack or wait for your credits to reset. There is also an hourly limit that stops automated use.`,
  },
  {
    q: "Why does Core have no AI?",
    a: "Some people want more room and no AI at all. On Core, nothing you write is sent to an AI model: Foli AI is off in your Personal, and in a Core workspace it’s off for everyone there.",
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
    a: "They stay yours. You can export any page as Markdown, HTML or PDF, or everything in your Personal as a ZIP (owners and admins can export a whole workspace), at any time.",
  },
  {
    q: "Can I use my account in the apps?",
    a: `Yes. Every plan works in the web app and in the Mac, iPhone and iPad apps. On ${TIER_NAMES.free}, an account works on ${PLANS.free.devices} devices at a time.`,
  },
];

export default function PricingPage() {
  const maxCredits = Math.max(...PLAN_ORDER.map((tier) => MONTHLY_CREDITS[tier]));
  return (
    <PageFrame>
      <HeaderCard>
        <Float depth={0.04} className="right-[2%] top-3 max-xl:hidden [--tilt:4deg]">
          <TaskPiece text="Pick a plan" due="Later" />
        </Float>
        <Float depth={0.08} delay={900} className="bottom-[10%] right-[33%] max-xl:hidden">
          <CursorPiece name="You" tone="ink" />
        </Float>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-10 right-[8%] z-10 hidden lg:block">
          <Sticker tone="violet" rotate={7}>
            Cancel any time
          </Sticker>
        </div>
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mk-display mt-5 max-w-[15ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
          <Mark kind="circle">Free</Mark> forever on your devices.
        </h1>
        <p className="mk-lede mt-6 max-w-[60ch]">
          The Mac, iPhone and iPad apps are free, with no account. Folevi Cloud adds the web app, sharing and Foli AI
          when you want them.
        </p>
      </HeaderCard>

      <Card aria-labelledby="apps-title" className="relative">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
          <div className="relative">
            <p className="absolute -top-3 right-0 sm:right-4" aria-hidden="true">
              <Sticker tone="violet" rotate={6}>
                No account
              </Sticker>
            </p>
            <Eyebrow>Folevi for Mac, iPhone and iPad</Eyebrow>
            <h2 id="apps-title" className="mt-4 flex items-baseline gap-3">
              <span className="mk-display text-[56px] leading-none sm:text-[64px]">$0</span>{" "}
              <span className="text-[17px] font-semibold text-(--color-heading)">forever</span>
            </h2>
            <p className="mk-lede mt-4 max-w-[52ch]">
              Choose Keep notes on my devices. Your notes are files in a folder you pick, and Folevi’s servers never see them.
            </p>
            <Checks
              className="mt-6"
              items={[
                <>No account, no limit on notes</>,
                <>iCloud Drive, Dropbox, Google Drive or any folder, synced by your own cloud</>,
                <>Tasks, note themes, Foli DNA and search</>,
                <>Foli AI on your Mac, with Apple Intelligence or your own API key</>,
              ]}
            />
            <p className="mt-6 text-[14px] leading-relaxed text-muted">
              Sharing, public pages, comments with others, workspaces, email-in, the web clipper, the API and AI credits
              need a Folevi account. You can move a library to an account later, or export it back into a folder.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <ButtonLink href={MAC_DOWNLOAD_URL} icon="arrow-down">
                Download for Mac
              </ButtonLink>
              <ButtonLink href={APP_STORE_URL} variant="secondary">
                App Store
              </ButtonLink>
            </div>
            <p className="mt-4 text-[13px] text-muted">
              Mac: {MAC_REQUIREMENT}. iPhone and iPad: {IOS_REQUIREMENT}.
            </p>
          </div>
          <LibraryPlaces className="mx-auto w-full max-w-[420px]" />
        </div>
      </Card>

      <Card aria-labelledby="cloud-title">
        <h2 id="cloud-title" className="mk-h2">
          Folevi <Mark>Cloud</Mark>
        </h2>
        <p className="mk-lede mt-3 mb-8 max-w-[60ch]">
          An account for the web app, sharing and teams. Try {trialName} free for {TRIAL_DAYS} days, with {TRIAL_CREDITS} AI
          credits. No card.
        </p>
        <PlanPicker headingLevel="h3" />
        <p className="mt-5 text-[14px] text-muted">
          Prices in US dollars. Any sales tax or VAT is added at checkout.
        </p>
      </Card>

      <Card tint aria-labelledby="credits-title">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 id="credits-title" className="mk-h2">
            AI <Mark>credits</Mark>
          </h2>
          <div aria-hidden="true" className="relative pb-1 pr-10 max-lg:hidden">
            <Hand rotate={4} arrow="down-right">
              top up when you run low
            </Hand>
          </div>
        </div>
        <p className="mk-lede mt-3 max-w-[60ch]">One credit is one cent of what our AI costs.</p>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="mk-card p-6 sm:p-7">
            <h3 className="text-[16px] font-semibold text-(--color-heading)">
              What’s an AI credit?
            </h3>
            <dl className="mt-4 border-y mk-hair text-[15px]">
              {CREDIT_EXAMPLES.map((e, i) => (
                <div
                  key={e.action}
                  className={cx(
                    "flex items-baseline justify-between gap-4 py-2.5",
                    i > 0 && "border-t mk-hair",
                  )}
                >
                  <dt className="text-ink">{e.action}</dt>
                  <dd className="flex-none text-muted">{e.cost}</dd>
                </div>
              ))}
            </dl>
            <h4 className="mt-6 text-[15px] font-semibold text-(--color-heading)">
              Credits each month
            </h4>
            <Play className="mt-3">
              <ul className="space-y-2.5 text-[15px] text-ink">
                {PLAN_ORDER.map((tier) => {
                  const n = MONTHLY_CREDITS[tier];
                  return (
                    <li
                      key={tier}
                      data-step
                      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3"
                    >
                      <span>{TIER_NAMES[tier]}</span>
                      <span
                        aria-hidden="true"
                        className="h-2 rounded-tiny bg-(--color-surface-sunken)"
                      >
                        <span
                          className="block h-full rounded-tiny bg-(--color-heading)"
                          style={{ width: `${(n / maxCredits) * 100}%` }}
                        />
                      </span>
                      <span className="text-muted">
                        {n === 0
                          ? "No AI"
                          : tier === "pro_ai"
                            ? `${credits(n)}, fair use`
                            : credits(n)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Play>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              On team plans, each member gets these credits in the workspace.
            </p>
          </div>
          <div className="mk-card flex flex-col p-6 sm:p-7">
            <h3 className="text-[16px] font-semibold text-(--color-heading)">Credit packs</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink">
              More AI when you need it, on {TIER_NAMES.pro} and {TIER_NAMES.pro_ai}.
            </p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {CREDIT_PACK_ORDER.map((id) => {
                const pack = CREDIT_PACKS[id];
                return (
                  <li key={id} className="rounded-control bg-(--color-surface-sunken) p-4">
                    <p className="text-[15px] font-semibold text-(--color-heading)">
                      {credits(pack.credits)} credits
                    </p>
                    <p className="mk-display mt-2 text-[32px] leading-none">
                      {formatPrice(pack.priceCents)}
                    </p>
                    <p className="mt-1.5 text-[13px] text-muted">One-time</p>
                  </li>
                );
              })}
            </ul>
            <Checks
              size="sm"
              className="mt-5"
              items={[
                <>Valid for {PACK_VALID_MONTHS} months from purchase.</>,
                <>Used once your monthly credits run out</>,
                <>On a team plan, it adds credits to your own seat</>,
              ]}
            />
          </div>
        </div>
      </Card>

      <FaqSection faqs={faqs} path="/pricing" collapsed />
    </PageFrame>
  );
}
