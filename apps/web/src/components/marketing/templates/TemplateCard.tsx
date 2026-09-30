import Link from "next/link";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { templatePath, type GalleryTemplate } from "../content/templates";

/** A gallery card: the template's tile, name and description; the whole card opens the template's page. */
export function TemplateCard({ template, headingLevel = "h3" }: { template: GalleryTemplate; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="mk-card group relative flex h-full items-start gap-3.5 p-4 transition-shadow duration-150 hover:shadow-(--shadow-pop) sm:p-5">
      <TemplateTile name={template.icon} />
      <div className="min-w-0">
        <Heading className="text-[15.5px] font-semibold leading-snug text-(--color-heading)">
          <Link
            href={templatePath(template.key)}
            className="after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-(--color-focus)"
          >
            {template.name}
          </Link>
        </Heading>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{template.description}</p>
      </div>
    </div>
  );
}
