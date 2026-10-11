import Link from "next/link";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { templatePath, type GalleryTemplate } from "../content/templates";
import { Sticker } from "../fun";

/**
 * A gallery card: the template's tile, name and description; the whole card opens the template's page. On the
 * gallery a few carry a decorative sticker.
 */
export function TemplateCard({
  template,
  headingLevel = "h3",
  sticker,
}: {
  template: GalleryTemplate;
  headingLevel?: "h2" | "h3";
  sticker?: string;
}) {
  const Heading = headingLevel;
  return (
    <div className="mk-card group relative flex h-full items-start gap-3.5 p-5 transition-shadow duration-150 hover:shadow-(--shadow-pop)">
      <TemplateTile name={template.icon} />
      <div className="min-w-0">
        <Heading className="text-[15.5px] font-semibold leading-snug text-(--color-heading)">
          <Link
            href={templatePath(template.key)}
            className="after:absolute after:inset-0 after:rounded-control focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-(--color-focus)"
          >
            {template.name}
          </Link>
        </Heading>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{template.description}</p>
      </div>
      {sticker ? (
        <span aria-hidden="true" className="pointer-events-none absolute -top-3 right-4 z-10">
          <Sticker tone="violet" rotate={6} className="px-2.5 py-1 text-[11.5px]">
            {sticker}
          </Sticker>
        </span>
      ) : null}
    </div>
  );
}
