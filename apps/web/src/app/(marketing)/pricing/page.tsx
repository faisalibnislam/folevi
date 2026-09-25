import Link from "next/link";
import { PricingCard } from "@/components/marketing/home/Closing";
import { pageMetadata } from "@/components/marketing/seo";
import { PageHeader, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Pricing",
  description: "Folevi is free during the preview. There are no paid plans yet; preview accounts will be told well in advance if that changes.",
  path: "/pricing",
});

const faqs: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Is it really free?",
    a: "Yes. During the preview, Folevi costs nothing and there’s nothing to buy. We don’t ask for a card when you sign up.",
  },
  {
    q: "Will Folevi always be free?",
    a: "We don’t know yet, and we won’t pretend otherwise. Paid plans may come later. If they do, everyone with a preview account will hear from us well before anything changes.",
  },
  {
    q: "What happens to my notes if pricing changes?",
    a: (
      <>
        They stay yours. You can export any page as Markdown, HTML or PDF, or your whole workspace as a ZIP, at any time —
        see <Link href="/docs#import-export">Import &amp; export</Link>.
      </>
    ),
  },
  {
    q: "Is the Mac app included?",
    a: (
      <>
        Yes. The Mac app is in private preview; preview accounts will get an email when builds are available. See{" "}
        <Link href="/mac">Folevi for Mac</Link>.
      </>
    ),
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader eyebrow="Pricing" title="Free during the preview." lede="One honest plan. No tiers, no trials, no card." />
      <div className={cx(container, "max-w-[1080px] pb-20 pt-4 sm:pb-28")}>
        <PricingCard headingLevel="h2" />
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
