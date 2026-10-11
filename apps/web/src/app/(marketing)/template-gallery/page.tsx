import Link from "next/link";
import { Checks } from "@/components/marketing/Checks";
import { TemplateCard } from "@/components/marketing/templates/TemplateCard";
import { galleryGroups, templatePath, type GalleryTemplate } from "@/components/marketing/content/templates";
import { availableGalleryTemplates } from "@/components/marketing/content/templateAvailability";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl } from "@/components/marketing/site";
import { Eyebrow } from "@/components/marketing/ui";

/** Re-check hourly which templates an admin has switched off. */
export const revalidate = 3600;

export async function generateMetadata() {
  const count = (await availableGalleryTemplates()).length;
  return pageMetadata({
    title: "Free note templates",
    description: `${count} free note templates: meeting notes, 1:1s, a weekly reset, project briefs, class notes, a travel plan and more. Preview one and start a page from it.`,
    path: "/template-gallery",
    ogImage: "segment",
  });
}

function itemListLd(list: GalleryTemplate[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Folevi note templates",
    numberOfItems: list.length,
    itemListElement: list.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: `${t.searchName} template`, url: absoluteUrl(templatePath(t.key)) })),
  };
}

export default async function TemplateGalleryPage() {
  const available = await availableGalleryTemplates();
  const count = available.length;
  const groups = galleryGroups(available);
  return (
    <>
      <JsonLd data={itemListLd(available)} />
      <PageFrame>
        <HeaderCard
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Template gallery", path: "/template-gallery" },
          ]}
        >
          <Eyebrow>Template gallery</Eyebrow>
          <h1 className="mk-display mt-4 max-w-[18ch] text-[40px] sm:text-[56px] lg:text-[64px]">Free note templates for Folevi.</h1>
          <p className="mk-lede mt-5 max-w-[60ch]">{count} templates, free on every plan.</p>
          <Checks
            className="mt-6"
            items={[
              <>Preview the page each one makes</>,
              <>Start a page from it in the app</>,
              <>
                Save any page as{" "}
                <Link href="/features/templates" className="mk-link">
                  your own template
                </Link>
              </>,
            ]}
          />
          <nav aria-label="Template groups" className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <a href={`#${g.id}`} className="mk-chip min-h-9 hover:bg-(--color-surface-sunken) hover:text-(--color-heading)">
                    {g.name} <span className="text-muted">{g.templates.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </HeaderCard>
        {groups.map((group) => (
          <Card key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="scroll-mt-8">
            <h2 id={`${group.id}-title`} className="mk-h2 text-[30px] sm:text-[38px]">
              {group.name}
            </h2>
            <p className="mt-2 text-[16px] text-muted">{group.lede}</p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.templates.map((t) => (
                <li key={t.key}>
                  <TemplateCard template={t} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <SignUpPanel title="Start from a template." body="Free on every plan, and the page you make is yours to change." secondary={{ label: "All features", href: "/features" }} />
      </PageFrame>
    </>
  );
}
