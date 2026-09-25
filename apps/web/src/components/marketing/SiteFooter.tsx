import Link from "next/link";
import { SECURITY_EMAIL } from "./site";
import { Wordmark, container, cx } from "./ui";

const columns: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/#chapters" },
      { label: "Mac app", href: "/mac" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Documentation", href: "/docs" },
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
    <footer className={cx(container, "pb-5 pt-8 sm:pb-8")}>
      <div className="mk-panel mk-panel--cream overflow-hidden">
        <div className="relative grid gap-12 px-6 py-10 sm:px-10 sm:py-12 md:grid-cols-[1.2fr_2fr]">
          <div>
            <Wordmark markSize={24} className="text-[18px]" />
            <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-muted">
              A quieter place for ideas that keep growing. On the web and on the Mac.
            </p>
            <p className="mt-6 text-[14px] text-muted">
              Security contact{" "}
              <a className="mk-link" href={`mailto:${SECURITY_EMAIL}`}>
                {SECURITY_EMAIL}
              </a>
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <div key={column.title}>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{column.title}</h2>
                <ul className="mt-3 space-y-0.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="-ml-2.5 inline-flex min-h-11 items-center sm:min-h-10 rounded-full px-2.5 text-[15px] text-(--color-heading) transition-colors duration-150 hover:bg-accent-soft"
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
        <div className="relative flex flex-col gap-2 border-t mk-hair px-6 py-5 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <p>© {year} Folevi</p>
          <p>Made with care for people who write things down.</p>
        </div>
      </div>
    </footer>
  );
}
