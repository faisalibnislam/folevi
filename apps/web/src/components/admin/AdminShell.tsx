"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Component, Suspense, type ReactNode } from "react";
import { ArrowLeft, ClipboardList, Eye, Gauge, Mail, Settings2, Trash2, Users, Building2, LogOut } from "lucide-react";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { useAdmin } from "./AdminApp";
import { ROLE_LABEL, type Capability } from "./permissions";
import { Badge } from "./ui";

const NAV: { href: string; label: string; icon: typeof Gauge; capability: Capability }[] = [
  { href: "/admin", label: "Dashboard", icon: Gauge, capability: "dashboard.view" },
  { href: "/admin/users", label: "Users", icon: Users, capability: "users.view" },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2, capability: "workspaces.view" },
  { href: "/admin/emails", label: "Emails", icon: Mail, capability: "emails.view" },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList, capability: "audit.view" },
  { href: "/admin/deletion-jobs", label: "Deletion jobs", icon: Trash2, capability: "deletionJobs.view" },
  { href: "/admin/configuration", label: "Configuration", icon: Settings2, capability: "config.view" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Errors inside a page stay inside the page; the shell and navigation keep working. */
class PageBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="m-8 rounded-[12px] border border-danger/40 bg-danger-soft p-5 text-sm">
          <p className="font-semibold">This page couldn&apos;t load.</p>
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

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const admin = useAdmin();
  const items = NAV.filter((n) => admin.can(n.capability));
  return (
    <div className="min-h-dvh bg-canvas text-ink md:flex">
      <a href="#admin-main" className="sr-only-focusable fixed left-2 top-2 z-[70] rounded-[6px] bg-accent px-3 py-2 text-accent-ink">
        Skip to content
      </a>
      {/* Operations accent: a plum strip distinguishes the console from the product at a glance. */}
      <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-[3px] bg-plum" />
      <aside className="flex flex-none flex-col border-b border-line bg-surface pt-[3px] md:sticky md:top-0 md:h-dvh md:w-[228px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <FoleviMark size={22} accent="var(--color-plum)" />
          <span className="font-display text-[22px] leading-none">Folevi</span>
          <Badge tone="plum" className="ml-1 uppercase tracking-[0.08em]">
            Admin
          </Badge>
        </div>
        <nav aria-label="Admin" className="px-2 md:flex-1 md:overflow-y-auto">
          <ul className="flex gap-0.5 overflow-x-auto pb-2 md:flex-col md:pb-0">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[13.5px] ${
                      active ? "bg-plum-soft font-medium text-plum-ink" : "text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink"
                    }`}
                  >
                    <Icon size={15} aria-hidden className="flex-none" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="hidden border-t border-line p-3 md:block">
          <div className="px-1">
            <p className="truncate text-sm font-medium" title={admin.displayName}>
              {admin.displayName}
            </p>
            <p className="text-xs text-muted">{ROLE_LABEL[admin.role]}</p>
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            <a href="/documents" className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[13px] text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink">
              <ArrowLeft size={14} aria-hidden /> Back to Folevi
            </a>
            <form method="post" action="/signout">
              <button type="submit" className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[13px] text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink">
                <LogOut size={14} aria-hidden /> Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col md:pt-[3px]">
        <div role="note" className="sticky top-[3px] z-30 flex items-center gap-2 border-b border-line bg-plum-soft px-6 py-2 text-[13px] text-plum-ink">
          <Eye size={14} aria-hidden className="flex-none" />
          <span>
            Every view of user data and every change is recorded in the immutable audit log with your name, role, reason and request ID.
          </span>
          <span className="ml-auto hidden whitespace-nowrap text-xs xl:inline">
            Signed in as {admin.displayName} · {ROLE_LABEL[admin.role]}
          </span>
        </div>
        <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 px-6 pb-20 pt-6 outline-none lg:px-10">
          <PageBoundary key={pathname}>
            <Suspense fallback={null}>{children}</Suspense>
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
