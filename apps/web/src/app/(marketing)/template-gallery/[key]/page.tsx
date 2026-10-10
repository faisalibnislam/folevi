import { availableGalleryTemplates } from "@/components/marketing/content/templateAvailability";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { TemplateCard } from "@/components/marketing/templates/TemplateCard";
import {
  GALLERY_TEMPLATES,
  TEMPLATE_GALLERY_UPDATED,
  TEMPLATE_GROUPS,
  listJoin,
  templateByKey,
  templatePath,
  templateSections,
  templateStats,
  type GalleryTemplate,
} from "@/components/marketing/content/templates";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl, signUpWithTemplate } from "@/components/marketing/site";
import { TemplateSheet } from "@/components/marketing/templates/TemplateSheet";
import { ButtonLink, Eyebrow, container, cx } from "@/components/marketing/ui";

export const dynamicParams = false;
/** Re-check hourly which templates an admin has switched off. */
export const revalidate = 3600;

export function generateStaticParams() {
  return GALLERY_TEMPLATES.map((t) => ({ key: t.key }));
}

type Params = { params: Promise<{ key: string }> };

/** "Meeting notes" → "meeting notes", but "OKRs" and "1:1" stay as they are. */
const inSentence = (name: string) => (/^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name);

/** The page's meta description: the template's line, then its sections when they fit in 160 characters. */
function describe(t: GalleryTemplate): string {
  const sections = templateSections(t);
  const base = `${t.description} A free ${inSentence(t.searchName)} template for Folevi`;
  const full = sections.length ? `${base}, with sections for ${listJoin(sections)}.` : `${base}.`;
  return full.length <= 160 ? full : `${base}.`;
}

export async function generateMetadata({ params }: Params) {
  const t = templateByKey((await params).key);
  if (!t) return {};
  return pageMetadata({ title: `${t.searchName} template (free)`, description: describe(t), path: templatePath(t.key), ogImage: "segment" });
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number, one: string, many = `${one}s`) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;

function makeup(t: GalleryTemplate): string | null {
  const s = templateStats(t);
  const parts = [s.callouts ? count(s.callouts, "callout") : null, s.todos ? count(s.todos, "to-do") : null, s.tables ? count(s.tables, "table") : null, s.toggles ? count(s.toggles, "toggle") : null].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length ? `It has ${listJoin(parts)}.` : null;
}

function creativeWorkLd(t: GalleryTemplate): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: `${t.searchName} template`,
    description: describe(t),
    url: absoluteUrl(templatePath(t.key)),
    isAccessibleForFree: true,
    dateModified: TEMPLATE_GALLERY_UPDATED,
    publisher: { "@type": "Organization", name: "Folevi", url: absoluteUrl("/") },
  };
}

export default async function TemplatePage({ params }: Params) {
  const t = templateByKey((await params).key);
  const available = await availableGalleryTemplates();
  // Switched off by an admin: the page goes away (at the next hourly re-check).
  if (!t || !available.some((x) => x.key === t.key)) notFound();
  const path = templatePath(t.key);
  const group = TEMPLATE_GROUPS.find((g) => g.id === t.group);
  const sections = templateSections(t);
  const stats = templateStats(t);
  // The next three in the group, wrapping around, so every template is linked from the ones before it.
  const siblings = available.filter((x) => x.group === t.group);
  const at = siblings.findIndex((x) => x.key === t.key);
  const more = [1, 2, 3].map((k) => siblings[(at + k) % siblings.length]!).filter((x, i, all) => x.key !== t.key && all.findIndex((y) => y.key === x.key) === i);
  const heading = `${t.searchName} template`;

  return (
    <>
      <JsonLd data={creativeWorkLd(t)} />
      <PageFrame>
        <HeaderCard
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Template gallery", path: "/template-gallery" },
            { name: t.name, path },
          ]}
        >
          <div className="flex items-center gap-3">
            <TemplateTile name={t.icon} />
            <Eyebrow>{group ? `${group.name} template` : "Template"}</Eyebrow>
          </div>
          <h1 className="mk-display mt-5 max-w-[20ch] text-[40px] sm:text-[56px] lg:text-[64px]">{heading}</h1>
          <p className="mk-lede mt-5 max-w-[60ch]">{t.description} Free on every Folevi plan.</p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <ButtonLink href={signUpWithTemplate(t.key)} icon="arrow-right" size="lg">
              Use this template
            </ButtonLink>
            <ButtonLink href="/template-gallery" variant="secondary" size="lg">
              All templates
            </ButtonLink>
          </div>
        </HeaderCard>

        <div className={cx(container, "grid gap-(--mk-stack-gap) lg:grid-cols-[minmax(0,1fr)_340px]")}>
          <section aria-labelledby="preview-title" className="mk-box min-w-0 p-4 sm:p-5">
            <h2 id="preview-title" className="sr-only">
              Preview of the page this template makes
            </h2>
            <div className="mk-panel p-4 sm:p-8">
              <TemplateSheet blocks={t.blocks} title={t.name} topHeading={3} className="mx-auto max-w-[720px]" />
            </div>
            <p className="mt-3 px-1 pb-1 text-[13.5px] text-muted sm:px-2">A new page from this template, as Folevi creates it. The empty lines are where you write.</p>
          </section>

          <div className="space-y-(--mk-stack-gap) self-start lg:sticky lg:top-8">
            <section aria-labelledby="inside-title" className="mk-box p-5 sm:p-6">
              <h2 id="inside-title" className="text-[16px] font-semibold text-(--color-heading)">
                What’s in it
              </h2>
              {sections.length ? (
                <ul className="mt-3 space-y-1.5 text-[14.5px] text-ink">
                  {sections.map((s) => (
                    <li key={s} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-[9px] size-[5px] flex-none rounded-tiny bg-(--color-ink-muted)" />
                      {s}
                    </li>
                  ))}
                </ul>
              ) : null}
              {makeup(t) ? <p className="mt-3 text-[14px] leading-relaxed text-muted">{makeup(t)}</p> : null}
              {stats.todos ? (
                <p className="mt-2 text-[14px] leading-relaxed text-muted">
                  To-dos are <Link href="/features/tasks" className="mk-link">tasks</Link> in Folevi: give one a date and it shows up in Today.
                </p>
              ) : null}
            </section>
            <section aria-labelledby="how-title" className="mk-box p-5 sm:p-6">
              <h2 id="how-title" className="text-[16px] font-semibold text-(--color-heading)">
                How to use it
              </h2>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-ink marker:text-muted">
                <li>Sign in to Folevi, or create a free account.</li>
                <li>Open Templates in the sidebar.</li>
                <li>
                  Under Built-in templates, choose <strong className="font-semibold text-(--color-heading)">{t.name}</strong>. Folevi creates a new page from it.
                </li>
              </ol>
              <ButtonLink href={signUpWithTemplate(t.key)} icon="arrow-right" className="mt-5 w-full">
                Use this template
              </ButtonLink>
            </section>
          </div>
        </div>

        {more.length ? (
          <Card aria-labelledby="more-title">
            <h2 id="more-title" className="mk-h2">
              More {group ? group.name.toLowerCase() : ""} templates
            </h2>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((x) => (
                <li key={x.key}>
                  <TemplateCard template={x} />
                  </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <SignUpPanel title="Start from this template." body="Create a free account, then pick it from Templates. The Free plan has no time limit." href={signUpWithTemplate(t.key)} cta="Use this template" secondary={{ label: "All templates", href: "/template-gallery" }} />
      </PageFrame>
    </>
  );
}
