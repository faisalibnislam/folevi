import Link from "next/link";
import { FoleviWordmark } from "@/components/brand/FoleviMark";
import { SECURITY_EMAIL } from "./site";
import { RegMark, container, cx } from "./ui";

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
    <footer className="relative border-t mk-hair bg-surface">
      <div className={cx(container, "relative grid gap-12 py-14 md:grid-cols-[1.2fr_2fr] md:py-16")}>
        <span aria-hidden="true" className="absolute -top-[7px] left-5 sm:left-8">
          <RegMark />
        </span>
        <div>
          <FoleviWordmark markSize={22} className="text-[18px] text-ink" />
          <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-muted">
            A quieter place for ideas that keep growing. On the web and on the Mac.
          </p>
          <p className="mt-6 text-[14px] text-muted">
            Security contact{" "}
            <a className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-current" href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </a>
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">{column.title}</h2>
              <ul className="mt-4 space-y-1">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="inline-flex min-h-9 items-center text-[15px] text-ink hover:text-accent">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t mk-hair">
        <div className={cx(container, "flex flex-col gap-2 py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between")}>
          <p>© {year} Folevi</p>
          <p>Made with care for people who write things down.</p>
        </div>
      </div>
    </footer>
  );
}
