import Link from "next/link";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "../icons";
import { SIGN_UP_URL } from "../site";
import { ButtonLink, Eyebrow, RegMark, container, cx } from "../ui";

export const SECURITY_CONTROLS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "mail",
    title: "Verified email first",
    body: "You confirm your email address before you can open a workspace.",
  },
  {
    icon: "key",
    title: "Two-step verification, always",
    body: "Every account uses an authenticator app (TOTP) as a second step, with one-time recovery codes for emergencies.",
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
    <section id="security" aria-labelledby="security-title" className="scroll-mt-14 border-t mk-hair py-20 sm:py-28">
      <div className={container}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Eyebrow>Privacy & security</Eyebrow>
            <h2 id="security-title" className="mt-5 max-w-[14ch] font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
              Private by default. Plain about the rest.
            </h2>
            <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-muted">
              Your notes are yours. Here is exactly what protects them — and one thing Folevi deliberately doesn’t do.
            </p>
            <div className="mt-8 rounded-card border border-dashed border-line-strong bg-surface p-5">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <Icon name="shield" size={17} />
                Folevi is not end-to-end encrypted
              </p>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
                Our servers can process your content so that search, sharing, sync and support can work. What we don’t
                have is a way to browse it: the admin tools have no content viewer, so staff cannot open your notes from
                there.
              </p>
            </div>
            <Link href="/security" className="mt-6 inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-accent hover:underline">
              Read the full security overview <Icon name="arrow-right" size={16} />
            </Link>
          </div>
          <ul className="grid gap-px self-start overflow-hidden rounded-card border mk-hair bg-line sm:grid-cols-2">
            {SECURITY_CONTROLS.map((control) => (
              <li key={control.title} className="relative bg-surface p-5 sm:p-6">
                <Icon name={control.icon} size={20} className="text-accent" />
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{control.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{control.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export const PREVIEW_INCLUDES = [
  "Pages, sub-pages and every block type",
  "Tasks with dates, Today and a calendar",
  "The web app and the Mac app (as builds become available)",
  "Offline editing and real-time sync",
  "Sharing with expiring, password-protected links",
  "Export to Markdown, HTML, PDF and ZIP",
];

export function PricingCard({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="relative overflow-hidden rounded-sheet border mk-hair-strong bg-raised shadow-[var(--mk-shadow-soft)]">
      <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="relative border-b mk-hair bg-accent-soft p-7 sm:p-9 md:border-b-0 md:border-r">
          <span aria-hidden="true" className="absolute right-5 top-5 text-accent-soft-ink">
            <FoleviMark size={28} />
          </span>
          <Heading className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-soft-ink">Preview</Heading>
          <p className="mt-6 flex items-baseline gap-2 text-accent-soft-ink">
            <span className="font-display text-[72px] leading-none">Free</span>
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-accent-soft-ink">during the preview, for everyone who signs up.</p>
          <ButtonLink href={SIGN_UP_URL} className="mt-8 w-full sm:w-auto" icon="arrow-right">
            Start writing
          </ButtonLink>
        </div>
        <div className="p-7 sm:p-9">
          <p className="text-[14px] font-medium text-ink">Everything in Folevi today:</p>
          <ul className="mt-4 space-y-2.5">
            {PREVIEW_INCLUDES.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[15px] text-ink">
                <Icon name="check" size={17} className="mt-0.5 shrink-0 text-moss-ink" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t mk-hair pt-5 text-[14px] leading-relaxed text-muted">
            There are no paid plans yet. Paid plans may come later; if they do, preview accounts will be told well in
            advance, before anything changes.
          </p>
        </div>
      </div>
    </div>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-14 border-t mk-hair bg-surface py-20 sm:py-28">
      <div className={cx(container, "max-w-[1040px]")}>
        <div className="text-center">
          <Eyebrow className="justify-center">Pricing</Eyebrow>
          <h2 id="pricing-title" className="mx-auto mt-5 max-w-[16ch] font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[56px]">
            Free during the preview.
          </h2>
          <p className="mx-auto mt-5 max-w-[48ch] text-[17px] leading-relaxed text-muted">One plan, no tiers, no card required.</p>
        </div>
        <div className="mt-12">
          <PricingCard />
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t mk-hair py-24 sm:py-32">
      <div aria-hidden="true" className="mk-rules pointer-events-none absolute inset-0" />
      <div className={cx(container, "relative text-center")}>
        <span aria-hidden="true" className="mx-auto flex w-fit">
          <RegMark size={15} />
        </span>
        <h2 id="cta-title" className="mx-auto mt-8 max-w-[16ch] font-display text-[48px] leading-[1] tracking-[-0.02em] sm:text-[72px]">
          Start with one loose thought.
        </h2>
        <p className="mx-auto mt-6 max-w-[44ch] text-[18px] leading-relaxed text-muted">
          Folevi will keep it safe while it grows into something worth returning to.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <ButtonLink href={SIGN_UP_URL} icon="arrow-right">
            Start writing
          </ButtonLink>
          <ButtonLink href="/docs" variant="secondary">
            Read the docs
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
