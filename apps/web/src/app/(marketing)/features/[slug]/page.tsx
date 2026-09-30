import Link from "next/link";
import { notFound } from "next/navigation";
import { FEATURES, featureBySlug, featurePath } from "@/components/marketing/content/features";
import { FeatureIcon } from "@/components/marketing/features/FeatureIcon";
import { FeatureVisual } from "@/components/marketing/features/FeatureVisual";
import { Icon } from "@/components/marketing/icons";
import { Breadcrumbs, FaqSection, LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { SIGN_UP_URL, absoluteUrl } from "@/components/marketing/site";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";
import { ButtonLink, Eyebrow, container, cx } from "@/components/marketing/ui";

export const dynamicParams = false;

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const feature = featureBySlug((await params).slug);
  if (!feature) return {};
  return pageMetadata({ title: feature.title, description: feature.description, path: featurePath(feature.slug), ogImage: "segment" });
}

function webPageLd(feature: NonNullable<ReturnType<typeof featureBySlug>>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: feature.h1,
    description: feature.description,
    url: absoluteUrl(featurePath(feature.slug)),
    dateModified: feature.updated,
    isPartOf: { "@type": "WebSite", name: "Folevi", url: absoluteUrl("/") },
    about: { "@type": "SoftwareApplication", name: "Folevi", applicationCategory: "ProductivityApplication", operatingSystem: "Web" },
  };
}

export default async function FeaturePage({ params }: Params) {
  const feature = featureBySlug((await params).slug);
  if (!feature) notFound();
  const path = featurePath(feature.slug);
  const related = feature.related.map(featureBySlug).filter((f) => f !== undefined);

  return (
    <>
      <JsonLd data={webPageLd(feature)} />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Features", path: "/features" },
          { name: feature.name, path },
        ]}
      />
      <header className={cx(container, "pb-10 pt-8 sm:pb-14 sm:pt-12")}>
        <div className="flex items-center gap-3">
          <FeatureIcon slug={feature.slug} />
          <Eyebrow>{feature.name}</Eyebrow>
        </div>
        <h1 className="mk-display mt-5 max-w-[20ch] text-[38px] sm:text-[52px] lg:text-[60px]">{feature.h1}</h1>
        <p className="mk-lede mt-5 max-w-[60ch]">{feature.intro}</p>
        <div className="mt-8 flex flex-wrap items-center gap-2.5">
          <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
            Start writing
          </ButtonLink>
          {feature.docs ? (
            <ButtonLink href={feature.docs.href} variant="secondary" size="lg">
              Read the docs
            </ButtonLink>
          ) : feature.slug === "templates" ? (
            <ButtonLink href="/template-gallery" variant="secondary" size="lg">
              Browse templates
            </ButtonLink>
          ) : null}
        </div>
        <p className="mt-4 text-[13.5px] text-muted">{feature.plans}</p>
      </header>

      <div className={container}>
        <FeatureVisual visual={feature.visual} art={feature.art} />
      </div>

      <div className={cx(container, "grid gap-12 pb-16 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-16")}>
        <div className="mk-prose max-w-[700px]">
          {feature.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className="mt-14 first:mt-0 [&>*+*]:mt-[1em] [&>h2+*]:mt-[0.6em]">
              <h2 id={section.id}>{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
        <div className="self-start lg:sticky lg:top-24">
          <nav aria-label="On this page" className="hidden lg:block">
            <p className="mk-caps pb-2 pl-3.5">On this page</p>
            <ol className="border-l mk-hair">
              {feature.sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ml-px flex min-h-8 items-center border-l border-transparent py-1 pl-3.5 pr-2 text-[14px] leading-snug text-muted transition-colors duration-150 hover:border-(--color-heading) hover:text-(--color-heading)"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="mk-card p-5 lg:mt-8">
            <p className="text-[14.5px] font-semibold text-(--color-heading)">Plans</p>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">{feature.plans}</p>
            <Link href="/pricing" className="mk-link mt-3 inline-flex min-h-8 items-center gap-1.5 text-[14px]">
              Compare plans <Icon name="arrow-right" size={14} />
            </Link>
            {feature.docs ? (
              <>
                <p className="mt-5 border-t mk-hair pt-4 text-[14.5px] font-semibold text-(--color-heading)">In the docs</p>
                <Link href={feature.docs.href} className="mk-link mt-1 inline-flex min-h-8 items-center gap-1.5 text-[14px]">
                  {feature.docs.label} <Icon name="arrow-right" size={14} />
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className={cx(container, "pb-16 sm:pb-24")}>
        <FaqSection faqs={feature.faq} path={path} />
      </div>

      <section aria-labelledby="related-title" className={cx(container, "pb-16 sm:pb-24")}>
        <h2 id="related-title" className="mk-h2">
          Related features
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {related.map((r) => (
            <li key={r.slug}>
              <LinkCard href={featurePath(r.slug)} title={r.name} body={r.summary} icon={<FeatureIcon slug={r.slug} />} />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14.5px] text-muted">
          <Link href="/features" className="mk-link">
            All features
          </Link>
        </p>
      </section>

      <SignUpPanel
        body={`The Free plan has no time limit. New accounts get ${TIER_NAMES[TRIAL_TIER]} free for ${TRIAL_DAYS} days, with no card.`}
        secondary={{ label: "See pricing", href: "/pricing" }}
      />
    </>
  );
}
