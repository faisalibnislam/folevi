import { TRIAL_CREDITS, TRIAL_DAYS, TRIAL_TIER, TIER_NAMES } from "@/lib/plans";
import Link from "next/link";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "../icons";
import { SIGN_UP_URL } from "../site";
import { PlanPicker } from "./PlanPicker";
import { ButtonLink, SectionHeading, box, container, cx } from "../ui";

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
    <section id="security" aria-labelledby="security-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
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

export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <SectionHeading
          align="center"
          id="pricing-title"
          eyebrow="Pricing"
          title="Start free. Upgrade when you need room or AI."
          lede={`Four plans, for you or for your team. Every new account gets ${TIER_NAMES[TRIAL_TIER]} free for ${TRIAL_DAYS} days, with ${TRIAL_CREDITS} AI credits and no card.`}
        />
        <div className="mt-10">
          <PlanPicker align="center" />
        </div>
        <p className="mt-6 text-center text-[14px] text-muted">
          AI credits, credit packs and answers to common questions.{" "}
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
    <section aria-labelledby="cta-title" className={container}>
      <div className="mk-box px-6 py-16 text-center sm:px-10 sm:py-24">
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
    </section>
  );
}
