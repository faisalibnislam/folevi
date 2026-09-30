import Link from "next/link";
import { featureBySlug, featurePath } from "./content/features";
import { SECURITY_EMAIL, SUPPORT_EMAIL } from "./site";
import { Wordmark, container, cx } from "./ui";

// Feature pages listed in the footer (the full list is on /features).
const FOOTER_FEATURES = ["ai-notes", "offline-notes", "tasks", "linked-notes", "flowcharts", "team-workspaces"];

const columns: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Template gallery", href: "/template-gallery" },
      { label: "Mac app", href: "/mac" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
      { label: "Blog", href: "/blog" },
      { label: "Compare", href: "/compare" },
    ],
  },
  {
    title: "Features",
    links: [
      ...FOOTER_FEATURES.map((slug) => {
        const feature = featureBySlug(slug)!;
        return { label: feature.name, href: featurePath(slug) };
      }),
      { label: "All features", href: "/features" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Getting started", href: "/docs/getting-started" },
      { label: "Support", href: "/support" },
      { label: "Status", href: "/status" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-8 border-t mk-hair">
      <div className={cx(container, "grid gap-10 py-12 sm:py-14 lg:grid-cols-[0.9fr_2.1fr]")}>
        <div>
          <Wordmark markSize={24} />
          <p className="mt-4 max-w-[34ch] text-[14.5px] leading-relaxed text-muted">
            Notes, documents and tasks on the web. The Mac app is coming soon.
          </p>
          <p className="mt-5 text-[14px] text-muted">
            Support{" "}
            <a className="mk-link" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p className="mt-1 text-[14px] text-muted">
            Security contact{" "}
            <a className="mk-link" href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </a>
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="mk-caps">{column.title}</h2>
              <ul className="mt-3 space-y-0.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="-ml-2 inline-flex min-h-11 items-center rounded-[6px] px-2 text-[14.5px] text-ink transition-colors duration-150 hover:bg-(--color-surface-sunken) hover:text-(--color-heading) sm:min-h-9"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className={container}>
        <div className="flex flex-col gap-1 border-t mk-hair py-5 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Folevi</p>
          <p>Made for people who write things down.</p>
        </div>
      </div>
    </footer>
  );
}
