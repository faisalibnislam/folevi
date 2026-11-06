import { PLANS, PLAN_ORDER, TRIAL_DAYS, TRIAL_TIER, TIER_NAMES, formatPrice } from "@/lib/plans";
import { AiIcon } from "@/components/ai/AiIcon";
import Link from "next/link";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "../icons";
import { APP_STORE_URL, MAC_DOWNLOAD_URL, WEB_APP_URL } from "../site";
import { ButtonLink, SectionHeading, box, container, cx } from "../ui";
import { Float, Mark, Sticker } from "../fun";
import { AiPiece, TaskPiece } from "../pieces";

export const SECURITY_CONTROLS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "mail",
    title: "Verified email first",
    body: "You confirm your email address before you can open Folevi.",
  },
  {
    icon: "key",
    title: "Two-step verification",
    body: "Add an authenticator app (TOTP) as a second step whenever you like, with one-time recovery codes for emergencies.",
  },
  {
    icon: "lock",
    title: "Encrypted in transit and at rest",
    body: "Connections use TLS with HSTS. Stored data is encrypted at rest by our hosting providers.",
  },
  {
    icon: "eye-off",
    title: "Private by default",
    body: "Public links are off until you create one. Links can expire, can require a password, and can be revoked instantly.",
  },
  {
    icon: "export",
    title: "Take everything with you",
    body: "Export any page as Markdown, HTML or PDF, or everything in your Personal or a workspace as a ZIP.",
  },
  {
    icon: "trash",
    title: "Leave cleanly",
    body: "Delete your account whenever you like. After a 7-day grace period, it’s deleted permanently.",
  },
];

/** The plans the home page singles out: Core for no AI at all, Pro AI for as much AI as you need. */
const BADGES: Partial<Record<(typeof PLAN_ORDER)[number], string>> = {
  core: "No AI",
  pro_ai: "Most AI",
};

/**
 * The four personal plans, kept short on the home page: name, monthly price and the plan's own one-line
 * blurb, all from lib/plans. Team plans, yearly prices and credit packs are on /pricing.
 */
export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={cx(container, "scroll-mt-20")}>
      <div className={cx(box, "mk-dark")}>
        <SectionHeading
          align="center"
          id="pricing-title"
          eyebrow="Pricing"
          title={
            <>
              Free on your devices. <Mark>Cloud</Mark> when you want it.
            </>
          }
          lede={`The apps cost nothing with no account. Folevi Cloud adds the web app, sharing and Foli AI, and every new account gets ${TIER_NAMES[TRIAL_TIER]} free for ${TRIAL_DAYS} days, no card.`}
        />
        <div className="mk-card mt-10 flex flex-col gap-5 p-6 sm:p-7 lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-[16px] font-semibold text-(--color-heading)">Folevi apps, on your devices</h3>
              <Sticker shine tone="violet" rotate={-4} className="text-[12px]">
                No account
              </Sticker>
            </div>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
              <span className="mk-display text-[36px] leading-none">{formatPrice(0)}</span>
              <span className="text-[14px] text-muted">forever</span>
            </p>
            <p className="mt-3 max-w-[60ch] text-[15px] leading-snug text-muted">
              Mac, iPhone and iPad. Unlimited notes in iCloud Drive, Dropbox, Google Drive or any folder, offline, with Foli AI on your Mac.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink href={MAC_DOWNLOAD_URL} icon="arrow-down">
              Download for Mac
            </ButtonLink>
            <ButtonLink href={APP_STORE_URL} variant="secondary">
              App Store
            </ButtonLink>
          </div>
        </div>
        <div className="mt-10 text-center">
          <p className="mk-eyebrow">Folevi Cloud</p>
        </div>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_ORDER.map((tier) => {
            const plan = PLANS[tier];
            const badge = BADGES[tier];
            return (
              <li
                key={tier}
                className={cx(
                  "mk-card flex flex-col p-6",
                  badge &&
                    "shadow-[var(--shadow-card),inset_0_0_0_1.5px_var(--mk-violet)]",
                )}
              >
                <div className="flex min-h-7 items-center gap-2">
                  <h3 className="flex items-center gap-1.5 text-[16px] font-semibold text-(--color-heading)">
                    {/* The plans with Foli AI carry its flower. */}
                    {tier === "pro" || tier === "pro_ai" ? <AiIcon size={16} /> : null}
                    {plan.name}
                  </h3>
                  {badge ? (
                    <Sticker shine tone="violet" rotate={tier === "pro_ai" ? 6 : -6} className="-my-1 ml-auto text-[12px]">
                      {badge}
                    </Sticker>
                  ) : null}
                </div>
                <p className="mt-4 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="mk-display text-[36px] leading-none">
                    {formatPrice(tier === "free" ? 0 : plan.monthlyCents)}
                  </span>
                  {tier === "free" ? null : <span className="text-[14px] text-muted">/ month</span>}
                </p>
                <p className="mt-3 text-[15px] leading-snug text-muted">{plan.blurb}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-center text-[15px]">
          <Link href="/pricing" className="mk-link inline-flex min-h-11 items-center gap-1.5">
            Team plans and all pricing <Icon name="arrow-right" size={15} />
          </Link>
        </p>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className={container}>
      <div className="mk-box mk-tint relative overflow-hidden px-6 py-20 text-center sm:px-10 sm:py-28">
        <Float depth={0.06} className="left-[5%] top-10 hidden xl:block [--tilt:-5deg]">
          <TaskPiece text="Write the first note" done />
        </Float>
        <Float depth={0.06} delay={300} className="right-[4%] top-10 hidden xl:block [--tilt:4deg]">
          <AiPiece text="Welcome in. Ask me anything about your notes." />
        </Float>
        <FoleviMark size={48} className="mx-auto block" />
        <h2
          id="cta-title"
          className="mk-display relative mx-auto mt-7 max-w-[16ch] text-[44px] sm:text-[72px]"
        >
          Start with one <Mark kind="circle">note</Mark>.
        </h2>
        <p className="mk-lede mx-auto mt-5 max-w-[46ch]">Free forever on your Mac, iPhone and iPad. No account.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-2.5">
          <ButtonLink href={MAC_DOWNLOAD_URL} icon="arrow-down" size="lg">
            Download for Mac
          </ButtonLink>
          <ButtonLink href={APP_STORE_URL} icon="arrow-right" size="lg">
            Get it on the App Store
          </ButtonLink>
          <ButtonLink href={WEB_APP_URL} variant="secondary" size="lg">
            Open the web app
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
