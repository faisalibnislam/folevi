import { PLANS, PLAN_ORDER, TRIAL_DAYS, WORKSPACE_PLANS, WORKSPACE_PLAN_ORDER, formatPrice, isPaidPlan } from "@/lib/plans";
import Link from "next/link";
import { Check } from "lucide-react";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "../icons";
import { SIGN_UP_URL } from "../site";
import { ButtonLink, SectionHeading, container, cx } from "../ui";

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

export function SecuritySection() {
  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-20 border-t mk-hair py-16 sm:py-24">
      <div className={container}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <SectionHeading
              id="security-title"
              eyebrow="Privacy and security"
              title="Private by default. Plain about the rest."
              lede="Your notes are yours. Here is what protects them, and one thing Folevi does not do."
            />
            <div className="mk-panel mt-8 p-5 sm:p-6">
              <p className="flex items-center gap-2.5 text-[15px] font-semibold text-(--color-heading)">
                <Icon name="shield" size={17} />
                Folevi is not end-to-end encrypted
              </p>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink">
                Our servers can process your content so that search, sharing, sync and support can work. What we don’t
                have is a way to browse it: the admin tools have no content viewer, so staff cannot open your notes from
                there.
              </p>
            </div>
            <Link href="/security" className="mk-link mt-6 inline-flex min-h-11 items-center gap-2 text-[15px]">
              Read the full security overview <Icon name="arrow-right" size={16} />
            </Link>
          </div>
          <ul className="grid gap-x-10 gap-y-9 self-start sm:grid-cols-2">
            {SECURITY_CONTROLS.map((control) => (
              <li key={control.title}>
                <span className="mk-tile">
                  <Icon name={control.icon} size={17} />
                </span>
                <h3 className="mk-h3 mt-3.5 text-[15.5px]">{control.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{control.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 flex-1 space-y-2.5 border-t mk-hair pt-5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink">
          <Check size={16} aria-hidden="true" className="mt-px flex-none text-(--color-heading)" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** The three Personal plans side by side (marketing home and /pricing). Prices come from lib/plans. */
export function PricingCard({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id];
        // The plan with AI is the one highlighted (and the one the trial gives).
        const pro = plan.ai;
        const paid = isPaidPlan(plan.monthly);
        return (
          <div
            key={id}
            className={cx(
              "mk-card flex flex-col p-6 sm:p-7",
              pro && "shadow-[var(--shadow-card),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_22%,transparent)]",
            )}
          >
            <div className="flex min-h-7 items-center gap-2">
              <Heading className="text-[16px] font-semibold text-(--color-heading)">{plan.name}</Heading>
              {pro ? <span className="mk-chip ml-auto">{TRIAL_DAYS}-day free trial</span> : null}
            </div>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="mk-display text-[48px] leading-none">{formatPrice(plan.monthlyCents)}</span>
              <span className="text-[14.5px] text-muted">/ month</span>
            </p>
            <p className="mt-2 min-h-[22px] text-[13.5px] text-muted">{!paid ? "No card required" : `or ${formatPrice(plan.yearlyCents)} a year`}</p>
            <p className="mt-4 text-[14.5px] leading-relaxed text-ink">{plan.blurb}</p>
            <FeatureList items={plan.features} />
            <ButtonLink href={SIGN_UP_URL} className="mt-7 w-full" icon="arrow-right" size="lg" variant={pro ? undefined : "secondary"}>
              {!paid ? "Start free" : pro ? `Try ${plan.name} free for ${TRIAL_DAYS} days` : `Start with ${plan.name}`}
            </ButtonLink>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Workspace plans (the /pricing page). Each workspace has its own plan, separate from anyone's Personal
 * plan; paid plans are per member. Only what exists is listed, and plans that can't be bought yet say so.
 */
export function WorkspacePlans({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {WORKSPACE_PLAN_ORDER.map((id) => {
        const plan = WORKSPACE_PLANS[id];
        return (
          <div key={id} className="mk-card flex flex-col p-6 sm:p-7">
            <div className="flex min-h-7 items-center gap-2">
              <Heading className="text-[16px] font-semibold text-(--color-heading)">{plan.name}</Heading>
              {!plan.available ? <span className="mk-chip ml-auto">Coming soon</span> : null}
            </div>
            <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
              <span className="mk-display text-[40px] leading-none">{formatPrice(plan.monthlyCents)}</span>
              <span className="text-[14.5px] text-muted">{plan.perSeat ? "per member / month" : "/ month"}</span>
            </p>
            <p className="mt-2 min-h-[22px] text-[13.5px] text-muted">{plan.perSeat ? `or ${formatPrice(plan.yearlyCents)} per member / year` : "No card required"}</p>
            <p className="mt-4 text-[14.5px] leading-relaxed text-ink">{plan.blurb}</p>
            <FeatureList items={plan.features} />
          </div>
        );
      })}
    </div>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t mk-hair py-16 sm:py-24">
      <div className={cx(container, "max-w-[1120px]")}>
        <SectionHeading
          align="center"
          id="pricing-title"
          eyebrow="Pricing"
          title="Start free. Upgrade when you need room or AI."
          lede={`Every new account gets Pro free for ${TRIAL_DAYS} days. Every plan works on the web, and will include the Mac app when it arrives.`}
        />
        <div className="mt-12">
          <PricingCard />
        </div>
        <p className="mt-6 text-center text-[14px] text-muted">
          Workspaces for teams have their own plans.{" "}
          <Link href="/pricing" className="mk-link">
            See all pricing
          </Link>
        </p>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="pb-12 pt-4 sm:pb-20">
      <div className={container}>
        <div className="mk-panel px-6 py-16 text-center sm:px-10 sm:py-24">
          <FoleviMark size={48} className="mx-auto block" />
          <h2 id="cta-title" className="mk-display mx-auto mt-7 max-w-[16ch] text-[38px] sm:text-[56px]">
            Start with one note.
          </h2>
          <p className="mk-lede mx-auto mt-5 max-w-[46ch]">
            The Free plan has no time limit, and you can export your notes to Markdown, HTML or PDF at any time.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-2.5">
            <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
              Start writing
            </ButtonLink>
            <ButtonLink href="/docs" variant="secondary" size="lg">
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
