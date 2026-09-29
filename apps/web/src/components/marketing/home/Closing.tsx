import { PLANS, PLAN_ORDER, formatPrice } from "@/lib/plans";
import Link from "next/link";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "../icons";
import { SIGN_UP_URL } from "../site";
import { Bubbles, ButtonLink, SectionHeading, container, cx, type BubbleSpec } from "../ui";

export const SECURITY_CONTROLS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "mail",
    title: "Verified email first",
    body: "You confirm your email address before you can open a workspace.",
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
    body: "Export any page as Markdown, HTML or PDF, or your whole workspace as a ZIP.",
  },
  {
    icon: "trash",
    title: "Leave cleanly",
    body: "Delete your account whenever you like. After a 7-day grace period, it’s deleted permanently.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-24 py-16 sm:py-24">
      <div className={container}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <div>
            <SectionHeading
              id="security-title"
              eyebrow="Privacy & security"
              title="Private by default. Plain about the rest."
              lede="Your notes are yours. Here is exactly what protects them — and one thing Folevi deliberately doesn’t do."
            />
            <div className="mk-tone--marigold mt-8 rounded-[22px] bg-(--color-marigold-soft) p-5 shadow-[inset_0_1px_0_var(--mk-rim),0_0_0_1px_color-mix(in_oklab,var(--color-marigold-ink)_14%,transparent)] sm:p-6">
              <p className="flex items-center gap-2.5 text-[15px] font-semibold text-(--color-marigold-ink)">
                <Icon name="shield" size={18} />
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
          <ul className="grid gap-4 self-start sm:grid-cols-2">
            {SECURITY_CONTROLS.map((control) => (
              <li key={control.title} className="mk-card p-5 sm:p-6">
                <span className="mk-tile">
                  <Icon name={control.icon} size={20} />
                </span>
                <h3 className="mk-h3 mt-4 text-[16.5px]">{control.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{control.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The three plans side by side (marketing home and /pricing). Prices come from lib/plans. */
export function PricingCard({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id];
        const pro = id === "pro";
        return (
          <div key={id} className={cx("mk-panel flex flex-col overflow-hidden p-7", pro && "mk-wash--soft")}>
            <div className="flex items-center gap-2">
              <Heading className="mk-chip mk-chip--raised w-fit">
                <span aria-hidden="true" className="mk-dot" />
                {plan.name}
              </Heading>
              {pro ? <span className="ml-auto text-[12.5px] font-semibold text-(--color-heading)">7-day free trial</span> : null}
            </div>
            <p className="mt-6">
              <span className="mk-display text-[56px] leading-none">{formatPrice(plan.monthlyCents)}</span>
              <span className="text-[15px] text-muted"> / month</span>
            </p>
            <p className="mt-2 min-h-[22px] text-[14px] text-muted">{id === "free" ? "No card required" : `or ${formatPrice(plan.yearlyCents)} a year`}</p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink">{plan.blurb}</p>
            <ul className="mt-5 flex-1 space-y-3">
              {plan.features.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] leading-snug text-ink">
                  <span aria-hidden="true" className="mk-tone--moss mt-[-1px] flex size-[22px] shrink-0 items-center justify-center rounded-full bg-(--color-moss-soft) text-(--color-moss-ink) shadow-[inset_0_1px_0_var(--mk-rim)]">
                    <Icon name="check" size={13} strokeWidth={2.2} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <ButtonLink href={SIGN_UP_URL} className="mt-8 w-full" icon="arrow-right" size="lg" variant={pro ? undefined : "secondary"}>
              {id === "free" ? "Start free" : pro ? "Try Pro free for 7 days" : "Start with Basic"}
            </ButtonLink>
          </div>
        );
      })}
    </div>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24 py-16 sm:py-24">
      <div className={cx(container, "max-w-[1080px]")}>
        <SectionHeading
          align="center"
          id="pricing-title"
          eyebrow="Pricing"
          title="Start free. Upgrade when you need room or AI."
          lede="Every new account gets Pro free for 7 days. Every plan includes web, Mac and iOS."
        />
        <div className="mt-12">
          <PricingCard />
        </div>
      </div>
    </section>
  );
}

const CTA_BUBBLES: BubbleSpec[] = [
  { emoji: "🌱", size: 88, style: { top: "18%", left: "7%" }, className: "hidden md:grid", dur: 10 },
  { emoji: "📝", size: 70, style: { bottom: "16%", left: "15%" }, className: "hidden lg:grid", dur: 8, delay: -3 },
  { emoji: "📚", size: 76, style: { top: "22%", right: "8%" }, className: "hidden md:grid", dur: 11, delay: -6 },
  { emoji: "✨", size: 58, style: { bottom: "18%", right: "15%" }, className: "hidden lg:grid", dur: 9, delay: -2 },
];

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="pb-10 pt-4 sm:pb-16">
      <div className={container}>
        <div className="mk-panel mk-panel--cream relative overflow-hidden px-6 py-20 text-center sm:px-10 sm:py-28">
          <div aria-hidden="true" className="mk-glow mk-glow--center" />
          <Bubbles items={CTA_BUBBLES} />
          <div className="relative">
            <FoleviMark size={56} className="mx-auto block drop-shadow-[0_6px_16px_rgb(0_0_0/0.08)]" />
            <h2 id="cta-title" className="mk-display mx-auto mt-8 max-w-[14ch] text-[42px] sm:text-[64px]">
              Start with one loose thought.
            </h2>
            <p className="mk-lede mx-auto mt-6 max-w-[40ch]">
              Folevi will keep it safe while it grows into something worth returning to.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
                Start writing
              </ButtonLink>
              <ButtonLink href="/docs" variant="secondary" size="lg">
                Read the docs
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
