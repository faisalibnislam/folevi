"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Component, Suspense, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ArrowLeft, ArrowUp, BarChart3, Building2, ClipboardList, CreditCard, DollarSign, Eye, Gauge, LifeBuoy, LogOut, Mail, Settings2, Trash2, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { useAdmin } from "./AdminApp";
import { ROLE_LABEL, type Capability } from "./permissions";
import { AdminTitleContext } from "./title";

interface NavEntry {
  href: string;
  label: string;
  icon: typeof Gauge;
  capability: Capability;
  /** Shows the number of support tickets with a message nobody on staff has opened. */
  count?: "supportUnread";
}

// The same grouping idea as the app's sidebar: a few plain sections under small caps labels.
const NAV: { heading: string; items: NavEntry[] }[] = [
  {
    heading: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: Gauge, capability: "dashboard.view" },
      { href: "/admin/analytics", label: "User analytics", icon: BarChart3, capability: "analytics.view" },
      { href: "/admin/revenue", label: "Revenue", icon: DollarSign, capability: "revenue.view" },
    ],
  },
  {
    heading: "Accounts",
    items: [
      { href: "/admin/support", label: "Support", icon: LifeBuoy, capability: "support.view", count: "supportUnread" },
      { href: "/admin/users", label: "Users", icon: Users, capability: "users.view" },
      { href: "/admin/workspaces", label: "Workspaces", icon: Building2, capability: "workspaces.view" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { href: "/admin/emails", label: "Emails", icon: Mail, capability: "emails.view" },
      { href: "/admin/audit", label: "Audit log", icon: ClipboardList, capability: "audit.view" },
      { href: "/admin/deletion-jobs", label: "Deletion jobs", icon: Trash2, capability: "deletionJobs.view" },
      { href: "/admin/configuration", label: "Configuration", icon: Settings2, capability: "config.view" },
      { href: "/admin/billing-setup", label: "Billing setup", icon: CreditCard, capability: "billing.setup" },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

// The app's sidebar row (components/app/Sidebar.tsx NavItem): the open page comes forward on light glass.
const ROW = "group flex h-8 items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11";
const ROW_ON = "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]";
const ROW_OFF = "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading";

// The app's tab strip tabs (components/app/TabStrip.tsx).
const TAB = "relative flex h-8 min-w-0 items-center gap-2 rounded-[6px] px-2.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus";
const TAB_ON = "bg-[var(--color-surface-raised)] font-semibold text-heading shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_16.5%,transparent)]";
const TAB_OFF = "bg-[var(--glass-hover)] text-muted hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)] hover:text-heading";
const ICON_BTN = "grid h-8 w-8 flex-none place-items-center rounded-[6px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** Errors inside a page stay inside the page; the shell and navigation keep working. */
class PageBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="rounded-[10px] bg-danger-soft p-5 text-sm">
          <p className="font-semibold text-heading">This page couldn&apos;t load.</p>
          <p className="mt-1">{errorMessage(this.state.error)}</p>
          <Button className="mt-3" size="sm" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * The console's frame, built like the app's (components/app/Shell.tsx): neutral glass on a soft canvas, a
 * sidebar with the logo and sections, and one floating content panel with a tab strip on top.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const admin = useAdmin();
  const [recordTitle, setRecordTitle] = useState<string | null>(null);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => admin.can(n.capability)) })).filter((g) => g.items.length > 0);
  const supportUnread = useQuery(api.support.unreadCount, admin.can("support.view") ? {} : "skip");
  const section = ALL_ITEMS.find((n) => isActive(pathname, n.href));
  // A record's own page (a person, a workspace) sits under its section: the section becomes a tab you can go back to.
  const onRecord = Boolean(section && pathname !== section.href);
  const SectionIcon = section?.icon ?? Gauge;

  return (
    <AdminTitleContext.Provider value={setRecordTitle}>
      <div className="ui-canvas min-h-dvh text-ink md:flex md:h-dvh md:gap-2 md:overflow-hidden md:p-2">
        <a href="#admin-main" className="sr-only-focusable ui-btn ui-btn-primary fixed left-2 top-2 z-[70] px-4 py-2">
          Skip to content
        </a>
        <aside className="flex flex-none flex-col md:w-[248px]">
          <div className="flex h-[52px] flex-none items-center gap-2 px-3">
            <Link href="/admin" aria-label="Folevi admin" title="Go to the dashboard" className="flex items-center rounded-[6px] px-1 py-1 text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <FoleviLogo height={26} title={null} className="flex-none" />
            </Link>
            <span className="rounded-[6px] bg-[var(--glass-hover)] px-2 py-0.5 text-[11.5px] font-semibold text-muted">Admin</span>
          </div>
          <nav aria-label="Admin" className="px-2.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className="flex gap-0.5 overflow-x-auto pb-2 md:block md:overflow-visible md:pb-4">
              {groups.map((g, i) => (
                <div key={g.heading} className={`contents md:block ${i > 0 ? "md:mt-5" : "md:mt-2"}`}>
                  <p aria-hidden className="ui-caps hidden h-7 items-center px-2.5 md:flex">
                    {g.heading}
                  </p>
                  <ul className="contents md:block md:space-y-0.5">
                    {g.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      const Icon = item.icon;
                      const count = item.count === "supportUnread" ? (supportUnread ?? 0) : 0;
                      return (
                        <li key={item.href}>
                          <Link href={item.href} aria-current={active ? "page" : undefined} className={`${ROW} ${active ? ROW_ON : ROW_OFF}`}>
                            <Icon size={16} aria-hidden className={`flex-none transition-colors ${active ? "text-heading" : "text-muted group-hover:text-heading"}`} />
                            {item.label}
                            {count > 0 ? (
                              <span className="ml-auto rounded-[6px] bg-heading px-1.5 text-[11px] font-semibold leading-[18px] text-canvas tabular-nums">
                                {count >= 100 ? "99+" : count}
                                <span className="sr-only"> unread</span>
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
          <div className="hidden flex-none px-2 pb-2 md:block">
            <a href="/documents" className={`${ROW} ${ROW_OFF}`}>
              <ArrowLeft size={16} aria-hidden className="flex-none text-muted group-hover:text-heading" /> Back to Folevi
            </a>
            <form method="post" action="/signout">
              <button type="submit" className={`${ROW} ${ROW_OFF} w-full text-left`}>
                <LogOut size={16} aria-hidden className="flex-none text-muted group-hover:text-heading" /> Sign out
              </button>
            </form>
            <div className="mt-1.5 flex h-12 items-center gap-2.5 rounded-[6px] px-2">
              <Avatar name={admin.displayName} size={28} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13.5px] font-semibold text-heading" title={admin.displayName}>
                  {admin.displayName}
                </span>
                <span className="block truncate text-[11.5px] text-muted">{ROLE_LABEL[admin.role]}</span>
              </span>
            </div>
          </div>
        </aside>

        {/* The content panel: nearly opaque glass, scrolling on its own under the floating tab strip. */}
        <div className="ui-content relative flex min-w-0 flex-1 flex-col md:overflow-hidden md:rounded-[14px]">
          <div className="min-h-0 flex-1 md:overflow-y-auto">
            <div className="sticky top-0 z-30 px-2 pt-2">
              <div className="ui-glass ui-glass-sidebar flex h-11 items-center gap-1.5 rounded-[14px] px-1.5">
                {onRecord && section ? (
                  <Link href={section.href} aria-label={`Up to ${section.label}`} title={`Up to ${section.label}`} className={ICON_BTN}>
                    <ArrowUp size={15} aria-hidden />
                  </Link>
                ) : (
                  <span aria-hidden className={`${ICON_BTN} pointer-events-none opacity-30`}>
                    <ArrowUp size={15} />
                  </span>
                )}
                <span aria-hidden className="h-5 w-px flex-none bg-[var(--glass-border)]" />
                <nav aria-label="Location" className="flex min-w-0 items-center gap-1.5 px-1">
                  {section ? (
                    onRecord ? (
                      <Link href={section.href} className={`${TAB} ${TAB_OFF} flex-none`}>
                        <SectionIcon size={14} aria-hidden className="flex-none" />
                        {section.label}
                      </Link>
                    ) : (
                      <span aria-current="page" className={`${TAB} ${TAB_ON} flex-none`}>
                        <SectionIcon size={14} aria-hidden className="flex-none" />
                        {section.label}
                      </span>
                    )
                  ) : null}
                  {onRecord ? (
                    <span aria-current="page" title={recordTitle ?? undefined} className={`${TAB} ${TAB_ON} max-w-[280px]`}>
                      <span className="truncate">{recordTitle ?? "Loading…"}</span>
                    </span>
                  ) : null}
                </nav>
                <div className="flex-1" />
                <p
                  role="note"
                  title="Every view of user data and every change is recorded in the immutable audit log with your name, role, reason and request ID."
                  className="hidden min-w-0 items-center gap-1.5 truncate pr-2.5 text-[12.5px] text-muted lg:flex"
                >
                  <Eye size={14} aria-hidden className="flex-none" />
                  <span className="truncate">Every view of user data and every change is recorded in the immutable audit log.</span>
                </p>
              </div>
            </div>
            <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-[1480px] min-w-0 px-4 pb-20 pt-7 outline-none sm:px-8 lg:px-10">
              <p role="note" className="mb-4 flex items-start gap-1.5 text-[12.5px] text-muted lg:hidden">
                <Eye size={14} aria-hidden className="mt-0.5 flex-none" />
                Every view of user data and every change is recorded in the immutable audit log.
              </p>
              <PageBoundary key={pathname}>
                <Suspense fallback={null}>{children}</Suspense>
              </PageBoundary>
            </main>
          </div>
        </div>
      </div>
    </AdminTitleContext.Provider>
  );
}
