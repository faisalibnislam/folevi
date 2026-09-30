import Link from "next/link";
import { TemplateCard } from "@/components/marketing/templates/TemplateCard";
import { GALLERY_TEMPLATES, galleryGroups, templatePath } from "@/components/marketing/content/templates";
import { Breadcrumbs, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";

const count = GALLERY_TEMPLATES.length;

export const metadata = pageMetadata({
  title: "Free note templates",
  description: `${count} free note templates for Folevi: meeting notes, 1:1s, a weekly reset, project briefs, decision records, class notes, a travel plan, a budget and more. Preview each one and start a page from it.`,
  path: "/template-gallery",
  ogImage: "segment",
});

function itemListLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Folevi note templates",
    numberOfItems: count,
    itemListElement: GALLERY_TEMPLATES.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: `${t.searchName} template`, url: absoluteUrl(templatePath(t.key)) })),
  };
}

export default function TemplateGalleryPage() {
  const groups = galleryGroups();
  return (
    <>
      <JsonLd data={itemListLd()} />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Template gallery", path: "/template-gallery" },
        ]}
      />
      <header className={cx(container, "pb-10 pt-8 sm:pb-14 sm:pt-12")}>
        <Eyebrow>Template gallery</Eyebrow>
        <h1 className="mk-display mt-4 max-w-[18ch] text-[40px] sm:text-[56px] lg:text-[64px]">Free note templates for Folevi.</h1>
        <p className="mk-lede mt-5 max-w-[60ch]">
          {count} templates come with every Folevi account, on every plan. Open one to see the page it makes, then start from it in the app. You can also save any page as your own template.
        </p>
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
      </header>
      <div className={cx(container, "space-y-16 pb-16 sm:space-y-20 sm:pb-24")}>
        {groups.map((group) => (
          <section key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="scroll-mt-24">
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
          </section>
        ))}
        <p className="text-[15px] text-muted">
          How templates work in the app, and how to save your own:{" "}
          <Link href="/features/templates" className="mk-link">
            Templates in Folevi
          </Link>
          .
        </p>
      </div>
      <SignUpPanel title="Start from a template." body="Every template is free on every plan, and a page you make from one is yours to change." secondary={{ label: "All features", href: "/features" }} />
    </>
  );
}
