"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { Wordmark } from "./ui";

type NavItem = { label: string; href: string };

export function SiteHeader({ nav, signInUrl, signUpUrl }: { nav: readonly NavItem[]; signInUrl: string; signUpUrl: string }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheetRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const media = window.matchMedia("(min-width: 768px)");
    const onMedia = () => media.matches && close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    media.addEventListener("change", onMedia);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      media.removeEventListener("change", onMedia);
    };
  }, [open, close]);

  const isCurrent = (href: string) => !href.includes("#") && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="mk-rail sticky top-0 z-50 px-2.5 pt-3 sm:px-5" data-scrolled={scrolled} data-open={open}>
      <div className="mk-rail-inner mx-auto grid h-16 w-full max-w-[1200px] grid-cols-[1fr_auto] items-center gap-4 pl-3 pr-2.5 sm:pl-4 md:grid-cols-[1fr_auto_1fr]">
        <Link href="/" className="flex h-11 w-fit items-center rounded-full px-2" aria-label="Folevi home">
          <Wordmark markSize={24} className="text-[17px]" />
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="mk-navtrack flex items-center gap-0.5">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined} className="mk-navlink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center justify-end gap-1.5 md:flex">
          <a href={signInUrl} className="mk-btn mk-btn-ghost h-10 px-4 text-[14px]">
            Sign in
          </a>
          <a href={signUpUrl} className="mk-btn mk-btn-primary h-10 px-[18px] text-[14px]">
            Start writing
          </a>
        </div>

        <button
          ref={buttonRef}
          type="button"
          className="mk-btn mk-btn-secondary h-11 min-w-11 justify-self-end px-4 text-[14px] md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{open ? "Close" : "Menu"}</span>
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
      </div>

      <div ref={sheetRef} id={menuId} hidden={!open} className="mk-sheet absolute inset-x-2.5 top-full mt-2 p-2 sm:inset-x-5 md:hidden">
        <nav aria-label="Primary">
          <ul className="space-y-0.5">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center justify-between rounded-[16px] px-4 text-[17px] font-medium text-(--color-heading) hover:bg-accent-soft aria-[current=page]:bg-accent-soft"
                >
                  {item.label}
                  <Icon name="chevron-right" size={16} className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t mk-hair px-1 pt-3">
            <a href={signInUrl} className="mk-btn mk-btn-secondary h-12 text-[15px]">
              Sign in
            </a>
            <a href={signUpUrl} className="mk-btn mk-btn-primary h-12 text-[15px]">
              Start writing
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
